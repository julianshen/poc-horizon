import React from 'react';

export const TitleBar: React.FC = () => {
  return (
    <div
      className="h-9 flex items-center select-none shrink-0"
      style={{
        background: 'transparent',
        WebkitAppRegion: 'drag',
      }}
    />
  );
};
