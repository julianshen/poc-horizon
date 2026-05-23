import React, { useState, useEffect, useCallback } from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import { normalizeUrl } from '../../utils/url';
import { useOmniboxSuggestions } from '../../hooks/useOmniboxSuggestions';
import { useBookmarks } from '../../hooks/useBookmarks';
import { OmniboxSuggestions } from './OmniboxSuggestions';

export const Omnibox: React.FC = () => {
  const { url, activeTabId } = useBrowserStore();
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const suggestions = useOmniboxSuggestions(inputValue, isFocused);
  const { findByUrl, add, remove } = useBookmarks();
  const bookmarked = findByUrl(url);

  const toggleBookmark = useCallback(() => {
    if (bookmarked) {
      void remove(bookmarked.id);
    } else if (url && !url.startsWith('horizon://')) {
      const tabTitle = useBrowserStore.getState().tabs.find((t) => t.id === activeTabId)?.title ?? url;
      void add(url, tabTitle);
    }
  }, [bookmarked, url, activeTabId, add, remove]);

  useEffect(() => {
    if (!isEditing) setInputValue(url);
  }, [url, isEditing]);

  useEffect(() => {
    setHighlight(-1);
  }, [inputValue]);

  const navigate = useCallback(
    (target: string) => {
      if (!activeTabId) return;
      const next = normalizeUrl(target);
      if (!next) return;
      window.horizonAPI.invoke('navigation:go', { tabId: activeTabId, url: next });
      setIsEditing(false);
      setIsFocused(false);
    },
    [activeTabId]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const picked = highlight >= 0 && suggestions[highlight] ? suggestions[highlight].url : inputValue;
      navigate(picked);
    },
    [highlight, suggestions, inputValue, navigate]
  );

  const handleFocus = useCallback(() => {
    setIsEditing(true);
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    setIsFocused(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (suggestions.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
      } else if (e.key === 'Escape') {
        setHighlight(-1);
      }
    },
    [suggestions.length]
  );

  const isInternal = url.startsWith('horizon://');
  const isSecure = url.startsWith('https');
  const displayValue = isEditing ? inputValue : isInternal ? '' : url.replace(/^https?:\/\//, '');

  return (
    <form onSubmit={handleSubmit} className="flex-1 max-w-3xl mx-2 relative">
      <div
        className="flex items-center h-9 px-3.5 gap-2.5"
        style={{
          background: isFocused ? 'var(--omnibox-bg-focus)' : 'var(--omnibox-bg)',
          borderRadius: 'var(--radius-md)',
          boxShadow: isFocused
            ? '0 0 0 3px var(--omnibox-ring), 0 1px 2px rgba(20,15,10,0.04)'
            : '0 1px 2px rgba(20,15,10,0.04), inset 0 0 0 0.5px var(--chrome-border)',
          transition: 'box-shadow var(--transition-fast), background var(--transition-fast)',
          WebkitAppRegion: 'no-drag',
        }}
      >
        {!isInternal && (
          <svg
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
          </svg>
        )}
        <input
          type="text"
          value={displayValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-sm"
          spellCheck={false}
          placeholder="Search or enter address"
          style={{ color: 'var(--chrome-fg)' }}
        />
        {!isInternal && url && (
          <button
            type="button"
            onClick={toggleBookmark}
            aria-label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
            aria-pressed={!!bookmarked}
            className="w-6 h-6 flex items-center justify-center rounded-full shrink-0"
            style={{
              color: bookmarked ? 'var(--accent-primary)' : 'var(--chrome-fg-muted)',
              background: 'transparent',
              transition: 'color var(--transition-fast), background var(--transition-fast)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--tab-bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        )}
      </div>
      {isFocused && (
        <OmniboxSuggestions
          suggestions={suggestions}
          highlightIndex={highlight}
          onSelect={navigate}
          onHover={setHighlight}
        />
      )}
    </form>
  );
};
