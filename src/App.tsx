import React from 'react';
import { TitleBar } from './components/chrome/TitleBar';
import { Toolbar } from './components/chrome/Toolbar';
import { TabBar } from './components/chrome/TabBar';
import { BrowserContentArea } from './components/chrome/BrowserContentArea';
import { useTabs } from './hooks/useTabs';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

const App: React.FC = () => {
  useTabs();
  useKeyboardShortcuts();

  return (
    <div className="flex flex-col h-screen bg-[var(--chrome-bg)]">
      <TitleBar />
      <Toolbar />
      <TabBar />
      <BrowserContentArea />
    </div>
  );
};

export default App;
