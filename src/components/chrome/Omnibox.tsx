import React, { useState, useEffect, useCallback } from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import { normalizeUrl } from '../../utils/url';

export const Omnibox: React.FC = () => {
  const { url, activeTabId } = useBrowserStore();
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(url);
    }
  }, [url, isEditing]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!activeTabId) return;
      const next = normalizeUrl(inputValue);
      if (!next) return;
      window.horizonAPI.invoke('navigation:go', { tabId: activeTabId, url: next });
      setIsEditing(false);
    },
    [activeTabId, inputValue]
  );

  const handleFocus = useCallback(() => {
    setIsEditing(true);
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    setIsFocused(false);
  }, []);

  const isInternal = url.startsWith('horizon://');
  const isSecure = url.startsWith('https');
  const displayValue = isEditing
    ? inputValue
    : isInternal
      ? ''
      : url.replace(/^https?:\/\//, '');

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-3xl mx-3">
      <div
        className="flex items-center h-9 px-3 gap-2"
        style={{
          background: isFocused ? 'var(--omnibox-bg-focus)' : 'var(--omnibox-bg)',
          borderRadius: 'var(--radius-pill)',
          boxShadow: isFocused
            ? `0 0 0 3px var(--omnibox-ring), var(--shadow-sm)`
            : 'inset 0 0 0 1px var(--chrome-border)',
          transition: 'box-shadow var(--transition-fast), background var(--transition-fast)',
          WebkitAppRegion: 'no-drag',
        }}
      >
        {!isInternal && <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
          fill="none"
          stroke={isSecure ? 'var(--secure)' : 'var(--warning)'}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {isSecure ? (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </>
          ) : (
            <>
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </>
          )}
        </svg>}
        <input
          type="text"
          value={displayValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="flex-1 bg-transparent outline-none text-sm"
          spellCheck={false}
          placeholder="Search or enter address"
          style={{ color: 'var(--chrome-fg)' }}
        />
      </div>
    </form>
  );
};
