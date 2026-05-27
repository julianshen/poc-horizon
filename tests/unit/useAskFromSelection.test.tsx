// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { useBrowserStore } from "@/stores/browserStore";
import { useAskFromSelection } from "@/hooks/useAskFromSelection";

describe("useAskFromSelection", () => {
  const { api } = setupRendererTest();

  it("subscribes to ai:askFromSelection on mount and unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useAskFromSelection());
    expect(api().listenerCount("ai:askFromSelection")).toBe(1);
    unmount();
    expect(api().listenerCount("ai:askFromSelection")).toBe(0);
  });

  it("pushes the incoming selection into the store and opens the AI panel", () => {
    renderHook(() => useAskFromSelection());
    expect(useBrowserStore.getState().showAI).toBe(false);

    act(() => {
      api().emit("ai:askFromSelection", {
        selection: "hello world",
        pageUrl: "https://x.test",
        pageTitle: "Page",
      });
    });

    const s = useBrowserStore.getState();
    expect(s.pendingSelection).toEqual({
      selection: "hello world",
      pageUrl: "https://x.test",
      pageTitle: "Page",
    });
    expect(s.showAI).toBe(true);
  });

  it("leaves AI panel state alone if it is already open", () => {
    useBrowserStore.setState({ showAI: true });
    renderHook(() => useAskFromSelection());
    act(() => {
      api().emit("ai:askFromSelection", {
        selection: "s",
        pageUrl: "u",
        pageTitle: "t",
      });
    });
    // Still open — no double toggle.
    expect(useBrowserStore.getState().showAI).toBe(true);
  });
});
