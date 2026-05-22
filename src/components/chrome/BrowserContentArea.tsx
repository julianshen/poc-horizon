import React from 'react';

export const BrowserContentArea: React.FC = () => {
  // BrowserViews are managed by Electron main process
  // This component is just a visual placeholder that reserves space
  return <div className="flex-1" style={{ background: '#ffffff' }} />;
};
