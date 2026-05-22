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

  if (!showFindBar) return null;

  return (
    <div className="absolute top-2 right-4 bg-white shadow-lg rounded-lg p-2 flex items-center gap-2 z-50">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleFind(!e.shiftKey);
        }}
        className="border rounded px-2 py-1 text-sm w-48"
        placeholder="Find in page"
        autoFocus
      />
      <span className="text-xs text-gray-500">
        {currentMatch}/{matchCount}
      </span>
      <button onClick={() => handleFind(false)} className="text-sm px-2">↑</button>
      <button onClick={() => handleFind(true)} className="text-sm px-2">↓</button>
      <button onClick={() => toggleOverlay('showFindBar')} className="text-sm px-2">✕</button>
    </div>
  );
};
