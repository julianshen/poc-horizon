import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from './channels';
import { TabManager } from '../services/TabManager';
import { SettingsManager } from '../services/SettingsManager';

export function registerIpcHandlers(tabManager: TabManager, window: BrowserWindow, settingsManager: SettingsManager): void {
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
}
