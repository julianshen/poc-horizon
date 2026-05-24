import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron';
import type { TabManager } from './TabManager';

interface Deps {
  /** Lookup the TabManager of the currently focused window. */
  resolveTabManager: () => TabManager | null;
  /** Lookup the current focused window. */
  resolveWindow: () => BrowserWindow | null;
  /** Open a new top-level window (used for File → New Window). */
  openNewWindow: (opts?: { incognito?: boolean }) => void;
}

const isMac = process.platform === 'darwin';

/**
 * Tell the chrome renderer of the focused window to run a UI command —
 * used for actions the menu can't fulfill on its own (toggle a side
 * panel, focus the omnibox, etc.). The renderer listens on
 * 'menu:command' via the existing horizonAPI preload bridge.
 */
function sendMenuCommand(win: BrowserWindow | null, command: string): void {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send('menu:command', { command });
}

/** Build and install the application menu. Call once on app ready. */
export function installAppMenu(deps: Deps): void {
  const tabOf = (): TabManager | null => deps.resolveTabManager();
  const winOf = (): BrowserWindow | null => deps.resolveWindow();

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Tab',
        accelerator: 'CmdOrCtrl+T',
        click: () => { tabOf()?.createTab(); },
      },
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+N',
        click: () => deps.openNewWindow(),
      },
      {
        label: 'New Incognito Window',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => deps.openNewWindow({ incognito: true }),
      },
      { type: 'separator' },
      {
        label: 'Close Tab',
        accelerator: 'CmdOrCtrl+W',
        click: () => {
          const tm = tabOf();
          const id = tm?.getActiveTabId();
          if (tm && id) tm.closeTab(id);
        },
      },
      {
        label: 'Close Window',
        accelerator: 'CmdOrCtrl+Shift+W',
        role: 'close',
      },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Find in Page',
        accelerator: 'CmdOrCtrl+F',
        click: () => sendMenuCommand(winOf(), 'find:open'),
      },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click: () => {
          const tm = tabOf();
          const id = tm?.getActiveTabId();
          if (tm && id) tm.reload(id);
        },
      },
      {
        label: 'Force Reload',
        accelerator: 'CmdOrCtrl+Shift+R',
        click: () => {
          const tm = tabOf();
          const id = tm?.getActiveTabId();
          if (tm && id) tm.reload(id, true);
        },
      },
      { type: 'separator' },
      {
        label: 'Actual Size',
        accelerator: 'CmdOrCtrl+0',
        click: () => {
          const tm = tabOf();
          const id = tm?.getActiveTabId();
          if (tm && id) tm.setZoom(id, 1);
        },
      },
      {
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+=',
        click: () => bumpZoom(tabOf(), +0.1),
      },
      {
        label: 'Zoom Out',
        accelerator: 'CmdOrCtrl+-',
        click: () => bumpZoom(tabOf(), -0.1),
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      {
        label: 'Toggle Developer Tools',
        accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
        click: () => {
          const tm = tabOf();
          const id = tm?.getActiveTabId();
          if (tm && id) tm.toggleDevTools(id);
        },
      },
    ],
  };

  const historyMenu: MenuItemConstructorOptions = {
    label: 'History',
    submenu: [
      {
        label: 'Back',
        accelerator: 'CmdOrCtrl+[',
        click: () => {
          const tm = tabOf();
          const id = tm?.getActiveTabId();
          if (tm && id) tm.goBack(id);
        },
      },
      {
        label: 'Forward',
        accelerator: 'CmdOrCtrl+]',
        click: () => {
          const tm = tabOf();
          const id = tm?.getActiveTabId();
          if (tm && id) tm.goForward(id);
        },
      },
      { type: 'separator' },
      {
        label: 'Show All History',
        accelerator: 'CmdOrCtrl+Y',
        click: () => sendMenuCommand(winOf(), 'panel:history'),
      },
    ],
  };

  const bookmarksMenu: MenuItemConstructorOptions = {
    label: 'Bookmarks',
    submenu: [
      {
        label: 'Bookmark This Page',
        accelerator: 'CmdOrCtrl+D',
        click: () => sendMenuCommand(winOf(), 'bookmark:add'),
      },
      {
        label: 'Show All Bookmarks',
        accelerator: 'CmdOrCtrl+Shift+B',
        click: () => sendMenuCommand(winOf(), 'panel:bookmarks'),
      },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    role: 'windowMenu',
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    role: 'help',
    submenu: [
      {
        label: 'Horizon on GitHub',
        click: () => { void shell.openExternal('https://github.com/'); },
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    // macOS conventionally puts the app menu first with About/Quit etc.
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuCommand(winOf(), 'panel:settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(fileMenu, editMenu, viewMenu, historyMenu, bookmarksMenu, windowMenu, helpMenu);

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function bumpZoom(tm: TabManager | null, delta: number): void {
  if (!tm) return;
  const id = tm.getActiveTabId();
  if (!id) return;
  const tab = tm.getTab(id);
  if (!tab) return;
  const next = Math.min(3, Math.max(0.25, tab.zoomLevel + delta));
  tm.setZoom(id, next);
}
