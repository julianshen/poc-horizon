// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { BookmarksBar } from "@/components/chrome/BookmarksBar";
import { useBrowserStore } from "@/stores/browserStore";

const bk = (id: string, url: string, title = id) => ({
  id,
  schemaVersion: 1,
  index: 0,
  title,
  url,
  dateAdded: 0,
});

describe("BookmarksBar", () => {
  const { api } = setupRendererTest();

  it("renders the empty-state hint when there are no bookmarks", async () => {
    api().invoke.mockResolvedValue([]);
    render(<BookmarksBar />);
    await waitFor(() => {
      expect(screen.getByText(/Bookmark this page/)).toBeTruthy();
    });
  });

  it("renders one button per bookmark with the first-letter avatar", async () => {
    api().invoke.mockResolvedValue([
      bk("a", "https://a", "Alpha"),
      bk("b", "https://b", "Beta"),
    ]);
    render(<BookmarksBar />);
    await waitFor(() => {
      expect(screen.getByTitle("https://a")).toBeTruthy();
      expect(screen.getByTitle("https://b")).toBeTruthy();
    });
  });

  it("clicking a bookmark dispatches navigation:go for the active tab", async () => {
    api().invoke.mockResolvedValue([bk("a", "https://a", "Alpha")]);
    act(() => useBrowserStore.setState({ activeTabId: "t1" }));
    render(<BookmarksBar />);
    await waitFor(() => expect(screen.getByTitle("https://a")).toBeTruthy());
    fireEvent.click(screen.getByTitle("https://a"));
    expect(api().invoke.mock.calls).toContainEqual([
      "navigation:go",
      { tabId: "t1", url: "https://a" },
    ]);
  });
});
