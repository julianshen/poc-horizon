import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

interface Item {
  kind: 'ai' | 'tab' | 'page' | 'cmd';
  label: string;
  hint: string;
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const { showCmd, toggleOverlay, tabs, activeTabId, toggleAI } = useBrowserStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const close = useCallback(() => {
    toggleOverlay('showCmd');
  }, [toggleOverlay]);

  useEffect(() => {
    if (!showCmd) return;
    setQ('');
    setSel(0);
    inputRef.current?.focus();
  }, [showCmd]);

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      {
        kind: 'ai',
        label: q ? `Ask Horizon: "${q}"` : 'Ask Horizon…',
        hint: 'AI',
        action: () => {
          if (!useBrowserStore.getState().showAI) toggleAI();
          close();
        },
      },
      {
        kind: 'cmd',
        label: 'New Tab',
        hint: '⌘T',
        action: () => {
          window.horizonAPI.invoke('tab:create', {});
          close();
        },
      },
      {
        kind: 'cmd',
        label: 'Open Bookmarks',
        hint: 'Panel',
        action: () => {
          toggleOverlay('showBookmarks');
          close();
        },
      },
      {
        kind: 'cmd',
        label: 'Open History',
        hint: 'Panel',
        action: () => {
          toggleOverlay('showHistory');
          close();
        },
      },
      {
        kind: 'cmd',
        label: 'Open Downloads',
        hint: '⌘J',
        action: () => {
          toggleOverlay('showDownloads');
          close();
        },
      },
      {
        kind: 'cmd',
        label: 'Open Settings',
        hint: '⌘,',
        action: () => {
          toggleOverlay('showSettings');
          close();
        },
      },
      {
        kind: 'cmd',
        label: 'Find in page',
        hint: '⌘F',
        action: () => {
          toggleOverlay('showFindBar');
          close();
        },
      },
      ...tabs.map(
        (t): Item => ({
          kind: 'tab',
          label: `Switch to · ${t.title || t.url}`,
          hint: 'Tab',
          action: () => {
            window.horizonAPI.invoke('tab:activate', { tabId: t.id });
            close();
          },
        })
      ),
      {
        kind: 'cmd',
        label: 'Reload current tab',
        hint: '⌘R',
        action: () => {
          if (activeTabId) window.horizonAPI.invoke('navigation:reload', { tabId: activeTabId });
          close();
        },
      },
    ];
    if (!q) return base;
    const needle = q.toLowerCase();
    return base.filter((it) => it.kind === 'ai' || it.label.toLowerCase().includes(needle));
  }, [q, tabs, activeTabId, toggleAI, toggleOverlay, close]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(items.length - 1, s + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[sel]?.action();
      }
    },
    [close, items, sel]
  );

  if (!showCmd) return null;

  return (
    <div
      className="absolute inset-0 z-[60] flex items-start justify-center pt-[10%] fade-in"
      style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(3px)' }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] mx-6 flex flex-col overflow-hidden relative"
        style={{
          background: 'var(--surface-1)',
          borderRadius: 20,
          boxShadow: 'var(--shadow-lg)',
          border: '0.5px solid var(--chrome-border-strong)',
        }}
        role="dialog"
        aria-label="Command palette"
      >
        <div
          className="absolute inset-x-0 top-0 h-16 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, var(--ai-tint), transparent)' }}
          aria-hidden
        />
        <div className="flex items-center gap-3 px-5 py-4 relative" style={{ borderBottom: '0.5px solid var(--chrome-border)' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--accent-primary)' }} aria-hidden>
            <path d="M12 3l1.8 4.4L18.2 9.2 13.8 11 12 15.4 10.2 11 5.8 9.2 10.2 7.4z" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKey}
            placeholder="Ask Horizon, or type a command…"
            className="flex-1 bg-transparent outline-none text-base font-medium italic"
            style={{ color: 'var(--chrome-fg)', letterSpacing: '-0.015em' }}
            spellCheck={false}
          />
          <span
            className="text-[10px] px-1.5 py-1 rounded font-mono"
            style={{ background: 'var(--surface-hover)', color: 'var(--chrome-fg-muted)' }}
          >
            esc
          </span>
        </div>
        <div className="max-h-[380px] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="py-5 text-center text-sm" style={{ color: 'var(--chrome-fg-subtle)' }}>
              No matches.
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={i}
                type="button"
                onClick={it.action}
                onMouseEnter={() => setSel(i)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm"
                style={{
                  background:
                    i === sel
                      ? 'linear-gradient(135deg, var(--accent-soft), var(--ai-tint))'
                      : 'transparent',
                  color: 'var(--chrome-fg)',
                  transition: 'background var(--transition-fast)',
                }}
              >
                <span style={{ color: it.kind === 'ai' ? 'var(--accent-primary)' : 'var(--chrome-fg-muted)' }} className="flex">
                  {iconFor(it.kind)}
                </span>
                <span className="flex-1 truncate">{it.label}</span>
                <span className="text-[11px]" style={{ color: i === sel ? 'var(--accent-primary)' : 'var(--chrome-fg-subtle)' }}>
                  {it.hint}
                </span>
              </button>
            ))
          )}
        </div>
        <div
          className="flex gap-3 px-4 py-2 text-[11px]"
          style={{ borderTop: '0.5px solid var(--chrome-border)', color: 'var(--chrome-fg-subtle)' }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
};

function iconFor(kind: Item['kind']): React.ReactNode {
  if (kind === 'ai') {
    return (
      <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 3l1.8 4.4L18.2 9.2 13.8 11 12 15.4 10.2 11 5.8 9.2 10.2 7.4z" />
      </svg>
    );
  }
  if (kind === 'tab') {
    return (
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
      </svg>
    );
  }
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
