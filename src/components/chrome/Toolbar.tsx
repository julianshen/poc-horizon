import React, { useCallback, useState } from 'react';
import { Omnibox } from './Omnibox';
import { AppMenu } from './AppMenu';
import { useNavigation } from '../../hooks/useNavigation';

export const Toolbar: React.FC = () => {
  const { goBack, goForward, reload, canGoBack, canGoForward, isLoading } = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div
      className="h-12 flex items-center gap-1 px-3 relative"
      style={{
        background: 'var(--toolbar-bg)',
        borderBottom: '1px solid var(--chrome-border)',
      }}
    >
      <button onClick={goBack} disabled={!canGoBack} className="icon-btn" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button onClick={goForward} disabled={!canGoForward} className="icon-btn" aria-label="Forward">
        <svg viewBox="0 0 24 24" aria-hidden>
          <polyline points="9 18 15 12 9 6" />
        </svg>
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
      <Omnibox />
      <button
        className="icon-btn ml-auto"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <AppMenu open={menuOpen} onClose={closeMenu} />
    </div>
  );
};
