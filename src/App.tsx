import React from 'react';
import { TitleBar } from './components/chrome/TitleBar';
import { Toolbar } from './components/chrome/Toolbar';
import { TabBar } from './components/chrome/TabBar';
import { BrowserContentArea } from './components/chrome/BrowserContentArea';
import { FindInPage } from './components/overlays/FindInPage';
import { useTabs } from './hooks/useTabs';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const App: React.FC = () => {
  useTabs();
  useKeyboardShortcuts();

  return (
    <div className="flex flex-col h-screen bg-[var(--chrome-bg)] relative">
      <TitleBar />
      <Toolbar />
      <TabBar />
      <BrowserContentArea />
      <FindInPage />
    </div>
  );
};

export default App;
