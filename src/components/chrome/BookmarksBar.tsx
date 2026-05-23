import React, { useCallback } from 'react';
import { useBookmarks } from '../../hooks/useBookmarks';
import { useBrowserStore } from '../../stores/browserStore';

export const BookmarksBar: React.FC = () => {
  const { bookmarks } = useBookmarks();
  const { activeTabId } = useBrowserStore();

  const open = useCallback(
    (url: string) => {
      if (!activeTabId) return;
      window.horizonAPI.invoke('navigation:go', { tabId: activeTabId, url });
    },
    [activeTabId]
  );

  return (
    <div
      className="h-9 flex items-center px-3 gap-1 overflow-x-auto"
      style={{
        background: 'var(--toolbar-bg)',
        borderBottom: '1px solid var(--chrome-border)',
      }}
      role="toolbar"
      aria-label="Bookmarks bar"
    >
      {bookmarks.length === 0 && (
        <span className="text-xs px-1" style={{ color: 'var(--chrome-fg-muted)' }}>
          Bookmark this page by clicking the ★ in the address bar
        </span>
      )}
      {bookmarks.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => open(b.url!)}
          className="h-7 px-2 rounded-md flex items-center gap-2 text-xs font-medium shrink-0"
          style={{
            color: 'var(--chrome-fg)',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--tab-bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          title={b.url}
        >
          <span
            className="w-4 h-4 rounded-sm flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ background: 'var(--accent-primary)' }}
            aria-hidden
          >
            {(b.title || b.url || '?').charAt(0).toUpperCase()}
          </span>
          <span className="truncate max-w-[140px]">{b.title || b.url}</span>
        </button>
      ))}
    </div>
  );
};
