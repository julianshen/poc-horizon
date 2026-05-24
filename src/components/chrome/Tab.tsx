import React, { useCallback, useState } from 'react';
import type { Tab as TabType } from '../../types/browser';
import { TabContextMenu } from './TabContextMenu';
import { useBrowserStore } from '../../stores/browserStore';

interface TabProps {
  tab: TabType;
  isActive: boolean;
  index: number;
}

export const Tab: React.FC<TabProps> = ({ tab, isActive, index }) => {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const setTabContextMenuOpen = useBrowserStore((s) => s.setTabContextMenuOpen);

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
    setTabContextMenuOpen(true);
  }, [setTabContextMenuOpen]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setTabContextMenuOpen(false);
  }, [setTabContextMenuOpen]);

  const toggleMute = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      window.horizonAPI.invoke(tab.isMuted ? 'tab:unmute' : 'tab:mute', { tabId: tab.id });
    },
    [tab.id, tab.isMuted]
  );

  const width = tab.isPinned ? 'w-9 min-w-[36px] max-w-[36px]' : 'min-w-[60px] max-w-[180px]';

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('text/x-horizon-tab', tab.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    [tab.id]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/x-horizon-tab')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const draggedId = e.dataTransfer.getData('text/x-horizon-tab');
      if (!draggedId || draggedId === tab.id) return;
      window.horizonAPI.invoke('tab:reorder', { tabId: draggedId, index });
    },
    [tab.id, index]
  );

  return (
    <>
      <div
        data-testid="tab"
        data-tab-id={tab.id}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={activate}
        onContextMenu={openMenu}
        className={`group h-[26px] px-2.5 flex items-center gap-2 cursor-pointer text-xs select-none relative ${width}`}
        style={{
          background: isActive ? 'var(--tab-bg-active)' : 'var(--tab-bg-inactive)',
          color: isActive ? 'var(--chrome-fg)' : 'var(--chrome-fg-subtle)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: isActive ? 'var(--tab-shadow-active)' : 'none',
          transition: 'background var(--transition-fast), color var(--transition-fast)',
          WebkitAppRegion: 'no-drag',
          fontWeight: 500,
          letterSpacing: '-0.005em',
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'var(--tab-bg-hover)';
            e.currentTarget.style.color = 'var(--chrome-fg)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'var(--tab-bg-inactive)';
            e.currentTarget.style.color = 'var(--chrome-fg-subtle)';
          }
        }}
      >
        {dragOver && (
          <span
            className="absolute -left-0.5 top-1 bottom-1 w-0.5 rounded-full"
            style={{ background: 'var(--accent-primary)' }}
            aria-hidden
          />
        )}
        {tab.isLoading ? (
          <span className="spinner shrink-0" />
        ) : tab.favicon ? (
          <img src={tab.favicon} alt="" className="w-[14px] h-[14px] shrink-0 rounded-[4px]" />
        ) : (
          <span
            className="w-[14px] h-[14px] rounded-[4px] shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
            style={{ background: 'var(--accent-primary)' }}
          >
            {(tab.title || '?').charAt(0).toUpperCase()}
          </span>
        )}
        {!tab.isPinned && <span className="flex-1 truncate">{tab.title || 'New Tab'}</span>}
        {tab.isMuted && (
          <button
            onClick={toggleMute}
            aria-label="Unmute tab"
            className="w-3.5 h-3.5 shrink-0 flex items-center justify-center"
            style={{ color: 'var(--chrome-fg-subtle)' }}
          >
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
            className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center opacity-0 group-hover:opacity-55"
            style={{
              color: 'var(--chrome-fg-muted)',
              transition: 'opacity var(--transition-fast), background var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(125,125,125,0.18)';
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.opacity = '0.55';
            }}
          >
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {menu && <TabContextMenu tab={tab} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </>
  );
};
