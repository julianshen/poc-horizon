import React from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import { Tab } from './Tab';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId } = useBrowserStore();

  const createTab = () => {
    window.horizonAPI.invoke('tab:create', {});
  };

  return (
    <div
      className="h-[30px] flex items-center overflow-x-auto px-3 gap-px shrink-0"
      style={{ background: 'transparent', WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-center gap-px flex-1" style={{ WebkitAppRegion: 'no-drag' }}>
        {[...tabs]
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
          .map((tab, i) => (
            <Tab key={tab.id} tab={tab} isActive={tab.id === activeTabId} index={i} />
          ))}
        <button
          data-testid="new-tab-button"
          aria-label="New tab"
          onClick={createTab}
          className="h-[26px] w-[30px] flex items-center justify-center rounded-[8px] ml-1"
          style={{
            color: 'var(--chrome-fg-subtle)',
            background: 'transparent',
            transition: 'background var(--transition-fast), color var(--transition-fast)',
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--surface-hover)';
            e.currentTarget.style.color = 'var(--chrome-fg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--chrome-fg-subtle)';
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
