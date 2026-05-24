import React, { useCallback } from 'react';
import { Omnibox } from './Omnibox';
import { AppMenu } from './AppMenu';
import { useNavigation } from '../../hooks/useNavigation';
import { useBrowserStore } from '../../stores/browserStore';

export const Toolbar: React.FC = () => {
  const { goBack, goForward, reload, canGoBack, canGoForward, isLoading } = useNavigation();
  const { showAI, toggleAI, toggleOverlay, showAppMenu, setAppMenuOpen } = useBrowserStore();
  const toggleMenu = useCallback(() => setAppMenuOpen(!showAppMenu), [setAppMenuOpen, showAppMenu]);
  const closeMenu = useCallback(() => setAppMenuOpen(false), [setAppMenuOpen]);
  const openCmd = useCallback(() => toggleOverlay('showCmd'), [toggleOverlay]);

  return (
    <div
      className="flex items-center gap-1.5 px-3.5 pb-2.5 shrink-0 relative"
      style={{ background: 'transparent', minHeight: 38, WebkitAppRegion: 'drag' }}
    >
      <div className="flex gap-0.5" style={{ WebkitAppRegion: 'no-drag' }}>
        <button onClick={goBack} disabled={!canGoBack} className="icon-btn" aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button onClick={goForward} disabled={!canGoForward} className="icon-btn" aria-label="Forward">
          <svg viewBox="0 0 24 24" aria-hidden><polyline points="9 18 15 12 9 6" /></svg>
        </button>
        <button onClick={reload} className="icon-btn" aria-label={isLoading ? 'Stop' : 'Reload'}>
          {isLoading ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          )}
        </button>
      </div>
      <Omnibox />
      <div className="flex gap-0.5 items-center" style={{ WebkitAppRegion: 'no-drag' }}>
        <button onClick={openCmd} className="icon-btn" aria-label="Command palette" title="⌘K">
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </button>
        <button onClick={toggleAI} className={`icon-btn ai ${showAI ? 'active' : ''}`} aria-label="Toggle AI panel" aria-pressed={showAI}>
          <svg viewBox="0 0 24 24" aria-hidden fill={showAI ? 'currentColor' : 'none'}>
            <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
          </svg>
        </button>
        <button
          className="icon-btn"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={showAppMenu}
          onClick={toggleMenu}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
      <AppMenu open={showAppMenu} onClose={closeMenu} />
    </div>
  );
};
