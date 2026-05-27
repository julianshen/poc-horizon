// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTabs } from "@/hooks/useTabs";
import { useBrowserStore } from "@/stores/browserStore";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import type { Tab } from "@/types/browser";

const sampleTab = (id: string): Tab => ({
  id,
  schemaVersion: 1,
  url: `https://${id}.example`,
  title: `Tab ${id}`,
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

describe("useTabs", () => {
  const { api } = setupRendererTest();

  it("appends a new tab and activates it on tab:created", () => {
    renderHook(() => useTabs());
    api().emit("tab:created", sampleTab("a"));
    const s = useBrowserStore.getState();
    expect(s.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(s.activeTabId).toBe("a");
  });

  it("removes a tab on tab:closed", () => {
    useBrowserStore.getState().setTabs([sampleTab("a"), sampleTab("b")]);
    renderHook(() => useTabs());
    api().emit("tab:closed", { tabId: "a" });
    expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(["b"]);
  });

  it("switches active tab on tab:activated", () => {
    useBrowserStore.getState().setTabs([sampleTab("a"), sampleTab("b")]);
    renderHook(() => useTabs());
    api().emit("tab:activated", { tabId: "b" });
    expect(useBrowserStore.getState().activeTabId).toBe("b");
  });

  it("patches a tab on tab:updated using the embedded id", () => {
    useBrowserStore.getState().setTabs([sampleTab("a")]);
    renderHook(() => useTabs());
    api().emit("tab:updated", { id: "a", title: "Renamed" });
    expect(useBrowserStore.getState().tabs[0].title).toBe("Renamed");
  });

  it("strips tabId from navigation:state before patching", () => {
    useBrowserStore.getState().setTabs([sampleTab("a")]);
    renderHook(() => useTabs());
    api().emit("navigation:state", {
      tabId: "a",
      canGoBack: true,
      canGoForward: false,
      isLoading: true,
      url: "https://updated.example",
    });
    const tab = useBrowserStore.getState().tabs[0];
    expect(tab.canGoBack).toBe(true);
    expect(tab.isLoading).toBe(true);
    expect(tab.url).toBe("https://updated.example");
    expect((tab as unknown as { tabId?: string }).tabId).toBeUndefined();
  });

  it("marks a tab loading + resets progress on load:started, completes on load:finished", () => {
    useBrowserStore.getState().setTabs([sampleTab("a")]);
    renderHook(() => useTabs());
    api().emit("load:started", { tabId: "a", url: "https://a.example/new" });
    let tab = useBrowserStore.getState().tabs[0];
    expect(tab.isLoading).toBe(true);
    expect(tab.loadProgress).toBe(0);
    expect(tab.url).toBe("https://a.example/new");
    api().emit("load:finished", { tabId: "a", url: "https://a.example/new" });
    tab = useBrowserStore.getState().tabs[0];
    expect(tab.isLoading).toBe(false);
    expect(tab.loadProgress).toBe(100);
  });

  it("updates title on page:title and favicon on page:favicon", () => {
    useBrowserStore.getState().setTabs([sampleTab("a")]);
    renderHook(() => useTabs());
    api().emit("page:title", { tabId: "a", title: "Doc Title" });
    api().emit("page:favicon", {
      tabId: "a",
      faviconUrl: "https://a.example/favicon.ico",
    });
    const tab = useBrowserStore.getState().tabs[0];
    expect(tab.title).toBe("Doc Title");
    expect(tab.favicon).toBe("https://a.example/favicon.ico");
  });

  it("subscribes to 9 channels on mount and unsubscribes all on unmount", () => {
    const channels = [
      "tab:created",
      "tab:closed",
      "tab:activated",
      "tab:updated",
      "navigation:state",
      "load:started",
      "load:finished",
      "page:title",
      "page:favicon",
    ];
    const { unmount } = renderHook(() => useTabs());
    for (const c of channels)
      expect(api().listenerCount(c), `mount ${c}`).toBe(1);
    unmount();
    for (const c of channels)
      expect(api().listenerCount(c), `unmount ${c}`).toBe(0);
  });
});
