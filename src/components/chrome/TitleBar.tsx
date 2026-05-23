import React from 'react';

export const TitleBar: React.FC = () => {
  return (
    <div
      className="h-7 flex items-center px-4 select-none"
      style={{
        background: 'var(--chrome-bg)',
        WebkitAppRegion: 'drag',
        borderBottom: '1px solid var(--chrome-border)',
      }}
    >
      <div className="ml-20 flex items-center gap-2">
        <span
          className="w-3 h-3 rounded-sm"
          style={{ background: 'var(--accent-gradient)' }}
          aria-hidden
        />
        <span
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: 'var(--chrome-fg-muted)', letterSpacing: '0.08em' }}
        >
          Horizon
        </span>
      </div>
    </div>
  );
};
