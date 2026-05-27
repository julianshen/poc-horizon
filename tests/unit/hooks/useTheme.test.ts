// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useTheme } from "@/hooks/useTheme";
import { setupRendererTest } from "../../helpers/fakeHorizonAPI";

const { api } = setupRendererTest();

describe("useTheme", () => {
  let originalDataset: string | undefined;

  beforeEach(() => {
    originalDataset = document.documentElement.dataset.theme;
    delete document.documentElement.dataset.theme;
    document.getElementById("accent-override")?.remove();

    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    if (originalDataset !== undefined) {
      document.documentElement.dataset.theme = originalDataset;
    } else {
      delete document.documentElement.dataset.theme;
    }
    document.getElementById("accent-override")?.remove();
    vi.unstubAllGlobals();
  });

  it("sets dataset.theme from settings on mount", async () => {
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: "ocean", accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("ocean");
  });

  it("resolves system to dia on light OS", async () => {
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: "system", accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");
  });

  it("injects accent-override style when accentColor is set", async () => {
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: "dia", accentColor: "#ff0000" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    const tag = document.getElementById("accent-override") as HTMLStyleElement;
    expect(tag).toBeTruthy();
    expect(tag.textContent).toContain("--accent-primary: #ff0000");
  });

  it("removes accent-override when accentColor is empty", async () => {
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: "dia", accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.getElementById("accent-override")).toBeNull();
  });

  it("reacts to settings:changed event for theme", async () => {
    let currentTheme = "dia";
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: currentTheme, accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");

    currentTheme = "forest";
    api().emit("settings:changed", { key: "theme", value: "forest" });
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("forest");
  });

  it("reacts to settings:changed event for accentColor", async () => {
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: "dia", accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.getElementById("accent-override")).toBeNull();

    api().emit("settings:changed", { key: "accentColor", value: "#00ff00" });
    await new Promise((r) => setTimeout(r, 10));

    const tag = document.getElementById("accent-override") as HTMLStyleElement;
    expect(tag).toBeTruthy();
    expect(tag.textContent).toContain("--accent-primary: #00ff00");
  });

  it("falls back to defaults when settings:getAll rejects", async () => {
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.reject(new Error("IPC error"));
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");
  });

  it("detaches matchMedia listener when switching from system to named preset", async () => {
    const removeEventListener = vi.fn();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener,
        dispatchEvent: vi.fn(),
      })),
    );

    let currentTheme = "system";
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: currentTheme, accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");

    currentTheme = "ocean";
    api().emit("settings:changed", { key: "theme", value: "ocean" });
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("ocean");
    expect(removeEventListener).toHaveBeenCalled();
  });

  it("attaches matchMedia listener when switching from named preset to system", async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "",
        addEventListener,
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    let currentTheme = "ocean";
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: currentTheme, accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("ocean");
    expect(addEventListener).not.toHaveBeenCalled();

    currentTheme = "system";
    api().emit("settings:changed", { key: "theme", value: "system" });
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");
    expect(addEventListener).toHaveBeenCalled();
  });

  it("updates theme when OS dark mode changes in system mode", async () => {
    let darkMode = false;
    let changeCallback: (() => void) | null = null;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return darkMode;
        },
        media: "",
        addEventListener: (_event: string, cb: () => void) => {
          changeCallback = cb;
        },
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    api().invoke.mockImplementation((channel: string) => {
      if (channel === "settings:getAll") {
        return Promise.resolve({ theme: "system", accentColor: "" });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useTheme());
    await new Promise((r) => setTimeout(r, 10));

    expect(document.documentElement.dataset.theme).toBe("dia");

    darkMode = true;
    if (changeCallback) changeCallback();

    expect(document.documentElement.dataset.theme).toBe("midnight");
  });
});
