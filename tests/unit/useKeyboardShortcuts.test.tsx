// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useBrowserStore } from "@/stores/browserStore";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";

function press(key: string): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    ctrlKey: true,
    cancelable: true,
  });
  window.dispatchEvent(ev);
  return ev;
}

describe("useKeyboardShortcuts", () => {
  const { api } = setupRendererTest();
  const initialState = useBrowserStore.getState();

  it("Cmd/Ctrl+T invokes tab:create", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    const ev = press("t");
    expect(ev.defaultPrevented).toBe(true);
    expect(api().invokes).toEqual([{ channel: "tab:create", payload: {} }]);
  });

  it("Cmd/Ctrl+W invokes tab:close with the active tab id", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    press("w");
    expect(api().invokes).toEqual([
      { channel: "tab:close", payload: { tabId: "a" } },
    ]);
  });

  it("Cmd/Ctrl+W is a no-op when there is no active tab", () => {
    renderHook(() => useKeyboardShortcuts());
    press("w");
    expect(api().invokes).toEqual([]);
  });

  it("Cmd/Ctrl+L focuses the first input element", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    renderHook(() => useKeyboardShortcuts());
    press("l");
    expect(document.activeElement).toBe(input);
    document.body.removeChild(input);
  });

  it("Cmd/Ctrl+R invokes navigation:reload", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    press("r");
    expect(api().invokes).toEqual([
      { channel: "navigation:reload", payload: { tabId: "a" } },
    ]);
  });

  it("Cmd/Ctrl+F toggles the find bar overlay", () => {
    renderHook(() => useKeyboardShortcuts());
    press("f");
    expect(useBrowserStore.getState().showFindBar).toBe(true);
    press("f");
    expect(useBrowserStore.getState().showFindBar).toBe(false);
  });

  it("Cmd/Ctrl+, toggles the settings overlay", () => {
    renderHook(() => useKeyboardShortcuts());
    press(",");
    expect(useBrowserStore.getState().showSettings).toBe(true);
  });

  it("accepts ctrlKey-only on non-macOS (the right side of || in `mod`)", () => {
    renderHook(() => useKeyboardShortcuts());
    const ev = new KeyboardEvent("keydown", {
      key: "t",
      ctrlKey: true,
      metaKey: false,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(api().invokes).toEqual([{ channel: "tab:create", payload: {} }]);
  });

  it("unbound keys with the modifier are ignored", () => {
    renderHook(() => useKeyboardShortcuts());
    const ev = press("q");
    expect(ev.defaultPrevented).toBe(false);
    expect(api().invokes).toEqual([]);
  });

  it("Cmd/Ctrl+Shift+N invokes window:newIncognito", () => {
    renderHook(() => useKeyboardShortcuts());
    const ev = new KeyboardEvent("keydown", {
      key: "N",
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(api().invokes).toContainEqual({
      channel: "window:newIncognito",
      payload: {},
    });
  });

  it("Cmd/Ctrl+K toggles the command palette", () => {
    renderHook(() => useKeyboardShortcuts());
    press("k");
    expect(useBrowserStore.getState().showCmd).toBe(true);
  });

  it("Cmd/Ctrl+J toggles the downloads shelf", () => {
    renderHook(() => useKeyboardShortcuts());
    press("j");
    expect(useBrowserStore.getState().showDownloads).toBe(true);
  });

  it("Cmd/Ctrl+P invokes print:start for the active tab", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    press("p");
    expect(api().invokes).toContainEqual({
      channel: "print:start",
      payload: { tabId: "a" },
    });
  });

  it("Cmd/Ctrl+Shift+I invokes devtools:toggle for the active tab", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    const ev = new KeyboardEvent("keydown", {
      key: "I",
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(api().invokes).toContainEqual({
      channel: "devtools:toggle",
      payload: { tabId: "a" },
    });
  });

  it("Cmd/Ctrl+= and + zoom in to 1.2x", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    press("=");
    expect(api().invokes).toContainEqual({
      channel: "zoom:set",
      payload: { tabId: "a", level: 1.2 },
    });
  });

  it("Cmd/Ctrl+- zooms out to 0.9x", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    press("-");
    expect(api().invokes).toContainEqual({
      channel: "zoom:set",
      payload: { tabId: "a", level: 0.9 },
    });
  });

  it("Cmd/Ctrl+0 resets zoom on the active tab", () => {
    useBrowserStore.setState({ ...initialState, activeTabId: "a" });
    renderHook(() => useKeyboardShortcuts());
    press("0");
    expect(api().invokes).toContainEqual({
      channel: "zoom:reset",
      payload: { tabId: "a" },
    });
  });

  it("removes the keydown listener on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts());
    unmount();
    press("t");
    expect(api().invokes).toEqual([]);
  });
});
