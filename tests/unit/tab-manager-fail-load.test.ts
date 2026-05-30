// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// Stub electron — we capture the did-fail-load handler registered on the
// tab's webContents and invoke it directly with simulated frame failures.
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

type FailHandler = (
  e: unknown,
  code: number,
  desc: string,
  url: string,
  isMainFrame?: boolean,
) => void;

function failHandlerFor(tm: TabManager, tabId: string) {
  const wc = (
    tm as unknown as {
      tabs: Map<
        string,
        {
          view: {
            webContents: {
              on: ReturnType<typeof vi.fn>;
              loadURL: ReturnType<typeof vi.fn>;
            };
          };
        }
      >;
    }
  ).tabs.get(tabId)!.view.webContents;
  const call = wc.on.mock.calls.find((c: unknown[]) => c[0] === "did-fail-load");
  return { wc, fail: call![1] as FailHandler };
}

function newManager() {
  return new TabManager(fakeWindow(), {
    kind: "default",
    historyManager: fakeHistory(),
  });
}

describe("TabManager did-fail-load", () => {
  it("ignores SUBFRAME failures — does not replace the page with horizon://error", () => {
    const tm = newManager();
    const t = tm.createTab("https://studio.workspace.google.com");
    const { wc, fail } = failHandlerFor(tm, t.id);
    // Google's cookie-rotation iframe blocked (ERR_BLOCKED_BY_RESPONSE) in a
    // subframe — must NOT blank the whole page.
    fail(
      {},
      -27,
      "ERR_BLOCKED_BY_RESPONSE",
      "https://accounts.google.com/RotateCookiesPage",
      false,
    );
    expect(wc.loadURL).not.toHaveBeenCalledWith(
      expect.stringContaining("horizon://error"),
    );
  });

  it("still shows the error page for a MAIN-frame failure", () => {
    const tm = newManager();
    const t = tm.createTab("https://example.com");
    const { wc, fail } = failHandlerFor(tm, t.id);
    fail({}, -27, "ERR_BLOCKED_BY_RESPONSE", "https://blocked.example", true);
    expect(wc.loadURL).toHaveBeenCalledWith(
      expect.stringContaining("horizon://error"),
    );
  });

  it("ignores ERR_ABORTED (-3) even on the main frame", () => {
    const tm = newManager();
    const t = tm.createTab("https://example.com");
    const { wc, fail } = failHandlerFor(tm, t.id);
    fail({}, -3, "ERR_ABORTED", "https://example.com", true);
    expect(wc.loadURL).not.toHaveBeenCalledWith(
      expect.stringContaining("horizon://error"),
    );
  });
});
