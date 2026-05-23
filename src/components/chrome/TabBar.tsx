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
      className="h-10 flex items-end px-3 gap-1 overflow-x-auto"
      style={{ background: 'var(--chrome-bg)', WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-end gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
        {tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
        ))}
        <button
          data-testid="new-tab-button"
          aria-label="New tab"
          onClick={createTab}
          className="icon-btn mb-0.5 ml-1"
          style={{ width: 28, height: 28 }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
