import { app, BrowserWindow, protocol } from 'electron';
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

  const sessionManager = new SessionManager();
  sessionManager.initialize();

  const settingsManager = new SettingsManager();
  const bookmarkManager = new BookmarkManager();
  const historyManager = new HistoryManager();
  const downloadManager = new DownloadManager();
  const passwordManager = new PasswordManager();
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
