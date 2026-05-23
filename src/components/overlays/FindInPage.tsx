import React, { useState, useCallback, useEffect } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

export const FindInPage: React.FC = () => {
  const { showFindBar, activeTabId, toggleOverlay } = useBrowserStore();
  const [text, setText] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const handleFind = useCallback(
    (forward = true) => {
      if (!activeTabId || !text) return;
      window.horizonAPI.invoke('find:start', { tabId: activeTabId, text });
      window.horizonAPI.invoke('find:next', { tabId: activeTabId, forward });
    },
    [activeTabId, text]
  );

  useEffect(() => {
    if (!showFindBar) return;
    const unsub = window.horizonAPI.on('find:result', (result: { matches: number; activeMatchOrdinal: number }) => {
      setMatchCount(result.matches);
      setCurrentMatch(result.activeMatchOrdinal);
    });
    return unsub;
  }, [showFindBar]);

  const close = useCallback(() => toggleOverlay('showFindBar'), [toggleOverlay]);
  const next = useCallback(() => handleFind(true), [handleFind]);
  const prev = useCallback(() => handleFind(false), [handleFind]);
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleFind(!e.shiftKey);
      if (e.key === 'Escape') close();
    },
    [handleFind, close]
  );

  if (!showFindBar) return null;

  return (
    <div
      className="absolute top-3 right-4 z-50 fade-in flex items-center gap-1 p-1.5 pl-3"
      style={{
        background: 'var(--surface-overlay)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        boxShadow: 'var(--shadow-lg)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--chrome-border)',
      }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        className="bg-transparent outline-none text-sm w-56 px-1"
        placeholder="Find in page"
        autoFocus
        style={{ color: 'var(--chrome-fg)' }}
      />
      <span
        className="text-xs px-2 tabular-nums"
        style={{ color: 'var(--chrome-fg-muted)' }}
      >
        {currentMatch}/{matchCount}
      </span>
      <button onClick={prev} className="icon-btn" aria-label="Previous match" style={{ width: 28, height: 28 }}>
        <svg viewBox="0 0 24 24" aria-hidden><polyline points="18 15 12 9 6 15" /></svg>
      </button>
      <button onClick={next} className="icon-btn" aria-label="Next match" style={{ width: 28, height: 28 }}>
        <svg viewBox="0 0 24 24" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      <button onClick={close} className="icon-btn" aria-label="Close find bar" style={{ width: 28, height: 28 }}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  );
};
