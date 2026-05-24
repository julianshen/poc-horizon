import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from './channels';
import { TabManager } from '../services/TabManager';
import { SettingsManager } from '../services/SettingsManager';
import { BookmarkManager } from '../services/BookmarkManager';
import { HistoryManager } from '../services/HistoryManager';
import { DownloadManager } from '../services/DownloadManager';
import { PasswordManager } from '../services/PasswordManager';
import { AutofillManager } from '../services/AutofillManager';
import type { IpcChannels } from '../../src/types/ipc';

export interface WindowContext {
  tabManager: TabManager;
  window: BrowserWindow;
}

/**
 * Bag of process-global services shared by every IPC handler. The
 * window-bound pair (tabManager + window) is *not* here — that comes
 * from the per-event resolver so multi-window setups route correctly.
 */
export interface IpcDeps {
  settingsManager: SettingsManager;
  bookmarkManager: BookmarkManager;
  historyManager: HistoryManager;
  downloadManager: DownloadManager;
  passwordManager: PasswordManager;
  autofillManager: AutofillManager;
}

/** Resolves the per-event WindowContext from the sender's webContents. */
export type ContextResolver = (event: IpcMainInvokeEvent) => WindowContext;

/**
 * Type-safe `ipcMain.handle` wrapper: the payload arg is derived from
 * `IpcChannels[K]`, so any future drift between the channel map and the
 * actual handler signature fails at compile time instead of at runtime.
 */
function handle<K extends keyof IpcChannels>(
  channel: K,
  fn: (event: IpcMainInvokeEvent, payload: IpcChannels[K]) => unknown
): void {
  ipcMain.handle(channel, (event, payload) => fn(event, payload as IpcChannels[K]));
}

/**
 * Register all IPC handlers. Call this exactly once at app start.
 *
 * The `resolveContext` function maps each event's sender to the right
 * window's TabManager + BrowserWindow. Existing tests call this with a
 * resolver that always returns the same mock; main.ts uses a sender →
 * webContents.id lookup so a multi-window (e.g. regular + incognito)
 * setup routes correctly.
 */
export function registerIpcHandlers(deps: IpcDeps, resolveContext: ContextResolver): void {
  const ctx = (event: IpcMainInvokeEvent): WindowContext => resolveContext(event);
  const { settingsManager, bookmarkManager, historyManager, downloadManager, passwordManager, autofillManager } = deps;

  handle('tab:create', (event, { url }) => ctx(event).tabManager.createTab(url));
  handle('tab:close', (event, { tabId }) => ctx(event).tabManager.closeTab(tabId));
  handle('tab:activate', (event, { tabId }) => ctx(event).tabManager.activateTab(tabId));
  handle('tab:pin', (event, { tabId, pinned }) => ctx(event).tabManager.setPinned(tabId, pinned));
  handle('tab:mute', (event, { tabId }) => ctx(event).tabManager.setMuted(tabId, true));
  handle('tab:unmute', (event, { tabId }) => ctx(event).tabManager.setMuted(tabId, false));
  handle('tab:duplicate', (event, { tabId }) => ctx(event).tabManager.duplicate(tabId));
  handle('tab:reorder', (event, { tabId, index }) => ctx(event).tabManager.reorder(tabId, index));

  handle('tabGroup:create', (event, { name, color, tabIds }) =>
    ctx(event).tabManager.createGroup(name, color, tabIds ?? [])
  );
  handle('tabGroup:update', (event, { groupId, changes }) =>
    ctx(event).tabManager.updateGroup(groupId, changes)
  );
  handle('tabGroup:delete', (event, { groupId }) => ctx(event).tabManager.deleteGroup(groupId));
  handle('tabGroup:addTab', (event, { groupId, tabId }) =>
    ctx(event).tabManager.assignTabToGroup(tabId, groupId)
  );
  handle('tabGroup:removeTab', (event, { tabId }) => ctx(event).tabManager.removeTabFromGroup(tabId));

  handle('navigation:go', (event, { tabId, url }) => ctx(event).tabManager.navigate(tabId, url));
  handle('navigation:back', (event, { tabId }) => ctx(event).tabManager.goBack(tabId));
  handle('navigation:forward', (event, { tabId }) => ctx(event).tabManager.goForward(tabId));
  handle('navigation:reload', (event, { tabId, hard }) => ctx(event).tabManager.reload(tabId, hard));
  handle('navigation:stop', (event, { tabId }) => ctx(event).tabManager.stop(tabId));

  handle('window:minimize', (event) => ctx(event).window.minimize());
  handle('window:maximize', (event) => {
    const w = ctx(event).window;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  handle('window:close', (event) => ctx(event).window.close());

  handle('app:quit', () => process.exit(0));
  handle('app:getVersion', () => '1.0.0');

  handle('settings:get', (_event, { key }) =>
    settingsManager.get(key as Parameters<typeof settingsManager.get>[0])
  );
  handle('settings:getAll', () => settingsManager.getAll());
  handle('settings:set', (event, { key, value }) => {
    settingsManager.set(key as Parameters<typeof settingsManager.set>[0], value as never);
    ctx(event).window.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, { key, value });
  });
  handle('settings:reset', (_event, payload) =>
    settingsManager.reset((payload as { key?: string }).key as Parameters<typeof settingsManager.reset>[0])
  );

  handle('bookmark:getTree', () => bookmarkManager.getTree());
  handle('bookmark:add', (_event, { url, title, parentId }) => bookmarkManager.add(url, title, parentId));
  handle('bookmark:remove', (_event, { bookmarkId }) => bookmarkManager.remove(bookmarkId));
  handle('bookmark:move', (_event, { bookmarkId, parentId, index }) => bookmarkManager.move(bookmarkId, parentId, index));
  handle('bookmark:update', (_event, { bookmarkId, changes }) => bookmarkManager.update(bookmarkId, changes));
  handle('bookmark:import', (_event, { data }) => bookmarkManager.import(data));
  handle('bookmark:export', () => bookmarkManager.export());

  handle('history:search', (_event, { query, limit }) => historyManager.search(query, limit));
  handle('history:getRecent', (_event, { limit }) => historyManager.getRecent(limit));
  handle('history:clear', (_event, { range }) => historyManager.clear(range));

  handle('download:pause', (_event, { downloadId }) => downloadManager.pause(downloadId));
  handle('download:resume', (_event, { downloadId }) => downloadManager.resume(downloadId));
  handle('download:cancel', (_event, { downloadId }) => downloadManager.cancel(downloadId));
  handle('download:clearCompleted', () => downloadManager.clearCompleted());

  handle('find:start', (event, { tabId, text, caseSensitive }) => {
    const view = ctx(event).tabManager.getBrowserView(tabId);
    if (!view) return;
    return view.webContents.findInPage(text, { caseSensitive });
  });
  handle('find:next', (event, { tabId, forward }) => {
    const view = ctx(event).tabManager.getBrowserView(tabId);
    if (!view) return;
    view.webContents.findInPage('', { forward });
  });
  handle('find:stop', (event, { tabId }) => {
    const view = ctx(event).tabManager.getBrowserView(tabId);
    if (!view) return;
    view.webContents.stopFindInPage('clearSelection');
  });

  handle('password:getAll', () => passwordManager.getAll());
  handle('password:save', (_event, { entry }) => passwordManager.saveEntry(entry));
  handle('password:remove', (_event, { origin, username }) => passwordManager.remove(origin, username));
  handle('password:getForOrigin', (_event, { origin }) => passwordManager.getForOrigin(origin));

  handle('autofill:getAddresses', () => autofillManager.getAddresses());
  handle('autofill:saveAddress', (_event, { address }) => autofillManager.saveAddress(address));
  handle('autofill:removeAddress', (_event, { addressId }) => autofillManager.removeAddress(addressId));

  handle('ui:contentBounds', (event, rect) => ctx(event).tabManager.setContentBounds(rect));

  handle('zoom:set', (event, { tabId, level }) => ctx(event).tabManager.setZoom(tabId, level));
  handle('zoom:reset', (event, { tabId }) => ctx(event).tabManager.setZoom(tabId, 1.0));
  handle('devtools:toggle', (event, { tabId }) => ctx(event).tabManager.toggleDevTools(tabId));
  handle('devtools:open', (event, { tabId, mode }) =>
    ctx(event).tabManager.openDevTools(tabId, (mode ?? 'right') as 'right' | 'bottom' | 'undocked')
  );
  handle('print:start', (event, { tabId }) => ctx(event).tabManager.print(tabId));
  handle('print:toPDF', (event, { tabId, outputPath }) => ctx(event).tabManager.printToPDF(tabId, outputPath));
}
