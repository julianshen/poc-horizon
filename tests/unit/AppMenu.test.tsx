// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { AppMenu } from "@/components/chrome/AppMenu";
import { useBrowserStore } from "@/stores/browserStore";

describe("AppMenu", () => {
  const { api } = setupRendererTest();

  it("renders nothing when closed", () => {
    const { container } = render(<AppMenu open={false} onClose={() => {}} />);
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("lists the headline rows when open", () => {
    render(<AppMenu open onClose={() => {}} />);
    expect(screen.getByRole("menuitem", { name: /New Tab/ })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /New Incognito Window/ }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Settings/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Print/ })).toBeTruthy();
  });

  it("New Tab row dispatches tab:create and closes the menu", () => {
    const onClose = vi.fn();
    render(<AppMenu open onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /New Tab/ }));
    expect(api().invokes).toContainEqual({
      channel: "tab:create",
      payload: {},
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Bookmarks row toggles the Bookmarks overlay", () => {
    const onClose = vi.fn();
    render(<AppMenu open onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Bookmarks" }));
    expect(useBrowserStore.getState().showBookmarks).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(<AppMenu open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("every panel-toggle row toggles its store flag and closes the menu", () => {
    const rows: Array<{
      name: RegExp | string;
      flag: "showHistory" | "showDownloads" | "showSettings";
    }> = [
      { name: "History", flag: "showHistory" },
      { name: /^Downloads/, flag: "showDownloads" },
      { name: /^Settings/, flag: "showSettings" },
    ];
    for (const r of rows) {
      const onClose = vi.fn();
      const { unmount } = render(<AppMenu open onClose={onClose} />);
      fireEvent.click(screen.getByRole("menuitem", { name: r.name }));
      expect(useBrowserStore.getState()[r.flag]).toBe(true);
      expect(onClose).toHaveBeenCalled();
      unmount();
      // Reset for next iteration.
      useBrowserStore.setState({ [r.flag]: false } as never);
    }
  });

  it("Print / Find / Developer Tools dispatch the right IPC", () => {
    useBrowserStore.setState({ activeTabId: "t1" });
    const { rerender } = render(<AppMenu open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Print/ }));
    rerender(<AppMenu open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Find in page/ }));
    rerender(<AppMenu open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Developer Tools/ }));
    const channels = api().invokes.map((i) => i.channel);
    expect(channels).toContain("print:start");
    expect(channels).toContain("devtools:toggle");
  });

  it("Zoom buttons dispatch zoom:set / zoom:reset for the active tab", () => {
    useBrowserStore.setState({ activeTabId: "t1" });
    render(<AppMenu open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByLabelText("Reset zoom"));
    const channels = api().invokes.map((i) => i.channel);
    expect(channels).toEqual(["zoom:set", "zoom:set", "zoom:reset"]);
  });
});
