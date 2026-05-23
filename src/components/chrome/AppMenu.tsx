import React, { useEffect, useRef } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

const ZOOM_IN = 1.2;
const ZOOM_OUT = 0.9;

export const AppMenu: React.FC<Props> = ({ open, onClose }) => {
  const { activeTabId, toggleOverlay } = useBrowserStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const invokeOnTab = (channel: string, extra: Record<string, unknown> = {}) => {
    if (!activeTabId) return;
    window.horizonAPI.invoke(channel, { tabId: activeTabId, ...extra });
    onClose();
  };

  const open_ = (overlay: 'showBookmarks' | 'showHistory' | 'showDownloads' | 'showSettings') => {
    toggleOverlay(overlay);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      className="absolute right-3 top-12 z-50 w-64 py-1.5 fade-in"
      style={{
        background: 'var(--surface-overlay)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <MenuRow label="New Tab" hint="⌘T" onClick={() => { window.horizonAPI.invoke('tab:create', {}); onClose(); }} />
      <Divider />
      <MenuRow label="Bookmarks" onClick={() => open_('showBookmarks')} />
      <MenuRow label="History" onClick={() => open_('showHistory')} />
      <MenuRow label="Downloads" hint="⌘J" onClick={() => open_('showDownloads')} />
      <Divider />
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-xs flex-1" style={{ color: 'var(--chrome-fg-muted)' }}>Zoom</span>
        <MenuIconBtn aria-label="Zoom out" onClick={() => invokeOnTab('zoom:set', { level: ZOOM_OUT })}>−</MenuIconBtn>
        <MenuIconBtn aria-label="Reset zoom" onClick={() => invokeOnTab('zoom:reset')}>↺</MenuIconBtn>
        <MenuIconBtn aria-label="Zoom in" onClick={() => invokeOnTab('zoom:set', { level: ZOOM_IN })}>+</MenuIconBtn>
      </div>
      <Divider />
      <MenuRow label="Print…" hint="⌘P" onClick={() => invokeOnTab('print:start')} />
      <MenuRow label="Find in page" hint="⌘F" onClick={() => { toggleOverlay('showFindBar'); onClose(); }} />
      <MenuRow label="Developer Tools" hint="⌘⌥I" onClick={() => invokeOnTab('devtools:toggle')} />
      <Divider />
      <MenuRow label="Settings" hint="⌘," onClick={() => open_('showSettings')} />
    </div>
  );
};

const MenuRow: React.FC<{ label: string; hint?: string; onClick: () => void }> = ({ label, hint, onClick }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-3"
    style={{
      color: 'var(--chrome-fg)',
      transition: 'background var(--transition-fast)',
    }}
    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--tab-bg-hover)')}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
  >
    <span className="flex-1">{label}</span>
    {hint && (
      <span className="text-xs" style={{ color: 'var(--chrome-fg-muted)' }}>
        {hint}
      </span>
    )}
  </button>
);

const Divider: React.FC = () => (
  <div className="my-1 mx-2" style={{ height: 1, background: 'var(--chrome-border)' }} />
);

const MenuIconBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, ...rest }) => (
  <button
    type="button"
    {...rest}
    className="w-7 h-7 rounded-md flex items-center justify-center text-sm"
    style={{ color: 'var(--chrome-fg)', background: 'var(--omnibox-bg)' }}
  >
    {children}
  </button>
);
