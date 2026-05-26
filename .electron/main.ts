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
import { parseLlmsTxt } from './services/llmsTxtParser';
import { writePiSkill } from './services/piSkillWriter';
import { WorkflowsManager } from './services/WorkflowsManager';
import { HelperRegistry } from './services/HelperRegistry';
import { DomainSkills } from './services/DomainSkills';
import { SkillsLibrary } from './services/SkillsLibrary';
import { AiActionGuard, type ActionPolicy, type ActionPrompt } from './services/AiActionGuard';
import { translateText } from './services/LlmTranslator';
import { translatePage, restorePage } from './services/pageTranslator';
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
let workflowsManager: WorkflowsManager;
let helperRegistry: HelperRegistry;
let domainSkills: DomainSkills;
let skillsLibrary: SkillsLibrary;
let aiActionGuard: AiActionGuard;

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

/**
 * Get-or-create the PiSession for a window. Spawns the Pi subprocess +
 * bridge server (once per app session). Shared by ai:start, ai:preWarm,
 * and the post-createWindow proactive warm. Idempotent.
 *
 * Promise rejections (e.g. bridge bind failure) are caller-handled —
 * createWindow's caller wraps in try/catch so a missing pi binary or
 * port-bind failure doesn't crash startup.
 */
async function ensurePiSession(ctx: WindowContext, harness: BrowserHarness): Promise<PiSession> {
  const wcId = ctx.window.webContents.id;
  const existing = piSessions.get(wcId);
  if (existing) return existing;
  if (!bridgeServer) {
    bridgeServer = new HorizonBridgeServer(harness, helperRegistry, domainSkills, skillsLibrary, aiActionGuard);
    bridgePort = await bridgeServer.listen();
  }
  const kind = aiSessionKindFor(ctx.tabManager);
  const binary = (settingsManager.get('aiPiBinary' as never) as string) ?? 'pi';
  const baseArgs = (settingsManager.get('aiPiArgs' as never) as string[]) ?? ['--mode', 'rpc'];
  const extensionPath = path.join(__dirname, '../resources/pi-extension/horizon-bridge.ts');
  const sessions = (settingsManager.get('aiSessions' as never) as { default?: string; incognito?: string }) ?? {};
  const savedSession = sessions[kind] ?? '';
  const sessionArgs = savedSession && existsSync(savedSession) ? ['--session', savedSession] : [];
  const args = [...baseArgs, ...sessionArgs, '-e', extensionPath];
  const maxIterations = (settingsManager.get('aiMaxIterations' as never) as number) ?? 24;
  const piSession = new PiSession({ binary, args, maxIterations, env: { HORIZON_BRIDGE_PORT: String(bridgePort) } }, harness);
  piSession.on('event', (e: AgentEvent) => {
    const wc = ctx.window?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(IPC_CHANNELS.AI_EVENT, e);
    // Release the CDP debugger when the turn ends so DevTools and other
    // single-client CDP consumers can attach. We re-attach on next
    // ai:start (cheap — ~50ms).
    if (e.type === 'turn_end') harness.detach();
  });
  piSession.on('session', (sessionFile: string) => {
    try {
      const current = (settingsManager.get('aiSessions' as never) as { default?: string; incognito?: string }) ?? {};
      settingsManager.set('aiSessions' as never, { ...current, [kind]: sessionFile } as never);
    } catch { /* */ }
  });
  piSessions.set(wcId, piSession);
  piSession.start();
  return piSession;
}

/** Origins for which we've already surfaced the llms.txt guide this app session. */
const llmsTxtShownOrigins = new Set<string>();

async function handleNavigateForLlmsTxt(url: string, win: BrowserWindow): Promise<void> {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return; }
  // Skip our own protocol; nothing useful there.
  if (origin.startsWith('horizon:') || origin.startsWith('file:') || origin.startsWith('data:')) return;
  if (llmsTxtShownOrigins.has(origin)) return;
  llmsTxtShownOrigins.add(origin); // claim eagerly so concurrent navigations don't double-fire

  const { llmsTxt, llmsFullTxt } = await llmsTxtResolver.fetchBoth(origin);
  if (!llmsTxt && !llmsFullTxt) {
    // No guide here — leave the "shown" claim in place so we don't refetch on every page within the site.
    return;
  }
  // Parse the index (prefer llms.txt; fall back to first lines of llms-full.txt).
  const parsed = parseLlmsTxt(llmsTxt ?? llmsFullTxt ?? '');
  let skillFile: string | undefined;
  if (llmsTxt || llmsFullTxt) {
    const path = await writePiSkill(origin, llmsTxt ?? '', llmsFullTxt ?? undefined);
    if (path) skillFile = path;
  }
  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.AI_LLMS_TXT_FOUND, {
      origin,
      title: parsed.title,
      summary: parsed.summary,
      sections: parsed.sections,
      hasFull: Boolean(llmsFullTxt),
      skillFile,
    });
  }
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
  workflowsManager = new WorkflowsManager(path.join(data, 'workflows.json'));
  helperRegistry = new HelperRegistry(path.join(data, 'js-helpers.json'));
  domainSkills = new DomainSkills(path.join(data, 'domain-skills'));
  skillsLibrary = new SkillsLibrary(path.join(__dirname, '../resources/pi-extension/skills'));
  aiActionGuard = new AiActionGuard(
    () => ((settingsManager.get('aiConfirmActions' as never) as ActionPolicy | undefined) ?? 'never'),
  );
  aiActionGuard.on('prompt', (p: ActionPrompt) => {
    // Broadcast to every window — the AI panel that's currently visible
    // is the one that'll render and decide. Other windows ignore unknown ids.
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC_CHANNELS.AI_ACTION_PROMPT, p);
    }
  });
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

  ipcMain.handle(IPC_CHANNELS.AI_PRE_WARM, async (event) => {
    const ctx = resolve(event);
    if (!browserHarness) browserHarness = new BrowserHarness();
    // PreWarm doesn't need a tab attach yet — that happens lazily on first
    // ai:start. Spawning Pi is the expensive part (1-3s) we want to hide.
    await ensurePiSession(ctx, browserHarness);
    return { ok: true };
  });

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

    const piSession = await ensurePiSession(ctx, browserHarness);

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

  // Renderer → main: user decided on an agent action prompt.
  ipcMain.handle(IPC_CHANNELS.AI_ACTION_DECIDE, (_event, payload: { id: string; allow: boolean }) => {
    return { handled: aiActionGuard.decide(payload.id, payload.allow) };
  });

  ipcMain.handle(IPC_CHANNELS.WORKFLOW_LIST, () => workflowsManager.list());
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_CREATE, (_event, input: { name: string; prompt: string; attach: 'activeTab' | 'allTabs' | 'none' }) =>
    workflowsManager.create(input)
  );
  ipcMain.handle(IPC_CHANNELS.WORKFLOW_DELETE, (_event, { id }: { id: string }) => workflowsManager.delete(id));

  // ─── Translation ──────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.TRANSLATE_PAGE, async (event, payload: { targetLang: string }) => {
    const ctx = resolve(event);
    const active = ctx.tabManager.getActiveTabId();
    if (!active) return { ok: false, error: 'No active tab' };
    const view = ctx.tabManager.getBrowserView(active);
    if (!view) return { ok: false, error: 'Active tab has no BrowserView' };
    const chromeWc = ctx.window.webContents;
    const result = await translatePage(view.webContents, payload.targetLang, (translated, total) => {
      if (!chromeWc.isDestroyed()) {
        chromeWc.send(IPC_CHANNELS.TRANSLATE_PROGRESS, { translated, total, done: false });
      }
    });
    if (!chromeWc.isDestroyed()) {
      chromeWc.send(IPC_CHANNELS.TRANSLATE_PROGRESS, {
        translated: result.translated ?? 0, total: result.total ?? 0, done: true,
      });
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.TRANSLATE_RESTORE, async (event) => {
    const ctx = resolve(event);
    const active = ctx.tabManager.getActiveTabId();
    if (!active) return { ok: false, error: 'No active tab' };
    const view = ctx.tabManager.getBrowserView(active);
    if (!view) return { ok: false, error: 'Active tab has no BrowserView' };
    return await restorePage(view.webContents);
  });

  ipcMain.handle(IPC_CHANNELS.TRANSLATE_SELECTION, async (_event, { text, targetLang }: { text: string; targetLang: string }) => {
    const translated = await translateText(text, targetLang);
    return { ok: translated !== null, translated };
  });

  ipcMain.handle(IPC_CHANNELS.AI_PASTE_TO_PAGE, async (event, payload: { text: string }) => {
    const ctx = resolve(event);
    const active = ctx.tabManager.getActiveTabId();
    if (!active) return { ok: false, error: 'No active tab' };
    const view = ctx.tabManager.getBrowserView(active);
    if (!view) return { ok: false, error: 'Active tab has no BrowserView' };
    // Inject the text into the focused element. Handles <input>, <textarea>,
    // and contenteditable; fires input + change events so React/Vue/other
    // frameworks notice the change. Returns {ok, target} so the renderer
    // can surface "no input focused" feedback.
    const script = `(function(text){
      try {
        var el = document.activeElement;
        if (!el || el === document.body) return { ok: false, reason: 'no-focused-input' };
        var tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          var setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
          if (setter && setter.set) setter.set.call(el, text); else el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, target: tag };
        }
        if (el.isContentEditable) {
          // Replace selection with the text, or append at the end if no selection.
          var sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            el.textContent = (el.textContent || '') + text;
          }
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          return { ok: true, target: 'contenteditable' };
        }
        return { ok: false, reason: 'focused-element-not-editable' };
      } catch (err) {
        return { ok: false, reason: String(err && err.message || err) };
      }
    })(${JSON.stringify(payload.text)})`;
    try {
      const result = await view.webContents.executeJavaScript(script, true);
      return result as { ok: boolean; target?: string; reason?: string };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_UI_ACTION, (event, payload: unknown) => {
    const ctx = resolve(event);
    const piSession = piSessions.get(ctx.window.webContents.id);
    if (!piSession) return { ok: false, error: 'No active Pi session' };
    const a = payload as
      | { kind: 'button'; surfaceId: string; label: string; action?: string }
      | { kind: 'input'; surfaceId: string; path?: string; placeholder?: string; value: string };
    // Format the interaction as natural language. The agent sees this as
    // a user message and decides whether to render a follow-up surface
    // or take a different tool action.
    let message: string;
    if (a.kind === 'button') {
      message = a.action
        ? `[ui] On surface "${a.surfaceId}", I clicked the button "${a.label}" (action: ${a.action}).`
        : `[ui] On surface "${a.surfaceId}", I clicked the button "${a.label}".`;
    } else {
      const label = a.path ? `field "${a.path}"` : a.placeholder ? `field "${a.placeholder}"` : 'a text field';
      message = `[ui] On surface "${a.surfaceId}", I set ${label} to: ${JSON.stringify(a.value)}`;
    }
    void piSession.startTurn(message);
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

  // llms.txt navigation guide: when this window navigates to a new
  // origin, async-probe /llms.txt and /llms-full.txt. If found, send
  // a one-shot ai:llmsTxtFound IPC to the chrome renderer so it can
  // auto-open the AI panel and surface a guide card. Per-origin dedup
  // is in-memory only — restart of the app shows the card again.
  // Skill files are written to ~/.pi/agent/skills/ as a side-effect.
  localTabManager.onNavigate((url: string) => {
    void handleNavigateForLlmsTxt(url, win);
  });

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

  // Proactively spawn Pi after the window's first tab is ready. By the
  // time the user opens the AI panel for the first time, the subprocess
  // and bridge are already live — first-prompt latency drops by 1-3s.
  // Wrapped in try/catch so a missing 'pi' binary or bind failure
  // doesn't crash the browser launch. Skipped for incognito windows
  // (transient by intent — don't pay the spawn cost) and skippable via
  // aiSpawnOnStartup = false for users who don't want Pi running.
  if (!incognito && process.env.HORIZON_DISABLE_AI_SPAWN !== '1') {
    win.webContents.once('did-finish-load', () => {
      const enabled = settingsManager.get('aiSpawnOnStartup' as never) as boolean | undefined;
      if (enabled === false) return;
      if (!browserHarness) browserHarness = new BrowserHarness();
      const ctx = contexts.get(wcId);
      if (!ctx) return;
      void ensurePiSession(ctx, browserHarness).catch((err) => {
        console.warn('[main] Pi pre-warm failed (will retry on user-initiated ai:start):', err.message);
      });
    });
  }
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
