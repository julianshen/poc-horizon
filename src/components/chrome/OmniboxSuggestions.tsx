import React from 'react';
import type { HistoryEntry } from '../../types/browser';

interface Props {
  suggestions: HistoryEntry[];
  highlightIndex: number;
  onSelect: (url: string) => void;
  onHover: (index: number) => void;
}

export const OmniboxSuggestions: React.FC<Props> = ({
  suggestions,
  highlightIndex,
  onSelect,
  onHover,
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div
      className="absolute left-0 right-0 top-full mt-2 z-40 overflow-hidden fade-in"
      style={{
        background: 'var(--surface-overlay)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
      role="listbox"
    >
      {suggestions.map((s, i) => {
        const isActive = i === highlightIndex;
        return (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={isActive}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(s.url);
            }}
            onMouseEnter={() => onHover(i)}
            className="w-full flex items-center gap-3 px-3 py-2 text-left"
            style={{
              background: isActive ? 'var(--accent-light)' : 'transparent',
              color: 'var(--chrome-fg)',
              transition: 'background var(--transition-fast)',
            }}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--chrome-fg-muted)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="truncate text-sm font-medium">{s.title || s.url}</span>
            <span
              className="ml-auto truncate text-xs"
              style={{ color: 'var(--chrome-fg-muted)', maxWidth: '40%' }}
            >
              {s.url.replace(/^https?:\/\//, '')}
            </span>
          </button>
        );
      })}
    </div>
  );
};
