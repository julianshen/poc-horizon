// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act } from "@testing-library/react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { BookmarksPanel } from "@/components/overlays/BookmarksPanel";
import { useBrowserStore } from "@/stores/browserStore";

const bk = (id: string, url: string, title = id) => ({
  id,
  schemaVersion: 1,
  index: 0,
  title,
  url,
  dateAdded: 0,
});

describe("BookmarksPanel", () => {
  const { api } = setupRendererTest();

  it("renders nothing when showBookmarks is false", () => {
    const { container } = render(<BookmarksPanel />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders one row per bookmark when open", async () => {
    api().invoke.mockResolvedValue([
      bk("a", "https://a", "Alpha"),
      bk("b", "https://b", "Beta"),
    ]);
    act(() => useBrowserStore.setState({ showBookmarks: true }));
    render(<BookmarksPanel />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("renders empty state when there are no bookmarks", async () => {
    api().invoke.mockResolvedValue([]);
    act(() => useBrowserStore.setState({ showBookmarks: true }));
    render(<BookmarksPanel />);
    await waitFor(() =>
      expect(screen.getByText(/No bookmarks yet/)).toBeTruthy(),
    );
  });

  it("clicking a bookmark dispatches navigation:go for the active tab", async () => {
    api().invoke.mockResolvedValue([bk("a", "https://a", "Alpha")]);
    act(() =>
      useBrowserStore.setState({ showBookmarks: true, activeTabId: "t1" }),
    );
    render(<BookmarksPanel />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    fireEvent.click(screen.getByText("Alpha"));
    expect(api().invoke.mock.calls).toContainEqual([
      "navigation:go",
      { tabId: "t1", url: "https://a" },
    ]);
  });
});
