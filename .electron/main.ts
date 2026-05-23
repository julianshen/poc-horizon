import { app, BrowserWindow, ipcMain, protocol, safeStorage } from 'electron';
import path from 'path';
import { WindowManager } from './services/WindowManager';
import { TabManager } from './services/TabManager';
import { SessionManager } from './services/SessionManager';
import { SettingsManager } from './services/SettingsManager';
import { BookmarkManager } from './services/BookmarkManager';
import { HistoryManager } from './services/HistoryManager';
import { DownloadManager } from './services/DownloadManager';
import { PasswordManager } from './services/PasswordManager';
import { AutofillManager } from './services/AutofillManager';
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from './ipc/channels';
import { registerIpcHandlers } from './ipc/main-handlers';


const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let windowManager: WindowManager;
let tabManager: TabManager;

function createWindow(): void {
  windowManager = new WindowManager();
  const win = windowManager.createWindow();

  // Block pop-ups
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  const sessionManager = new SessionManager();
  sessionManager.initialize();

  const settingsManager = new SettingsManager(path.join(app.getPath('userData'), 'settings.json'));
  const bookmarkManager = new BookmarkManager(path.join(app.getPath('userData'), 'bookmarks.json'));
  const historyManager = new HistoryManager(path.join(app.getPath('userData'), 'history.json'));
  const downloadManager = new DownloadManager();
  const passwordManager = new PasswordManager(
    path.join(app.getPath('userData'), 'passwords.json'),
    {
      encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
    }
  );
  const autofillManager = new AutofillManager();

  tabManager = new TabManager(win, historyManager);

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

  // Auto-updater
  autoUpdater.checkForUpdatesAndNotify();

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000); // 4 hours

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

  // Create initial tab
  tabManager.createTab('https://duckduckgo.com');
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
