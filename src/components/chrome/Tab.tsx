import React from 'react';
import type { Tab as TabType } from '../../types/browser';

interface TabProps {
  tab: TabType;
  isActive: boolean;
}

export const Tab: React.FC<TabProps> = ({ tab, isActive }) => {
  const activate = () => {
    window.horizonAPI.invoke('tab:activate', { tabId: tab.id });
  };

  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.horizonAPI.invoke('tab:close', { tabId: tab.id });
  };

  return (
    <div
      data-testid="tab"
      data-tab-id={tab.id}
      onClick={activate}
      className="group h-9 px-3 flex items-center gap-2 min-w-[140px] max-w-[220px] cursor-pointer text-xs select-none relative"
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
        <span
          className="w-4 h-4 rounded-sm shrink-0"
          style={{ background: 'var(--chrome-border)' }}
        />
      )}
      <span className="flex-1 truncate font-medium">{tab.title || 'New Tab'}</span>
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
    </div>
  );
};
