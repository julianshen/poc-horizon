import React, { useCallback } from 'react';
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
import { AIPanel } from './components/overlays/AIPanel';
import { CommandPalette } from './components/overlays/CommandPalette';
import { PermissionPrompt } from './components/overlays/PermissionPrompt';
import { useBrowserStore } from './stores/browserStore';
import { useTabs } from './hooks/useTabs';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const App: React.FC = () => {
  useTabs();
  useKeyboardShortcuts();

  const { tabs, activeTabId, showAI } = useBrowserStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const errorState = activeTab?.errorState;

  const handleReload = useCallback(() => {
    if (activeTabId) {
      window.horizonAPI.invoke('navigation:reload', { tabId: activeTabId });
    }
  }, [activeTabId]);

  return (
    <div className="flex flex-col h-screen relative" style={{ background: 'var(--chrome-bg)' }}>
      <TitleBar />
      <TabBar />
      <Toolbar />
      <BookmarksBar />
      <div className="flex-1 flex min-h-0 px-3 pb-3 gap-3">
        <div
          className="flex-1 min-w-0 relative overflow-hidden"
          style={{
            background: 'var(--surface-1)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <BrowserContentArea />
          {errorState && (
            <PageErrorOverlay
              errorType={errorState.type}
              errorCode={errorState.errorCode}
              errorDescription={errorState.errorDescription}
              onReload={handleReload}
            />
          )}
        </div>
        {showAI && <AIPanel />}
      </div>
      <FindInPage />
      <DownloadsShelf />
      <HistoryPanel />
      <BookmarksPanel />
      <SettingsPanel />
      <CommandPalette />
      <PermissionPrompt />
    </div>
  );
};

export default App;
