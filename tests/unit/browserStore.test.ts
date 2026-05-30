import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserStore } from "@/stores/browserStore";

describe("browserStore — learn-page request", () => {
  beforeEach(() => {
    useBrowserStore.setState({ showAI: false, pendingLearnRequest: false });
  });

  it("requestLearnPage opens the AI panel and raises the pending flag", () => {
    useBrowserStore.getState().requestLearnPage();
    const s = useBrowserStore.getState();
    expect(s.showAI).toBe(true);
    expect(s.pendingLearnRequest).toBe(true);
  });

  it("consumeLearnRequest clears the pending flag and leaves the panel open", () => {
    useBrowserStore.getState().requestLearnPage();
    useBrowserStore.getState().consumeLearnRequest();
    const s = useBrowserStore.getState();
    expect(s.pendingLearnRequest).toBe(false);
    expect(s.showAI).toBe(true); // panel stays open to show the result
  });
});
