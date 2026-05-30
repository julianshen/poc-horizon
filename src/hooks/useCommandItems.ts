import { useMemo } from "react";
import { useBrowserStore } from "../stores/browserStore";

export interface CommandItem {
  kind: "ai" | "tab" | "page" | "cmd";
  label: string;
  hint: string;
  action: () => void;
}

/**
 * Builds the command-palette item list for the current query. Sticky:
 * the "Ask Horizon" row is always present (even when no other items
 * match) so Enter on an empty result still does something.
 */
export function useCommandItems(
  query: string,
  close: () => void,
): CommandItem[] {
  const { tabs, activeTabId, toggleOverlay, toggleAI, requestLearnPage } =
    useBrowserStore();

  return useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      {
        kind: "ai",
        label: query ? `Ask Horizon: "${query}"` : "Ask Horizon…",
        hint: "AI",
        action: () => {
          if (!useBrowserStore.getState().showAI) toggleAI();
          close();
        },
      },
      {
        kind: "page",
        label: "Learn this page's actions",
        hint: "AI",
        action: () => {
          requestLearnPage();
          close();
        },
      },
      {
        kind: "cmd",
        label: "New Tab",
        hint: "⌘T",
        action: () => {
          window.horizonAPI.invoke("tab:create", {});
          close();
        },
      },
      panel("Open Bookmarks", "Panel", "showBookmarks", toggleOverlay, close),
      panel("Open History", "Panel", "showHistory", toggleOverlay, close),
      panel("Open Downloads", "⌘J", "showDownloads", toggleOverlay, close),
      panel("Open Settings", "⌘,", "showSettings", toggleOverlay, close),
      panel("Find in page", "⌘F", "showFindBar", toggleOverlay, close),
      ...tabs.map(
        (t): CommandItem => ({
          kind: "tab",
          label: `Switch to · ${t.title || t.url}`,
          hint: "Tab",
          action: () => {
            window.horizonAPI.invoke("tab:activate", { tabId: t.id });
            close();
          },
        }),
      ),
      {
        kind: "cmd",
        label: "Reload current tab",
        hint: "⌘R",
        action: () => {
          if (activeTabId)
            window.horizonAPI.invoke("navigation:reload", {
              tabId: activeTabId,
            });
          close();
        },
      },
    ];
    if (!query) return base;
    const needle = query.toLowerCase();
    return base.filter(
      (it) => it.kind === "ai" || it.label.toLowerCase().includes(needle),
    );
  }, [query, tabs, activeTabId, toggleAI, toggleOverlay, requestLearnPage, close]);
}

type OverlayKey = Parameters<
  ReturnType<typeof useBrowserStore.getState>["toggleOverlay"]
>[0];

function panel(
  label: string,
  hint: string,
  overlay: OverlayKey,
  toggleOverlay: (o: OverlayKey) => void,
  close: () => void,
): CommandItem {
  return {
    kind: "cmd",
    label,
    hint,
    action: () => {
      toggleOverlay(overlay);
      close();
    },
  };
}
