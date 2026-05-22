import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './channels';
import { TabManager } from '../services/TabManager';
import { SettingsManager } from '../services/SettingsManager';
import { BookmarkManager } from '../services/BookmarkManager';
import { HistoryManager } from '../services/HistoryManager';
import { DownloadManager } from '../services/DownloadManager';

export function registerIpcHandlers(tabManager: TabManager, window: BrowserWindow, settingsManager: SettingsManager, bookmarkManager: BookmarkManager, historyManager: HistoryManager, downloadManager: DownloadManager): void {
  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (_event, { url }: { url?: string }) => {
    return tabManager.createTab(url);
  });

  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, (_event, { tabId }: { tabId: string }) => {
    tabManager.closeTab(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.TAB_ACTIVATE, (_event, { tabId }: { tabId: string }) => {
    tabManager.activateTab(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_GO, (_event, { tabId, url }: { tabId: string; url: string }) => {
    tabManager.navigate(tabId, url);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_BACK, (_event, { tabId }: { tabId: string }) => {
    tabManager.goBack(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_FORWARD, (_event, { tabId }: { tabId: string }) => {
    tabManager.goForward(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_RELOAD, (_event, { tabId, hard }: { tabId: string; hard?: boolean }) => {
    tabManager.reload(tabId, hard);
  });

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_STOP, (_event, { tabId }: { tabId: string }) => {
    tabManager.stop(tabId);
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    window.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    window.close();
  });

  ipcMain.handle(IPC_CHANNELS.APP_QUIT, () => {
    process.exit(0);
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return '1.0.0';
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }: { key: string }) => {
    return settingsManager.get(key);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return settingsManager.getAll();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, { key, value }: { key: string; value: unknown }) => {
    settingsManager.set(key, value);
    window.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, { key, value });
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, (_event, { key }: { key?: string }) => {
    settingsManager.reset(key);
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARK_GET_TREE, () => bookmarkManager.getTree());
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_ADD, (_event, { url, title, parentId }: { url: string; title: string; parentId?: string }) => bookmarkManager.add(url, title, parentId));
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_REMOVE, (_event, { bookmarkId }: { bookmarkId: string }) => bookmarkManager.remove(bookmarkId));
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_MOVE, (_event, { bookmarkId, parentId, index }: { bookmarkId: string; parentId: string; index: number }) => bookmarkManager.move(bookmarkId, parentId, index));
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_UPDATE, (_event, { bookmarkId, changes }: { bookmarkId: string; changes: Partial<import('../../src/types/browser').Bookmark> }) => bookmarkManager.update(bookmarkId, changes));
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_IMPORT, (_event, { data }: { data: string }) => bookmarkManager.import(data));
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_EXPORT, () => bookmarkManager.export());

  ipcMain.handle(IPC_CHANNELS.HISTORY_SEARCH, (_event, { query, limit }: { query: string; limit?: number }) => historyManager.search(query, limit));
  ipcMain.handle(IPC_CHANNELS.HISTORY_GET_RECENT, (_event, { limit }: { limit?: number }) => historyManager.getRecent(limit));
  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, (_event, { range }: { range?: string }) => historyManager.clear(range));

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PAUSE, (_event, { downloadId }: { downloadId: string }) => downloadManager.pause(downloadId));
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_RESUME, (_event, { downloadId }: { downloadId: string }) => downloadManager.resume(downloadId));
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, (_event, { downloadId }: { downloadId: string }) => downloadManager.cancel(downloadId));
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CLEAR_COMPLETED, () => downloadManager.clearCompleted());
}
