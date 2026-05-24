// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserView: class {
    webContents = {
      loadURL: vi.fn(),
      on: vi.fn(),
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    setBounds = vi.fn();
    setAutoResize = vi.fn();
  },
  BrowserWindow: class {},
}));

import { TabManager } from '@electron/services/TabManager';

function fakeWindow() {
  return {
    isDestroyed: () => false,
    addBrowserView: vi.fn(),
    removeBrowserView: vi.fn(),
    webContents: { send: vi.fn(), isDestroyed: () => false },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    close: vi.fn(),
  } as unknown as import('electron').BrowserWindow;
}

function fakeHistory() {
  return { addEntry: vi.fn() } as unknown as import('../../.electron/services/HistoryManager').HistoryManager;
}

describe('TabManager: Tab Groups', () => {
  it('createGroup creates a group, assigns the supplied tabs, and emits tabGroup:created', () => {
    const win = fakeWindow();
    const tm = new TabManager(win, { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    const b = tm.createTab('https://b');
    const send = win.webContents.send as unknown as ReturnType<typeof vi.fn>;
    send.mockClear();

    const group = tm.createGroup('Research', 'blue', [a.id, b.id]);
    expect(group.name).toBe('Research');
    expect(group.color).toBe('blue');
    expect(tm.getTab(a.id)?.groupId).toBe(group.id);
    expect(tm.getTab(b.id)?.groupId).toBe(group.id);
    const channels = send.mock.calls.map((c) => c[0]);
    expect(channels).toContain('tabGroup:created');
  });

  it('updateGroup changes name/color and emits tabGroup:updated', () => {
    const win = fakeWindow();
    const tm = new TabManager(win, { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    const group = tm.createGroup('Old', 'grey', [a.id]);
    const send = win.webContents.send as unknown as ReturnType<typeof vi.fn>;
    send.mockClear();

    tm.updateGroup(group.id, { name: 'New', color: 'green' });
    const updated = tm.getAllGroups().find((g) => g.id === group.id);
    expect(updated?.name).toBe('New');
    expect(updated?.color).toBe('green');
    const channels = send.mock.calls.map((c) => c[0]);
    expect(channels).toContain('tabGroup:updated');
  });

  it('deleteGroup removes the group and clears groupId on its tabs', () => {
    const win = fakeWindow();
    const tm = new TabManager(win, { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    const b = tm.createTab('https://b');
    const group = tm.createGroup('G', 'red', [a.id, b.id]);

    tm.deleteGroup(group.id);
    expect(tm.getAllGroups()).toHaveLength(0);
    expect(tm.getTab(a.id)?.groupId).toBeUndefined();
    expect(tm.getTab(b.id)?.groupId).toBeUndefined();
  });

  it('assignTabToGroup adds a tab to an existing group', () => {
    const win = fakeWindow();
    const tm = new TabManager(win, { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    const b = tm.createTab('https://b');
    const group = tm.createGroup('G', 'pink', [a.id]);

    tm.assignTabToGroup(b.id, group.id);
    expect(tm.getTab(b.id)?.groupId).toBe(group.id);
  });

  it('removeTabFromGroup clears the tab\'s groupId without affecting other tabs', () => {
    const win = fakeWindow();
    const tm = new TabManager(win, { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    const b = tm.createTab('https://b');
    const group = tm.createGroup('G', 'cyan', [a.id, b.id]);

    tm.removeTabFromGroup(a.id);
    expect(tm.getTab(a.id)?.groupId).toBeUndefined();
    expect(tm.getTab(b.id)?.groupId).toBe(group.id);
    expect(tm.getAllGroups()).toHaveLength(1);
  });

  it('assignTabToGroup is a no-op for unknown group', () => {
    const win = fakeWindow();
    const tm = new TabManager(win, { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    tm.assignTabToGroup(a.id, 'nonexistent');
    expect(tm.getTab(a.id)?.groupId).toBeUndefined();
  });
});
