// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidePanel } from "@/components/overlays/SidePanel";

describe("SidePanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <SidePanel open={false} title="X" onClose={() => {}}>
        <div data-testid="child" />
      </SidePanel>,
    );
    expect(container.querySelector("aside")).toBeNull();
  });

  it("renders a dialog with title and children when open", () => {
    render(
      <SidePanel open title="History" onClose={() => {}}>
        <div data-testid="child">hello</div>
      </SidePanel>,
    );
    expect(screen.getByRole("dialog", { name: "History" })).toBeTruthy();
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <SidePanel open title="X" onClose={onClose}>
        <div />
      </SidePanel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <SidePanel open title="X" onClose={onClose}>
        <div />
      </SidePanel>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SidePanel open title="X" onClose={onClose}>
        <div />
      </SidePanel>,
    );
    // The first sibling div is the backdrop.
    const backdrop = container.querySelector(
      'div[aria-hidden="true"]',
    ) as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
