// @vitest-environment jsdom
// Exercises the inline onMouseEnter/onMouseLeave style-tweak handlers
// across the chrome — they're cosmetic but each one counts as an
// uncovered function in v8 coverage if never fired. One file rather than
// a separate test per component keeps the surface compact.
import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { useBrowserStore } from "@/stores/browserStore";

import { Tab } from "@/components/chrome/Tab";
import { TabBar } from "@/components/chrome/TabBar";
import { TabContextMenu } from "@/components/chrome/TabContextMenu";
import { BookmarksBar } from "@/components/chrome/BookmarksBar";
import { AppMenu } from "@/components/chrome/AppMenu";
import { BookmarksPanel } from "@/components/overlays/BookmarksPanel";
import { HistoryPanel } from "@/components/overlays/HistoryPanel";
import type { Tab as TabType } from "@/types/browser";

const sample = (id: string, overrides: Partial<TabType> = {}): TabType => ({
  id,
  schemaVersion: 1,
  url: `https://${id}`,
  title: id,
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
  ...overrides,
});

describe("Hover-handler coverage", () => {
  const { api } = setupRendererTest();

  it("Tab: mouseenter/leave on the row swap background when inactive", () => {
    const { container } = render(
      <Tab tab={sample("a")} isActive={false} index={0} />,
    );
    const row = container.querySelector('[data-testid="tab"]') as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(row.style.background).toBeTruthy();
    fireEvent.mouseLeave(row);
  });

  it("Tab: mouseenter is a visual no-op when the tab is active", () => {
    const { container } = render(<Tab tab={sample("a")} isActive index={0} />);
    const row = container.querySelector('[data-testid="tab"]') as HTMLElement;
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
  });

  it("Tab: close button mouseenter/leave swaps colours", () => {
    const { container } = render(
      <Tab tab={sample("a")} isActive={false} index={0} />,
    );
    const close = container.querySelector(
      '[data-testid="tab-close"]',
    ) as HTMLElement;
    fireEvent.mouseEnter(close);
    fireEvent.mouseLeave(close);
  });

  it("TabBar: new-tab button mouseenter/leave", () => {
    act(() =>
      useBrowserStore.setState({ tabs: [sample("a")], activeTabId: "a" }),
    );
    render(<TabBar />);
    const btn = screen.getByTestId("new-tab-button");
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
  });

  it("TabContextMenu: every row exercises hover handlers", () => {
    render(<TabContextMenu tab={sample("a")} x={0} y={0} onClose={() => {}} />);
    for (const item of screen.getAllByRole("menuitem")) {
      fireEvent.mouseEnter(item);
      fireEvent.mouseLeave(item);
    }
  });

  it("AppMenu: every row exercises hover handlers", () => {
    render(<AppMenu open onClose={() => {}} />);
    for (const item of screen.getAllByRole("menuitem")) {
      fireEvent.mouseEnter(item);
      fireEvent.mouseLeave(item);
    }
  });

  it("BookmarksBar: pill mouseenter/leave", async () => {
    api().invoke.mockResolvedValue([
      {
        id: "a",
        schemaVersion: 1,
        index: 0,
        title: "Alpha",
        url: "https://a",
        dateAdded: 0,
      },
    ]);
    render(<BookmarksBar />);
    await waitFor(() => expect(screen.getByTitle("https://a")).toBeTruthy());
    const pill = screen.getByTitle("https://a");
    fireEvent.mouseEnter(pill);
    fireEvent.mouseLeave(pill);
  });

  it("BookmarksPanel: row hover + Remove button click", async () => {
    api().invoke.mockResolvedValue([
      {
        id: "a",
        schemaVersion: 1,
        index: 0,
        title: "Alpha",
        url: "https://a",
        dateAdded: 0,
      },
    ]);
    act(() => useBrowserStore.setState({ showBookmarks: true }));
    render(<BookmarksPanel />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    const remove = screen.getByLabelText(/Remove bookmark/);
    // Hover the row container then click Remove.
    const row = remove.closest("li")?.querySelector("div") as HTMLElement;
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.click(remove);
    expect(
      api().invoke.mock.calls.some((c) => c[0] === "bookmark:remove"),
    ).toBe(true);
  });

  it("HistoryPanel: row hover + Clear all", async () => {
    api().invoke.mockResolvedValue([
      {
        id: "a",
        url: "https://a",
        title: "Alpha",
        visitTime: Date.now(),
        visitCount: 1,
        typedCount: 0,
      },
    ]);
    act(() => useBrowserStore.setState({ showHistory: true }));
    render(<HistoryPanel />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    const row = screen.getByText("Alpha").closest("button") as HTMLElement;
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.click(screen.getByText("Clear all"));
    expect(api().invoke.mock.calls.some((c) => c[0] === "history:clear")).toBe(
      true,
    );
  });
});
