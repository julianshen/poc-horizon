import React, { useState, useEffect, useCallback } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

export const Omnibox: React.FC = () => {
  const { url, activeTabId } = useBrowserStore();
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(url);
    }
  }, [url, isEditing]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeTabId || !inputValue.trim()) return;

      let url = inputValue.trim();
      if (!url.includes('://') && !url.includes('.')) {
        url = `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
      } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      window.horizonAPI.invoke('navigation:go', { tabId: activeTabId, url });
      setIsEditing(false);
    },
    [activeTabId, inputValue]
  );

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-2xl mx-2">
      <div
        className="flex items-center h-8 px-3 rounded-full border"
        style={{ background: 'var(--omnibox-bg)', borderColor: 'var(--omnibox-border)' }}
      >
        <span className="text-xs mr-2">
          {url.startsWith('https') ? '🔒' : '⚠️'}
        </span>
        <input
          type="text"
          value={isEditing ? inputValue : url.replace(/^https?:\/\//, '')}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={() => setIsEditing(false)}
          className="flex-1 bg-transparent outline-none text-sm"
          spellCheck={false}
        />
      </div>
    </form>
  );
};
