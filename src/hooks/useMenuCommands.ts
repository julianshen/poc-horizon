import { useEffect } from "react";
import { useBrowserStore } from "../stores/browserStore";

/**
 * Listen for 'menu:command' IPC pushes from the native application menu
 * and dispatch them into the renderer. Main can't toggle a side panel or
 * focus the omnibox on its own — those are renderer concerns — so the
 * native menu items that need renderer state delegate via this channel.
 */
export function useMenuCommands(): void {
  const { activeTabId, toggleOverlay } = useBrowserStore();

  useEffect(() => {
    const unsub = window.horizonAPI.on(
      "menu:command",
      (payload: { command: string }) => {
        switch (payload.command) {
          case "find:open":
            toggleOverlay("showFindBar");
            break;
          case "translate:open":
            if (!useBrowserStore.getState().showTranslationBar) {
              toggleOverlay("showTranslationBar");
            }
            break;
          case "translate:restore":
            // Ensure the bar is visible so the user can see the restored
            // state (and can re-translate without re-opening the menu).
            if (!useBrowserStore.getState().showTranslationBar) {
              toggleOverlay("showTranslationBar");
            }
            // Tell TranslationBar to clear its per-tab status so the bar
            // doesn't keep showing "Show Original" after restore. The IPC
            // is invoked from inside the bar's listener to keep a single
            // restore path (no double-dispatch).
            window.dispatchEvent(new Event("horizon:translate-restore"));
            void window.horizonAPI.invoke("translate:restore");
            break;
          case "panel:history":
            toggleOverlay("showHistory");
            break;
          case "panel:bookmarks":
            toggleOverlay("showBookmarks");
            break;
          case "panel:settings":
            toggleOverlay("showSettings");
            break;
          case "bookmark:add": {
            if (!activeTabId) return;
            const tab = useBrowserStore
              .getState()
              .tabs.find((t) => t.id === activeTabId);
            if (!tab || !tab.url || tab.url.startsWith("horizon://")) return;
            void window.horizonAPI.invoke("bookmark:add", {
              url: tab.url,
              title: tab.title || tab.url,
            });
            break;
          }
          default:
            break;
        }
      },
    );
    return unsub;
  }, [activeTabId, toggleOverlay]);
}
