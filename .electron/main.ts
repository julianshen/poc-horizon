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
import { registerIpcHandlers } from './ipc/main-handlers';
import { denyAllWindowOpens } from './services/windowOpenPolicy';
import { scheduleAutoUpdate } from './services/autoUpdateScheduler';
import { TabSessionStore } from './services/TabSessionStore';
import type { Tab } from '../src/types/browser';


const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let windowManager: WindowManager;
let tabManager: TabManager;

function createWindow(): void {
  windowManager = new WindowManager();
  const win = windowManager.createWindow();

  win.webContents.setWindowOpenHandler(denyAllWindowOpens);

  const sessionManager = new SessionManager();
  sessionManager.initialize();

  const settingsManager = new SettingsManager(path.join(app.getPath('userData'), 'settings.json'));
  const bookmarkManager = new BookmarkManager(path.join(app.getPath('userData'), 'bookmarks.json'));
  const historyManager = new HistoryManager(path.join(app.getPath('userData'), 'history.json'));
  const downloadStore = new DownloadStore(path.join(app.getPath('userData'), 'downloads.json'));
  const downloadManager = new DownloadManager(downloadStore);
  const passwordManager = new PasswordManager(
    path.join(app.getPath('userData'), 'passwords.json'),
    {
      encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
    }
  );
  const autofillManager = new AutofillManager(path.join(app.getPath('userData'), 'addresses.json'));
  const tabSessionStore = new TabSessionStore(path.join(app.getPath('userData'), 'session.json'));

  tabManager = new TabManager(win, historyManager);

  // Persist tabs whenever TabManager broadcasts a tab:* event to the
  // renderer. We hook by wrapping webContents.send so the persistence
  // is invisible to TabManager itself.
  const persist = (): void => {
    tabSessionStore.scheduleSave(
      tabManager.getAllTabs().map((t: Tab) => ({
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
      tabManager.getAllTabs().map((t: Tab) => ({
        url: t.url,
        title: t.title,
        isPinned: t.isPinned,
        isActive: t.isActive,
      }))
    );
  });

  win.webContents.session.on('will-download', (event, item, webContents) => {
    downloadManager.handleDownload(event, item, webContents);
  });

  // Register horizon:// protocol for internal pages
  protocol.registerFileProtocol('horizon', (request, callback) => {
    const url = new URL(request.url);
    const page = url.hostname || 'newtab';
    const filePath = path.join(__dirname, '../resources/pages', `${page}.html`);
    callback({ path: filePath });
  });

  registerIpcHandlers(tabManager, win, settingsManager, bookmarkManager, historyManager, downloadManager, passwordManager, autofillManager);

  scheduleAutoUpdate(autoUpdater);

  autoUpdater.on('update-available', (info) => {
    win.webContents.send(IPC_CHANNELS.APP_UPDATE_AVAILABLE, { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send(IPC_CHANNELS.APP_UPDATE_DOWNLOADED, { version: info.version });
  });

  ipcMain.handle(IPC_CHANNELS.APP_CHECK_FOR_UPDATES, async () => {
    const result = await autoUpdater.checkForUpdates();
    return {
      updateAvailable: !!result?.updateInfo,
      version: result?.updateInfo?.version,
    };
  });

  // Defer initial tab until the renderer's IPC listeners are registered
  // (useTabs subscribes inside a React useEffect, which runs after the
  // first paint). Without this wait, the tab:created broadcast fires
  // into the void and the TabBar never sees the initial tab.
  win.webContents.once('did-finish-load', () => {
    const startup = settingsManager.get('startupBehavior') as 'new-tab' | 'restore' | 'specific-pages' | undefined;
    const restoreDisabled = process.env.HORIZON_DISABLE_RESTORE === '1';
    if (startup === 'restore' && !restoreDisabled) {
      const saved = tabSessionStore.load();
      if (saved.length > 0) {
        let activated: string | null = null;
        for (const t of saved) {
          const created = tabManager.createTab(t.url);
          if (t.isPinned) tabManager.setPinned(created.id, true);
          if (t.isActive) activated = created.id;
        }
        if (activated) tabManager.activateTab(activated);
        return;
      }
    }
    tabManager.createTab('horizon://newtab');
  });
}

app.whenReady().then(createWindow);

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
    if (url && tabManager) {
      tabManager.createTab(url);
    }
  }
});
