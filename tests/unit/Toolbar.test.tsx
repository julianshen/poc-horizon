// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { Toolbar } from "@/components/chrome/Toolbar";
import { useBrowserStore } from "@/stores/browserStore";

describe("Toolbar — Learn this page button", () => {
  setupRendererTest();

  it("clicking it opens the AI panel and raises pendingLearnRequest", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Learn this page's actions" }));
    const s = useBrowserStore.getState();
    expect(s.showAI).toBe(true);
    expect(s.pendingLearnRequest).toBe(true);
  });
});
