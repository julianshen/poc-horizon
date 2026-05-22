import React from 'react';

export const TitleBar: React.FC = () => {
  return (
    <div
      className="h-[40px] flex items-center px-4"
      style={{ background: 'var(--toolbar-bg)', WebkitAppRegion: 'drag' }}
    >
      <span className="text-sm font-medium ml-20">Horizon</span>
    </div>
  );
};
