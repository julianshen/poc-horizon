// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// Stub electron — we exercise the reorder algorithm purely against the
// in-memory tabs Map, no real BrowserView needed.
vi.mock("electron", () => ({
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

import { TabManager } from "@electron/services/TabManager";

function fakeWindow() {
  return {
    isDestroyed: () => false,
    addBrowserView: vi.fn(),
    removeBrowserView: vi.fn(),
    webContents: { send: vi.fn(), isDestroyed: () => false },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    close: vi.fn(),
  } as unknown as import("electron").BrowserWindow;
}

function fakeHistory() {
  return {
    addEntry: vi.fn(),
  } as unknown as import("../../.electron/services/HistoryManager").HistoryManager;
}

describe("TabManager.reorder pinned-boundary clamp", () => {
  it("clamps a pinned tab into the pinned region", () => {
    const tm = new TabManager(fakeWindow(), {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    const c = tm.createTab("https://c");
    const d = tm.createTab("https://d");
    tm.setPinned(a.id, true);
    tm.setPinned(b.id, true);
    // Trying to move pinned `a` past the pinned/unpinned boundary should
    // clamp it to index 1 (last pinned slot).
    tm.reorder(a.id, 3);
    expect(tm.getAllTabs().map((t) => t.id)).toEqual([b.id, a.id, c.id, d.id]);
  });

  it("clamps an unpinned tab to stay below the pinned region", () => {
    const tm = new TabManager(fakeWindow(), {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    const c = tm.createTab("https://c");
    const d = tm.createTab("https://d");
    tm.setPinned(a.id, true);
    tm.setPinned(b.id, true);
    // c is unpinned; asking for index 0 should clamp to 2 (first unpinned slot).
    tm.reorder(c.id, 0);
    expect(tm.getAllTabs().map((t) => t.id)).toEqual([a.id, b.id, c.id, d.id]);
    tm.reorder(d.id, 0);
    expect(tm.getAllTabs().map((t) => t.id)).toEqual([a.id, b.id, d.id, c.id]);
  });

  it("moves within the pinned region as expected", () => {
    const tm = new TabManager(fakeWindow(), {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.setPinned(a.id, true);
    tm.setPinned(b.id, true);
    tm.reorder(b.id, 0);
    expect(tm.getAllTabs().map((t) => t.id)).toEqual([b.id, a.id]);
  });
});
