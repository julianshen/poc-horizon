import React, { useCallback, useState } from 'react';
import type { Tab as TabType } from '../../types/browser';
import { TabContextMenu } from './TabContextMenu';

interface TabProps {
  tab: TabType;
  isActive: boolean;
}

export const Tab: React.FC<TabProps> = ({ tab, isActive }) => {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const activate = useCallback(() => {
    window.horizonAPI.invoke('tab:activate', { tabId: tab.id });
  }, [tab.id]);

  const close = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      window.horizonAPI.invoke('tab:close', { tabId: tab.id });
    },
    [tab.id]
  );

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const toggleMute = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      window.horizonAPI.invoke(tab.isMuted ? 'tab:unmute' : 'tab:mute', { tabId: tab.id });
    },
    [tab.id, tab.isMuted]
  );

  const width = tab.isPinned ? 'w-10 min-w-[40px]' : 'min-w-[140px] max-w-[220px]';

  return (
    <>
      <div
        data-testid="tab"
        data-tab-id={tab.id}
        onClick={activate}
        onContextMenu={openMenu}
        className={`group h-9 px-3 flex items-center gap-2 cursor-pointer text-xs select-none relative ${width}`}
        style={{
          background: isActive ? 'var(--tab-bg-active)' : 'var(--tab-bg-inactive)',
          color: isActive ? 'var(--chrome-fg)' : 'var(--chrome-fg-muted)',
          borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
          boxShadow: isActive ? 'var(--tab-shadow-active)' : 'none',
          transition: 'background var(--transition-fast), color var(--transition-fast)',
          WebkitAppRegion: 'no-drag',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--tab-bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--tab-bg-inactive)';
        }}
      >
        {tab.isLoading ? (
          <span className="spinner shrink-0" />
        ) : tab.favicon ? (
          <img src={tab.favicon} alt="" className="w-4 h-4 shrink-0 rounded-sm" />
        ) : (
          <span className="w-4 h-4 rounded-sm shrink-0" style={{ background: 'var(--chrome-border)' }} />
        )}
        {!tab.isPinned && (
          <span className="flex-1 truncate font-medium">{tab.title || 'New Tab'}</span>
        )}
        {tab.isMuted && (
          <button
            onClick={toggleMute}
            aria-label="Unmute tab"
            className="w-4 h-4 shrink-0 flex items-center justify-center"
            style={{ color: 'var(--chrome-fg-muted)' }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          </button>
        )}
        {!tab.isPinned && (
          <button
            data-testid="tab-close"
            aria-label={`Close ${tab.title || 'tab'}`}
            onClick={close}
            className="w-5 h-5 rounded-full flex items-center justify-center text-sm leading-none opacity-0 group-hover:opacity-100"
            style={{
              color: 'var(--chrome-fg-muted)',
              transition: 'opacity var(--transition-fast), background var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--tab-bg-hover)';
              e.currentTarget.style.color = 'var(--chrome-fg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--chrome-fg-muted)';
            }}
          >
            ×
          </button>
        )}
      </div>
      {menu && <TabContextMenu tab={tab} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </>
  );
};
