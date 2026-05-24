// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// Stub electron — we only verify that setBounds is invoked with the rect
// the renderer reported. No real BrowserView is needed.
vi.mock('electron', () => ({
  BrowserView: class {
    webContents = {
      loadURL: vi.fn(),
      on: vi.fn(),
      setAudioMuted: vi.fn(),
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

describe('TabManager content bounds (renderer-reported rect)', () => {
  it('falls back to chrome-aware default bounds on activate before renderer reports', () => {
    const tm = new TabManager(fakeWindow(), { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    const view = (tm as unknown as { tabs: Map<string, { view: { setBounds: ReturnType<typeof vi.fn> } }> }).tabs.get(a.id)!.view;
    tm.activateTab(a.id);
    // fakeWindow is 1280x800; fallback = inset(12) + chromeHeight(146).
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 12, y: 146, width: 1256, height: 642 });
  });

  it('applies the reported rect to the active view immediately', () => {
    const tm = new TabManager(fakeWindow(), { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    tm.activateTab(a.id);
    const view = (tm as unknown as { tabs: Map<string, { view: { setBounds: ReturnType<typeof vi.fn> } }> }).tabs.get(a.id)!.view;
    tm.setContentBounds({ x: 12, y: 146, width: 880, height: 600 });
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 12, y: 146, width: 880, height: 600 });
  });

  it('rounds fractional rects (browser layout rects are floats)', () => {
    const tm = new TabManager(fakeWindow(), { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    tm.activateTab(a.id);
    const view = (tm as unknown as { tabs: Map<string, { view: { setBounds: ReturnType<typeof vi.fn> } }> }).tabs.get(a.id)!.view;
    tm.setContentBounds({ x: 12.4, y: 146.6, width: 880.5, height: 600.9 });
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 12, y: 147, width: 881, height: 601 });
  });

  it('clamps negative dimensions to 0 (defensive against transient layouts)', () => {
    const tm = new TabManager(fakeWindow(), { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    tm.activateTab(a.id);
    const view = (tm as unknown as { tabs: Map<string, { view: { setBounds: ReturnType<typeof vi.fn> } }> }).tabs.get(a.id)!.view;
    tm.setContentBounds({ x: 0, y: 0, width: -5, height: -10 });
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('re-applies the stored rect when a different tab becomes active', () => {
    const tm = new TabManager(fakeWindow(), { kind: 'default', historyManager: fakeHistory() });
    const a = tm.createTab('https://a');
    const b = tm.createTab('https://b');
    tm.activateTab(a.id);
    tm.setContentBounds({ x: 12, y: 146, width: 880, height: 600 });
    tm.activateTab(b.id);
    const viewB = (tm as unknown as { tabs: Map<string, { view: { setBounds: ReturnType<typeof vi.fn> } }> }).tabs.get(b.id)!.view;
    expect(viewB.setBounds).toHaveBeenLastCalledWith({ x: 12, y: 146, width: 880, height: 600 });
  });

  it('does nothing when no tab is active', () => {
    const tm = new TabManager(fakeWindow(), { kind: 'default', historyManager: fakeHistory() });
    // No throw, no side-effects.
    expect(() => tm.setContentBounds({ x: 0, y: 0, width: 100, height: 100 })).not.toThrow();
  });
});
