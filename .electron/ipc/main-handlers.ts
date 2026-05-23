import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from './channels';
import { TabManager } from '../services/TabManager';
import { SettingsManager } from '../services/SettingsManager';
import { BookmarkManager } from '../services/BookmarkManager';
import { HistoryManager } from '../services/HistoryManager';
import { DownloadManager } from '../services/DownloadManager';
import { PasswordManager } from '../services/PasswordManager';
import { AutofillManager } from '../services/AutofillManager';

export interface WindowContext {
  tabManager: TabManager;
  window: BrowserWindow;
}

/**
 * Register all IPC handlers.
 *
 * `fallbackTabManager` + `fallbackWindow` are used when `resolveContext` is
 * absent (existing tests) or returns undefined. In production main.ts
 * passes a resolver that maps the event's sender to the right per-window
 * TabManager so multi-window setups (e.g. regular + incognito) route
 * correctly.
 */
export function registerIpcHandlers(
  fallbackTabManager: TabManager,
  fallbackWindow: BrowserWindow,
  settingsManager: SettingsManager,
  bookmarkManager: BookmarkManager,
  historyManager: HistoryManager,
  downloadManager: DownloadManager,
  passwordManager: PasswordManager,
  autofillManager: AutofillManager,
  resolveContext?: (event: IpcMainInvokeEvent) => WindowContext | undefined
): void {
  const ctx = (event: IpcMainInvokeEvent): WindowContext =>
    resolveContext?.(event) ?? { tabManager: fallbackTabManager, window: fallbackWindow };

  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (event, { url }: { url?: string }) => ctx(event).tabManager.createTab(url));
  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.closeTab(tabId));
  ipcMain.handle(IPC_CHANNELS.TAB_ACTIVATE, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.activateTab(tabId));
  ipcMain.handle(IPC_CHANNELS.TAB_PIN, (event, { tabId, pinned }: { tabId: string; pinned: boolean }) => ctx(event).tabManager.setPinned(tabId, pinned));
  ipcMain.handle(IPC_CHANNELS.TAB_MUTE, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.setMuted(tabId, true));
  ipcMain.handle(IPC_CHANNELS.TAB_UNMUTE, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.setMuted(tabId, false));
  ipcMain.handle(IPC_CHANNELS.TAB_DUPLICATE, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.duplicate(tabId));
  ipcMain.handle(IPC_CHANNELS.TAB_REORDER, (event, { tabId, index }: { tabId: string; index: number }) => ctx(event).tabManager.reorder(tabId, index));

  ipcMain.handle(IPC_CHANNELS.NAVIGATION_GO, (event, { tabId, url }: { tabId: string; url: string }) => ctx(event).tabManager.navigate(tabId, url));
  ipcMain.handle(IPC_CHANNELS.NAVIGATION_BACK, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.goBack(tabId));
  ipcMain.handle(IPC_CHANNELS.NAVIGATION_FORWARD, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.goForward(tabId));
  ipcMain.handle(IPC_CHANNELS.NAVIGATION_RELOAD, (event, { tabId, hard }: { tabId: string; hard?: boolean }) => ctx(event).tabManager.reload(tabId, hard));
  ipcMain.handle(IPC_CHANNELS.NAVIGATION_STOP, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.stop(tabId));

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => ctx(event).window.minimize());
  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const w = ctx(event).window;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, (event) => ctx(event).window.close());

  ipcMain.handle(IPC_CHANNELS.APP_QUIT, () => process.exit(0));
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => '1.0.0');

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }: { key: string }) =>
    settingsManager.get(key as Parameters<typeof settingsManager.get>[0])
  );
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => settingsManager.getAll());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (event, { key, value }: { key: string; value: unknown }) => {
    settingsManager.set(key as Parameters<typeof settingsManager.set>[0], value as never);
    ctx(event).window.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, { key, value });
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, (_event, { key }: { key?: string }) =>
    settingsManager.reset(key as Parameters<typeof settingsManager.reset>[0])
  );

  ipcMain.handle(IPC_CHANNELS.BOOKMARK_GET_TREE, () => bookmarkManager.getTree());
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_ADD, (_event, { url, title, parentId }: { url: string; title: string; parentId?: string }) =>
    bookmarkManager.add(url, title, parentId)
  );
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_REMOVE, (_event, { bookmarkId }: { bookmarkId: string }) => bookmarkManager.remove(bookmarkId));
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_MOVE, (_event, { bookmarkId, parentId, index }: { bookmarkId: string; parentId: string; index: number }) =>
    bookmarkManager.move(bookmarkId, parentId, index)
  );
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_UPDATE, (_event, { bookmarkId, changes }: { bookmarkId: string; changes: Partial<import('../../src/types/browser').Bookmark> }) =>
    bookmarkManager.update(bookmarkId, changes)
  );
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_IMPORT, (_event, { data }: { data: string }) => bookmarkManager.import(data));
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_EXPORT, () => bookmarkManager.export());

  ipcMain.handle(IPC_CHANNELS.HISTORY_SEARCH, (_event, { query, limit }: { query: string; limit?: number }) => historyManager.search(query, limit));
  ipcMain.handle(IPC_CHANNELS.HISTORY_GET_RECENT, (_event, { limit }: { limit?: number }) => historyManager.getRecent(limit));
  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, (_event, { range }: { range?: string }) => historyManager.clear(range));

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PAUSE, (_event, { downloadId }: { downloadId: string }) => downloadManager.pause(downloadId));
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_RESUME, (_event, { downloadId }: { downloadId: string }) => downloadManager.resume(downloadId));
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CANCEL, (_event, { downloadId }: { downloadId: string }) => downloadManager.cancel(downloadId));
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_CLEAR_COMPLETED, () => downloadManager.clearCompleted());

  ipcMain.handle(IPC_CHANNELS.FIND_START, (event, { tabId, text, caseSensitive }: { tabId: string; text: string; caseSensitive?: boolean }) => {
    const view = ctx(event).tabManager.getBrowserView(tabId);
    if (!view) return;
    return view.webContents.findInPage(text, { caseSensitive });
  });
  ipcMain.handle(IPC_CHANNELS.FIND_NEXT, (event, { tabId, forward }: { tabId: string; forward?: boolean }) => {
    const view = ctx(event).tabManager.getBrowserView(tabId);
    if (!view) return;
    view.webContents.findInPage('', { forward });
  });
  ipcMain.handle(IPC_CHANNELS.FIND_STOP, (event, { tabId }: { tabId: string }) => {
    const view = ctx(event).tabManager.getBrowserView(tabId);
    if (!view) return;
    view.webContents.stopFindInPage('clearSelection');
  });

  ipcMain.handle(IPC_CHANNELS.PASSWORD_GET_ALL, () => passwordManager.getAll());
  ipcMain.handle(IPC_CHANNELS.PASSWORD_SAVE, (_event, { entry }: { entry: import('../../src/types/browser').PasswordEntry }) => passwordManager.saveEntry(entry));
  ipcMain.handle(IPC_CHANNELS.PASSWORD_REMOVE, (_event, { origin, username }: { origin: string; username: string }) => passwordManager.remove(origin, username));
  ipcMain.handle(IPC_CHANNELS.PASSWORD_GET_FOR_ORIGIN, (_event, { origin }: { origin: string }) => passwordManager.getForOrigin(origin));

  ipcMain.handle(IPC_CHANNELS.AUTOFILL_GET_ADDRESSES, () => autofillManager.getAddresses());
  ipcMain.handle(IPC_CHANNELS.AUTOFILL_SAVE_ADDRESS, (_event, { address }: { address: import('../../src/types/browser').SavedAddress }) => autofillManager.saveAddress(address));
  ipcMain.handle(IPC_CHANNELS.AUTOFILL_REMOVE_ADDRESS, (_event, { addressId }: { addressId: string }) => autofillManager.removeAddress(addressId));

  ipcMain.handle(IPC_CHANNELS.ZOOM_SET, (event, { tabId, level }: { tabId: string; level: number }) => ctx(event).tabManager.setZoom(tabId, level));
  ipcMain.handle(IPC_CHANNELS.ZOOM_RESET, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.setZoom(tabId, 1.0));
  ipcMain.handle(IPC_CHANNELS.DEVTOOLS_TOGGLE, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.toggleDevTools(tabId));
  ipcMain.handle(IPC_CHANNELS.DEVTOOLS_OPEN, (event, { tabId, mode }: { tabId: string; mode: 'right' | 'bottom' | 'undocked' }) => ctx(event).tabManager.openDevTools(tabId, mode));
  ipcMain.handle(IPC_CHANNELS.PRINT_START, (event, { tabId }: { tabId: string }) => ctx(event).tabManager.print(tabId));
  ipcMain.handle(IPC_CHANNELS.PRINT_TO_PDF, (event, { tabId, outputPath }: { tabId: string; outputPath: string }) => ctx(event).tabManager.printToPDF(tabId, outputPath));
}
