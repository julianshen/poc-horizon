import React, { useCallback } from "react";
import { SidePanel } from "./SidePanel";
import { useBrowserStore } from "../../stores/browserStore";
import { useBookmarks } from "../../hooks/useBookmarks";

export const BookmarksPanel: React.FC = () => {
  const { showBookmarks, toggleOverlay, activeTabId } = useBrowserStore();
  const { bookmarks, remove } = useBookmarks();
  const close = useCallback(
    () => toggleOverlay("showBookmarks"),
    [toggleOverlay],
  );

  const open = useCallback(
    (url: string) => {
      if (!activeTabId) return;
      window.horizonAPI.invoke("navigation:go", { tabId: activeTabId, url });
      close();
    },
    [activeTabId, close],
  );

  return (
    <SidePanel open={showBookmarks} title="Bookmarks" onClose={close}>
      {bookmarks.length === 0 ? (
        <p
          className="px-4 py-6 text-sm"
          style={{ color: "var(--chrome-fg-muted)" }}
        >
          No bookmarks yet. Click the ★ in the address bar to add one.
        </p>
      ) : (
        <ul>
          {bookmarks.map((b) => (
            <li key={b.id} className="group">
              <div
                className="flex items-center gap-3 px-4 py-2"
                style={{ transition: "background var(--transition-fast)" }}
                onMouseEnter={(el) =>
                  (el.currentTarget.style.background = "var(--tab-bg-hover)")
                }
                onMouseLeave={(el) =>
                  (el.currentTarget.style.background = "transparent")
                }
              >
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: "var(--accent-primary)" }}
                  aria-hidden
                >
                  {(b.title || b.url || "?").charAt(0).toUpperCase()}
                </span>
                <button
                  onClick={() => b.url && open(b.url)}
                  className="flex-1 text-left min-w-0"
                >
                  <div
                    className="text-sm truncate"
                    style={{ color: "var(--chrome-fg)" }}
                  >
                    {b.title || b.url}
                  </div>
                  <div
                    className="text-xs truncate"
                    style={{ color: "var(--chrome-fg-muted)" }}
                  >
                    {b.url}
                  </div>
                </button>
                <button
                  onClick={() => remove(b.id)}
                  aria-label={`Remove bookmark ${b.title || b.url}`}
                  className="text-xs opacity-0 group-hover:opacity-100 px-2"
                  style={{
                    color: "var(--chrome-fg-muted)",
                    transition: "opacity var(--transition-fast)",
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
};
