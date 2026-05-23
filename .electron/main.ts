import { app, BrowserWindow, ipcMain, protocol, safeStorage } from 'electron';
import path from 'path';
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
import type { Tab } from '../src/types/browser';


const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let windowManager: WindowManager;
// Maps a renderer webContents.id to its window's context so IPC handlers
// can dispatch to the right TabManager / BrowserWindow.
const contexts = new Map<number, WindowContext>();
// Mirrors the most-recently-created non-incognito TabManager for app-level
// hooks that don't have a sender (second-instance, etc).
let primaryTabManager: TabManager;

// App-wide singletons (shared between all windows).
let settingsManager: SettingsManager;
let bookmarkManager: BookmarkManager;
let historyManager: HistoryManager;
let downloadManager: DownloadManager;
let passwordManager: PasswordManager;
let autofillManager: AutofillManager;
let tabSessionStore: TabSessionStore;

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
    const page = url.hostname || 'newtab';
    const filePath = path.join(__dirname, '../resources/pages', `${page}.html`);
    callback({ path: filePath });
  });

  const sessionManager = new SessionManager();
  sessionManager.initialize();
}

function registerHandlers(): void {
  // Resolve a per-window context from the IPC event sender. The sender's
  // WebContents may be the chrome renderer itself, a child BrowserView,
  // or something else — we find the owning BrowserWindow and look up its
  // context.
  const resolve = (event: { sender: { id: number } }): WindowContext | undefined => {
    const direct = contexts.get(event.sender.id);
    if (direct) return direct;
    const win = BrowserWindow.fromWebContents(event.sender as Electron.WebContents);
    if (!win) return undefined;
    return contexts.get(win.webContents.id);
  };

  registerIpcHandlers(
    // Fallback values — these only fire if the resolver returns undefined,
    // which shouldn't happen in production.
    primaryTabManager,
    contexts.values().next().value?.window ?? BrowserWindow.getAllWindows()[0],
    settingsManager,
    bookmarkManager,
    historyManager,
    downloadManager,
    passwordManager,
    autofillManager,
    resolve
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_NEW_INCOGNITO, () => createWindow({ incognito: true }));
  ipcMain.handle(IPC_CHANNELS.APP_CHECK_FOR_UPDATES, async () => {
    const result = await autoUpdater.checkForUpdates();
    return {
      updateAvailable: !!result?.updateInfo,
      version: result?.updateInfo?.version,
    };
  });
}

let handlersRegistered = false;

function createWindow(opts: { incognito?: boolean } = {}): void {
  initSingletons();

  if (!windowManager) windowManager = new WindowManager();
  const win = windowManager.createWindow(opts);
  const incognito = opts.incognito === true;

  win.webContents.setWindowOpenHandler(denyAllWindowOpens);

  const localTabManager = new TabManager(
    win,
    historyManager,
    incognito ? WindowManager.incognitoPartition() : undefined
  );
  contexts.set(win.webContents.id, { tabManager: localTabManager, window: win });
  if (!incognito) primaryTabManager = localTabManager;

  win.on('closed', () => contexts.delete(win.webContents.id));

  if (!incognito) {
    const persist = (): void => {
      tabSessionStore.scheduleSave(
        localTabManager.getAllTabs().map((t: Tab) => ({
          url: t.url,
          title: t.title,
          isPinned: t.isPinned,
          isActive: t.isActive,
        }))
      );
    };
    const origSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = ((channel: string, ...args: unknown[]): void => {
      origSend(channel, ...args);
      if (channel.startsWith('tab:')) persist();
    }) as typeof win.webContents.send;

    app.on('before-quit', () => {
      tabSessionStore.flush(
        localTabManager.getAllTabs().map((t: Tab) => ({
          url: t.url,
          title: t.title,
          isPinned: t.isPinned,
          isActive: t.isActive,
        }))
      );
    });
  }

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
      win.webContents.send(IPC_CHANNELS.APP_UPDATE_AVAILABLE, { version: info.version });
    });
    autoUpdater.on('update-downloaded', (info) => {
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

app.whenReady().then(() => createWindow());

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
  const win = windowManager?.getWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();

    const url = argv.find((arg) => arg.startsWith('http'));
    if (url && primaryTabManager) {
      primaryTabManager.createTab(url);
    }
  }
});
