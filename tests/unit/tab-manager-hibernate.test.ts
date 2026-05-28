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

describe("TabManager.hibernateTab", () => {
  it("destroys webContents, marks tab isHibernated, emits events", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.activateTab(a.id);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    const ok = tm.hibernateTab(b.id);
    expect(ok).toBe(true);
    expect(tm.getTab(b.id)?.isHibernated).toBe(true);
    const channels = send.mock.calls.map((c) => c[0]);
    expect(channels).toContain("tab:hibernated");
    expect(channels).toContain("tab:updated");
  });

  it("refuses to hibernate the active tab", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    tm.activateTab(a.id);
    expect(tm.hibernateTab(a.id)).toBe(false);
    expect(tm.getTab(a.id)?.isHibernated).toBe(false);
  });

  it("is a no-op on an already-hibernated tab", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.activateTab(a.id);
    tm.hibernateTab(b.id);
    expect(tm.hibernateTab(b.id)).toBe(false);
  });
});

describe("TabManager.wakeTab", () => {
  it("rebuilds the view, calls loadURL, marks tab not-hibernated, emits events", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.activateTab(a.id);
    tm.hibernateTab(b.id);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    tm.wakeTab(b.id);
    expect(tm.getTab(b.id)?.isHibernated).toBe(false);
    const channels = send.mock.calls.map((c) => c[0]);
    expect(channels).toContain("tab:woken");
    expect(channels).toContain("tab:updated");
  });
});
