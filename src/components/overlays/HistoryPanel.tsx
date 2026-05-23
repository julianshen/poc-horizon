import React, { useCallback, useEffect, useState } from 'react';
import { SidePanel } from './SidePanel';
import { useBrowserStore } from '../../stores/browserStore';
import type { HistoryEntry } from '../../types/browser';

const PAGE_LIMIT = 200;

export const HistoryPanel: React.FC = () => {
  const { showHistory, toggleOverlay, activeTabId } = useBrowserStore();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const close = useCallback(() => toggleOverlay('showHistory'), [toggleOverlay]);

  useEffect(() => {
    if (!showHistory) return;
    let cancelled = false;
    const load = async () => {
      const channel = query.trim() ? 'history:search' : 'history:getRecent';
      const payload = query.trim() ? { query, limit: PAGE_LIMIT } : { limit: PAGE_LIMIT };
      const res = (await window.horizonAPI.invoke(channel, payload)) as HistoryEntry[];
      if (!cancelled) setEntries(Array.isArray(res) ? res : []);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [showHistory, query]);

  const open = useCallback(
    (url: string) => {
      if (!activeTabId) return;
      window.horizonAPI.invoke('navigation:go', { tabId: activeTabId, url });
      close();
    },
    [activeTabId, close]
  );

  const clearAll = useCallback(async () => {
    await window.horizonAPI.invoke('history:clear', {});
    setEntries([]);
  }, []);

  return (
    <SidePanel open={showHistory} title="History" onClose={close}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--chrome-border)' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search history"
          className="flex-1 h-8 px-3 text-sm rounded-md outline-none"
          style={{
            background: 'var(--omnibox-bg)',
            color: 'var(--chrome-fg)',
            border: '1px solid var(--chrome-border)',
          }}
        />
        <button onClick={clearAll} className="text-xs" style={{ color: 'var(--chrome-fg-muted)' }}>
          Clear all
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm" style={{ color: 'var(--chrome-fg-muted)' }}>
          No history yet.
        </p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => open(e.url)}
                className="w-full text-left px-4 py-2 flex flex-col gap-0.5"
                style={{ transition: 'background var(--transition-fast)' }}
                onMouseEnter={(el) => (el.currentTarget.style.background = 'var(--tab-bg-hover)')}
                onMouseLeave={(el) => (el.currentTarget.style.background = 'transparent')}
              >
                <span className="text-sm truncate" style={{ color: 'var(--chrome-fg)' }}>
                  {e.title || e.url}
                </span>
                <span className="text-xs truncate" style={{ color: 'var(--chrome-fg-muted)' }}>
                  {e.url}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
};
