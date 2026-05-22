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
      onClick={activate}
      className={`h-8 px-3 rounded-t-lg flex items-center gap-2 min-w-[120px] max-w-[200px] cursor-pointer text-xs select-none ${
        isActive ? 'bg-white' : 'hover:bg-gray-200'
      }`}
    >
      {tab.favicon ? (
        <img src={tab.favicon} alt="" className="w-4 h-4" />
      ) : (
        <span className="w-4 h-4 bg-gray-300 rounded-full" />
      )}
      <span className="flex-1 truncate">{tab.title || 'New Tab'}</span>
      {tab.isLoading && <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />}
      <button
        onClick={close}
        className="w-4 h-4 rounded-full hover:bg-gray-300 flex items-center justify-center text-xs"
      >
        ×
      </button>
    </div>
  );
};
