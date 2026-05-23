import React from 'react';
import { TitleBar } from './components/chrome/TitleBar';
import { Toolbar } from './components/chrome/Toolbar';
import { TabBar } from './components/chrome/TabBar';
import { BookmarksBar } from './components/chrome/BookmarksBar';
import { BrowserContentArea } from './components/chrome/BrowserContentArea';
import { FindInPage } from './components/overlays/FindInPage';
import { PageErrorOverlay } from './components/overlays/PageErrorOverlay';
import { DownloadsShelf } from './components/overlays/DownloadsShelf';
import { HistoryPanel } from './components/overlays/HistoryPanel';
import { BookmarksPanel } from './components/overlays/BookmarksPanel';
import { SettingsPanel } from './components/overlays/SettingsPanel';
import { useBrowserStore } from './stores/browserStore';
import { useTabs } from './hooks/useTabs';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const App: React.FC = () => {
  useTabs();
  useKeyboardShortcuts();

  const { tabs, activeTabId } = useBrowserStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const errorState = activeTab?.errorState;

  const handleReload = () => {
    if (activeTabId) {
      window.horizonAPI.invoke('navigation:reload', { tabId: activeTabId });
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--chrome-bg)] relative">
      <TitleBar />
      <Toolbar />
      <BookmarksBar />
      <TabBar />
      <BrowserContentArea />
      {errorState && (
        <PageErrorOverlay
          errorType={errorState.type}
          errorCode={errorState.errorCode}
          errorDescription={errorState.errorDescription}
          onReload={handleReload}
        />
      )}
      <FindInPage />
      <DownloadsShelf />
      <HistoryPanel />
      <BookmarksPanel />
      <SettingsPanel />
    </div>
  );
};

export default App;
