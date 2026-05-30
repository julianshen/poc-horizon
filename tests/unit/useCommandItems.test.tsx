// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { useCommandItems } from "@/hooks/useCommandItems";
import { useBrowserStore } from "@/stores/browserStore";
import type { Tab } from "@/types/browser";

const tab = (id: string, title = id): Tab => ({
  id,
  schemaVersion: 1,
  url: `https://${id}`,
  title,
  isLoading: false,
  loadProgress: 0,
  canGoBack: false,
  canGoForward: false,
  isPinned: false,
  isMuted: false,
  isActive: false,
  isHibernated: false,
  zoomLevel: 1,
  createdAt: 0,
  lastAccessedAt: 0,
});

describe("useCommandItems", () => {
  const { api } = setupRendererTest();

  it("always includes the sticky Ask Horizon row, even with no match", () => {
    const { result } = renderHook(() =>
      useCommandItems("asdfqwertynevermatch", () => {}),
    );
    expect(result.current[0].kind).toBe("ai");
    expect(
      result.current.every(
        (it) =>
          it.kind === "ai" ||
          it.label.toLowerCase().includes("asdfqwertynevermatch"),
      ),
    ).toBe(true);
  });

  it("exposes a Switch-to row for each open tab", () => {
    act(() => useBrowserStore.setState({ tabs: [tab("a"), tab("b")] }));
    const { result } = renderHook(() => useCommandItems("", () => {}));
    const switches = result.current.filter((it) => it.kind === "tab");
    expect(switches).toHaveLength(2);
  });

  it("panel rows invoke toggleOverlay and close", () => {
    let closed = false;
    const close = (): void => {
      closed = true;
    };
    const { result } = renderHook(() => useCommandItems("", close));
    const bookmarks = result.current.find(
      (it) => it.label === "Open Bookmarks",
    );
    expect(bookmarks).toBeDefined();
    act(() => bookmarks!.action());
    expect(closed).toBe(true);
    expect(useBrowserStore.getState().showBookmarks).toBe(true);
  });

  it("Reload current tab dispatches navigation:reload when there is an active tab", () => {
    act(() => useBrowserStore.setState({ activeTabId: "x" }));
    const { result } = renderHook(() => useCommandItems("", () => {}));
    const reload = result.current.find(
      (it) => it.label === "Reload current tab",
    );
    act(() => reload!.action());
    expect(api().invokes).toContainEqual({
      channel: "navigation:reload",
      payload: { tabId: "x" },
    });
  });

  it("exposes a 'Learn this page's actions' command whose action requests learn + closes", () => {
    const close = vi.fn();
    const { result } = renderHook(() => useCommandItems("", close));
    const item = result.current.find(
      (i) => i.label === "Learn this page's actions",
    );
    expect(item).toBeTruthy();
    act(() => item!.action());
    expect(useBrowserStore.getState().pendingLearnRequest).toBe(true);
    expect(useBrowserStore.getState().showAI).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
