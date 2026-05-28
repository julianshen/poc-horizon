// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserView: class {
    webContents = {
      loadURL: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      isLoading: vi.fn(() => false),
      isCurrentlyAudible: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      destroy: vi.fn(),
      session: { on: vi.fn() },
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
      },
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
    setBrowserView: vi.fn(),
    webContents: { send: vi.fn(), isDestroyed: () => false },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    close: vi.fn(),
  } as unknown as import("electron").BrowserWindow;
}

function fakeHistory() {
  return { addEntry: vi.fn() } as unknown as
    import("../../.electron/services/HistoryManager").HistoryManager;
}

describe("TabManager: null-view tolerance", () => {
  it("new tab record has isHibernated=false", () => {
    const tm = new TabManager(fakeWindow(), {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const t = tm.createTab("https://example.com");
    expect(t.isHibernated).toBe(false);
  });
});
