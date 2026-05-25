import { app, BrowserWindow, ipcMain, protocol, safeStorage, session, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { existsSync } from 'fs';
import { WindowManager } from './services/WindowManager';
import { TabManager } from './services/TabManager';
import { SessionManager } from './services/SessionManager';
import { SettingsManager } from './services/SettingsManager';
import { BookmarkManager } from './services/BookmarkManager';
import { HistoryManager } from './services/HistoryManager';
import { DownloadManager } from './services/DownloadManager';
import { DownloadStore } from './services/DownloadStore';
import { PasswordManager } from './services/PasswordManager';
import { AutofillManager } from './services/AutofillManager';
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from './ipc/channels';
import { registerIpcHandlers, WindowContext } from './ipc/main-handlers';
import { denyAllWindowOpens } from './services/windowOpenPolicy';
import { scheduleAutoUpdate } from './services/autoUpdateScheduler';
import { TabSessionStore } from './services/TabSessionStore';
import { PermissionBroker, PermissionDecision } from './services/PermissionBroker';
import { applySpellcheckToSession } from './services/spellcheck';
import { installAppMenu } from './services/appMenu';
import { BrowserHarness } from './services/BrowserHarness';
import { PiSession } from './services/PiSession';
import { LlmsTxtResolver } from './services/LlmsTxtResolver';
import { HorizonBridgeServer } from './services/HorizonBridgeServer';
import type { AgentEvent } from '../src/types/ai';
import type { Tab } from '../src/types/browser';


const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Allowlist for the horizon:// internal protocol. Anything not in this set
// returns ERR_FILE_NOT_FOUND so we can't be tricked into serving arbitrary
// files from the resources directory via a crafted hostname.
const HORIZON_PAGES = new Set(['newtab', 'error']);

let windowManager: WindowManager;
// Maps a renderer webContents.id to its window's context so IPC handlers
// can dispatch to the right TabManager / BrowserWindow.
const contexts = new Map<number, WindowContext>();
// The most-recently-created non-incognito TabManager. Acts as the fallback
// for IPC events whose sender we can't resolve (extremely rare) and the
// target for the OS second-instance hook.
let primaryTabManager: TabManager;
let primaryWindow: BrowserWindow | null = null;
// Non-incognito tab managers — flushed once on before-quit.
const persistableTabManagers = new Set<TabManager>();

// App-wide singletons (shared between all windows).
let settingsManager: SettingsManager;
let bookmarkManager: BookmarkManager;
let historyManager: HistoryManager;
let downloadManager: DownloadManager;
let passwordManager: PasswordManager;
let autofillManager: AutofillManager;
let tabSessionStore: TabSessionStore;
let permissionBroker: PermissionBroker;

// Single shared browser harness + Pi session for the AI panel POC.
// Lazy-init on first ai:start because spawning Pi is expensive.
let browserHarness: BrowserHarness | null = null;
// Per-window Pi sessions — incognito and regular windows MUST have
// distinct subprocesses so their conversations never co-mingle.
// Keyed by BrowserWindow.webContents.id (the chrome's wcId).
const piSessions = new Map<number, PiSession>();
let bridgeServer: HorizonBridgeServer | null = null;
let bridgePort = 0;
const llmsTxtResolver = new LlmsTxtResolver();

type AiSessionKind = 'default' | 'incognito';
function aiSessionKindFor(tm: TabManager): AiSessionKind {
  return tm.isIncognito() ? 'incognito' : 'default';
}
/** XML-escape for use inside an attribute value (mention <page> tags). */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function initSingletons(): void {
  if (settingsManager) return;
  const data = app.getPath('userData');
  settingsManager = new SettingsManager(path.join(data, 'settings.json'));
  bookmarkManager = new BookmarkManager(path.join(data, 'bookmarks.json'));
  historyManager = new HistoryManager(path.join(data, 'history.json'));
  const downloadStore = new DownloadStore(path.join(data, 'downloads.json'));
  downloadManager = new DownloadManager(downloadStore);
  passwordManager = new PasswordManager(path.join(data, 'passwords.json'), {
    encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
    decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
  });
  autofillManager = new AutofillManager(path.join(data, 'addresses.json'));
  tabSessionStore = new TabSessionStore(path.join(data, 'session.json'));

  protocol.registerFileProtocol('horizon', (request, callback) => {
    const url = new URL(request.url);
    const page = (url.hostname || 'newtab').toLowerCase();
    if (!HORIZON_PAGES.has(page)) {
      // -6 = net::ERR_FILE_NOT_FOUND
      callback({ error: -6 });
      return;
    }
    const filePath = path.join(__dirname, '../resources/pages', `${page}.html`);
    callback({ path: filePath });
  });

  permissionBroker = new PermissionBroker((prompt) => {
    // Broadcast to all open chrome renderers — the active one surfaces UI.
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const wc = w.webContents;
      if (!wc || wc.isDestroyed()) continue;
      wc.send(IPC_CHANNELS.PERMISSION_REQUEST, prompt);
    }
  });
  const sessionManager = new SessionManager(permissionBroker);
  sessionManager.initialize();

  // One global before-quit flush — uses the live `persistableTabManagers`
  // set so it stays correct as windows open and close.
  app.on('before-quit', () => {
    if (!tabSessionStore) return;
    for (const tm of persistableTabManagers) {
      const tabs = tm.getAllTabs().map((t: Tab) => ({
        url: t.url,
        title: t.title,
        isPinned: t.isPinned,
        isActive: t.isActive,
      }));
      tabSessionStore.flush(tabs);
    }
  });
}

function registerHandlers(): void {
  const resolve = (event: IpcMainInvokeEvent): WindowContext => {
    // Direct hit — the sender is a chrome renderer we tracked at window
    // creation.
    const direct = contexts.get(event.sender.id);
    if (direct) return direct;
    // Otherwise the sender could be a BrowserView (the page inside a tab)
    // or a child frame. Walk known windows and find the one that owns it.
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const ctx = contexts.get(win.webContents.id);
      if (ctx) return ctx;
    }
    // Last-resort fallback: route to the most-recent primary window. This
    // should not happen in practice but is preferable to throwing on a
    // valid-looking IPC.
    if (primaryTabManager && primaryWindow && !primaryWindow.isDestroyed()) {
      return { tabManager: primaryTabManager, window: primaryWindow };
    }
    throw new Error('IPC: could not resolve a WindowContext for the sender');
  };

  registerIpcHandlers(
    { settingsManager, bookmarkManager, historyManager, downloadManager, passwordManager, autofillManager },
    resolve
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_NEW_INCOGNITO, () => createWindow({ incognito: true }));

  // ─── AI agent (Pi POC) ──────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AI_START, async (event, payload: { prompt: string; mentionTabIds?: string[] }) => {
    const { prompt, mentionTabIds = [] } = payload;
    const ctx = resolve(event);
    const active = ctx.tabManager.getActiveTabId();
    if (!active) return { ok: false, error: 'No active tab' };
    const view = ctx.tabManager.getBrowserView(active);
    if (!view) return { ok: false, error: 'Active tab has no BrowserView' };

    if (!browserHarness) browserHarness = new BrowserHarness();
    try {
      browserHarness.attach(view.webContents);
    } catch (err) {
      return { ok: false, error: `Could not attach debugger: ${(err as Error).message}` };
    }

    const wcId = ctx.window.webContents.id;
    const kind = aiSessionKindFor(ctx.tabManager);
    let piSession = piSessions.get(wcId);

    if (!piSession) {
      // Bridge server (loopback TCP, random port) lets the Pi extension
      // call BrowserHarness primitives in-process while Pi itself runs
      // as a separate subprocess.
      if (!bridgeServer) {
        bridgeServer = new HorizonBridgeServer(browserHarness);
        bridgePort = await bridgeServer.listen();
      }
      const binary = (settingsManager.get('aiPiBinary' as never) as string) ?? 'pi';
      const baseArgs = (settingsManager.get('aiPiArgs' as never) as string[]) ?? ['--mode', 'rpc'];
      const extensionPath = path.join(__dirname, '../resources/pi-extension/horizon-bridge.ts');
      // Resume a previous session of this kind if we have one saved.
      const sessions = (settingsManager.get('aiSessions' as never) as { default?: string; incognito?: string }) ?? {};
      const savedSession = sessions[kind] ?? '';
      const sessionArgs = savedSession && existsSync(savedSession) ? ['--session', savedSession] : [];
      const args = [...baseArgs, ...sessionArgs, '-e', extensionPath];
      const maxIterations = (settingsManager.get('aiMaxIterations' as never) as number) ?? 24;
      piSession = new PiSession({ binary, args, maxIterations, env: { HORIZON_BRIDGE_PORT: String(bridgePort) } }, browserHarness);
      piSession.on('event', (e: AgentEvent) => {
        const wc = ctx.window?.webContents;
        if (wc && !wc.isDestroyed()) wc.send(IPC_CHANNELS.AI_EVENT, e);
      });
      // Capture the session file path so next launch can --session it.
      piSession.on('session', (sessionFile: string) => {
        try {
          const current = (settingsManager.get('aiSessions' as never) as { default?: string; incognito?: string }) ?? {};
          settingsManager.set('aiSessions' as never, { ...current, [kind]: sessionFile } as never);
        } catch { /* settings write failures are non-fatal */ }
      });
      piSessions.set(wcId, piSession);
    }

    // If enabled, prepend the active site's llms.txt as agent context.
    // Done out-of-band so a slow fetch can't block the turn (3s timeout
    // inside LlmsTxtResolver), and silently skipped if 404.
    let augmentedPrompt = prompt;
    const useLlmsTxt = settingsManager.get('aiUseLlmsTxt' as never) as boolean;
    if (useLlmsTxt) {
      try {
        const origin = new URL(view.webContents.getURL()).origin;
        const skills = await llmsTxtResolver.fetch(origin);
        if (skills) {
          augmentedPrompt = `<site-skills origin="${origin}">\n${skills}\n</site-skills>\n\n${augmentedPrompt}`;
        }
      } catch { /* invalid URL (horizon:// etc.) — skip */ }
    }

    // @-mentioned tabs: extract title + url + visible text, wrap as
    // <page> blocks, prepend so the agent can reason across pages
    // without needing to navigate to each.
    if (mentionTabIds.length > 0) {
      const cap = (settingsManager.get('aiMentionMaxChars' as never) as number) ?? 30_000;
      const blocks: string[] = [];
      for (const tabId of mentionTabIds) {
        const v = ctx.tabManager.getBrowserView(tabId);
        if (!v) continue;
        const wc = v.webContents;
        try {
          const title = wc.getTitle();
          const url = wc.getURL();
          // innerText approximates "what a human sees" better than
          // textContent (script/style filtered, line breaks preserved).
          // Truncate per-page to keep the prompt budget bounded.
          const text = (await wc.executeJavaScript('document.body && document.body.innerText || ""', true)) as string;
          const truncated = text.length > cap ? text.slice(0, cap) + '\n…[truncated]' : text;
          blocks.push(`<page url="${escapeAttr(url)}" title="${escapeAttr(title)}">\n${truncated}\n</page>`);
        } catch { /* tab destroyed or extract failed — skip */ }
      }
      if (blocks.length > 0) {
        augmentedPrompt = `${blocks.join('\n\n')}\n\n${augmentedPrompt}`;
      }
    }

    void piSession.startTurn(augmentedPrompt);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.AI_CANCEL, (event) => {
    const ctx = resolve(event);
    piSessions.get(ctx.window.webContents.id)?.cancel();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.AI_NEW_CHAT, (event) => {
    const ctx = resolve(event);
    const wcId = ctx.window.webContents.id;
    const kind = aiSessionKindFor(ctx.tabManager);
    // Kill the current Pi process so the next ai:start spawns fresh
    // without --session, and forget the saved path for this kind.
    piSessions.get(wcId)?.dispose();
    piSessions.delete(wcId);
    try {
      const current = (settingsManager.get('aiSessions' as never) as { default?: string; incognito?: string }) ?? {};
      const next = { ...current }; delete next[kind];
      settingsManager.set('aiSessions' as never, next as never);
    } catch { /* */ }
    return { ok: true };
  });
  ipcMain.handle(IPC_CHANNELS.PERMISSION_RESPOND, (_event, { id, decision }: { id: string; decision: PermissionDecision }) => {
    if (!permissionBroker) return false;
    return permissionBroker.respond(id, decision);
  });
  ipcMain.handle(IPC_CHANNELS.APP_CHECK_FOR_UPDATES, async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version };
    } catch (err) {
      console.warn('[main] checkForUpdates failed:', err);
      return { updateAvailable: false, error: 'unavailable' as const };
    }
  });
}

let handlersRegistered = false;

function createWindow(opts: { incognito?: boolean } = {}): void {
  initSingletons();

  if (!windowManager) windowManager = new WindowManager();
  const win = windowManager.createWindow(opts);
  const incognito = opts.incognito === true;
  // Capture identifiers eagerly — once `closed` fires, win.webContents may
  // already be destroyed and reading .id throws "Object has been destroyed".
  const wcId = win.webContents.id;

  win.webContents.setWindowOpenHandler(denyAllWindowOpens);

  const localTabManager = new TabManager(
    win,
    incognito
      ? { kind: 'incognito' }
      : { kind: 'default', historyManager }
  );
  contexts.set(wcId, { tabManager: localTabManager, window: win });

  if (!incognito) {
    primaryTabManager = localTabManager;
    primaryWindow = win;
    persistableTabManagers.add(localTabManager);

    // Persist tabs whenever TabManager fires a change event.
    localTabManager.onChange(() => {
      const tabs = localTabManager.getAllTabs().map((t: Tab) => ({
        url: t.url,
        title: t.title,
        isPinned: t.isPinned,
        isActive: t.isActive,
      }));
      tabSessionStore.scheduleSave(tabs);
    });
  }

  win.once('closed', () => {
    contexts.delete(wcId);
    persistableTabManagers.delete(localTabManager);
    // Tear down this window's Pi subprocess so we don't leak it.
    piSessions.get(wcId)?.dispose();
    piSessions.delete(wcId);
    if (primaryWindow === win) primaryWindow = null;
  });

  win.webContents.session.on('will-download', (event, item, webContents) => {
    downloadManager.handleDownload(event, item, webContents);
  });

  if (!handlersRegistered) {
    registerHandlers();
    handlersRegistered = true;
  }

  if (!incognito) {
    scheduleAutoUpdate(autoUpdater);
    autoUpdater.on('update-available', (info) => {
      if (win.isDestroyed()) return;
      win.webContents.send(IPC_CHANNELS.APP_UPDATE_AVAILABLE, { version: info.version });
    });
    autoUpdater.on('update-downloaded', (info) => {
      if (win.isDestroyed()) return;
      win.webContents.send(IPC_CHANNELS.APP_UPDATE_DOWNLOADED, { version: info.version });
    });
  }

  win.webContents.once('did-finish-load', () => {
    if (incognito) {
      localTabManager.createTab('horizon://newtab');
      return;
    }
    const startup = settingsManager.get('startupBehavior') as 'new-tab' | 'restore' | 'specific-pages' | undefined;
    const restoreDisabled = process.env.HORIZON_DISABLE_RESTORE === '1';
    if (startup === 'restore' && !restoreDisabled) {
      const saved = tabSessionStore.load();
      if (saved.length > 0) {
        let activated: string | null = null;
        for (const t of saved) {
          const created = localTabManager.createTab(t.url);
          if (t.isPinned) localTabManager.setPinned(created.id, true);
          if (t.isActive) activated = created.id;
        }
        if (activated) localTabManager.activateTab(activated);
        return;
      }
    }
    localTabManager.createTab('horizon://newtab');
  });
}

app.whenReady().then(() => {
  // Apply spell-check settings to every session that exists or will be
  // created. The default session is for regular windows; the incognito
  // partition is created in WindowManager when an incognito window opens.
  initSingletons();
  const langs = settingsManager.get('spellcheckLanguages') as string[];
  applySpellcheckToSession(session.defaultSession, langs);
  applySpellcheckToSession(session.fromPartition('incognito', { cache: false }), langs);
  // Install the native application menu (macOS top-of-screen bar / Win
  // & Linux in-window menubar). Without this, Electron's default menu
  // is barely useful — no New Tab, no Reload, no Find, no DevTools.
  installAppMenu({
    resolveTabManager: () => {
      const w = BrowserWindow.getFocusedWindow();
      if (!w) return primaryTabManager;
      return contexts.get(w.webContents.id)?.tabManager ?? primaryTabManager;
    },
    resolveWindow: () => BrowserWindow.getFocusedWindow() ?? primaryWindow,
    openNewWindow: (opts) => createWindow(opts),
  });
  createWindow();
});

app.on('before-quit', () => {
  for (const s of piSessions.values()) s.dispose();
  piSessions.clear();
  bridgeServer?.close();
  browserHarness?.detach();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('second-instance', (_event, argv) => {
  const win = primaryWindow ?? windowManager?.getWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();

    const url = argv.find((arg) => arg.startsWith('http'));
    if (url && primaryTabManager) {
      primaryTabManager.createTab(url);
    }
  }
});
