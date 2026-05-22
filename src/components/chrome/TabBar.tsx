import React from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import { Tab } from './Tab';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId } = useBrowserStore();

  const createTab = () => {
    window.horizonAPI.invoke('tab:create', {});
  };

  return (
    <div className="h-[36px] flex items-center px-2 gap-1" style={{ background: 'var(--chrome-bg)' }}>
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
      <button
        onClick={createTab}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-200 text-lg"
      >
        +
      </button>
    </div>
  );
};
