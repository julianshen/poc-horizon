import React, { useEffect, useRef } from 'react';
import type { Tab } from '../../types/browser';

interface Props {
  tab: Tab;
  x: number;
  y: number;
  onClose: () => void;
}

export const TabContextMenu: React.FC<Props> = ({ tab, x, y, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
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
  }, [onClose]);

  const invoke = (channel: string, payload: Record<string, unknown>) => {
    window.horizonAPI.invoke(channel, payload);
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-56 py-1.5 fade-in"
      style={{
        top: y,
        left: x,
        background: 'var(--surface-overlay)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <Row label="New Tab" onClick={() => invoke('tab:create', {})} />
      <Row label="Duplicate" onClick={() => invoke('tab:duplicate', { tabId: tab.id })} />
      <Row label="Reload" onClick={() => invoke('navigation:reload', { tabId: tab.id })} />
      <Divider />
      <Row
        label={tab.isPinned ? 'Unpin tab' : 'Pin tab'}
        onClick={() => invoke('tab:pin', { tabId: tab.id, pinned: !tab.isPinned })}
      />
      <Row
        label={tab.isMuted ? 'Unmute tab' : 'Mute tab'}
        onClick={() => invoke(tab.isMuted ? 'tab:unmute' : 'tab:mute', { tabId: tab.id })}
      />
      <Divider />
      <Row label="Close tab" onClick={() => invoke('tab:close', { tabId: tab.id })} />
    </div>
  );
};

const Row: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="w-full text-left px-3 py-1.5 text-sm"
    style={{ color: 'var(--chrome-fg)', transition: 'background var(--transition-fast)' }}
    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--tab-bg-hover)')}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
  >
    {label}
  </button>
);

const Divider: React.FC = () => (
  <div className="my-1 mx-2" style={{ height: 1, background: 'var(--chrome-border)' }} />
);
