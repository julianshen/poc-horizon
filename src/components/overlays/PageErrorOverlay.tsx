import React from 'react';

interface PageErrorOverlayProps {
  errorType: 'load-failed' | 'crashed' | 'unresponsive';
  errorCode?: number;
  errorDescription?: string;
  onReload: () => void;
}

const MESSAGES: Record<PageErrorOverlayProps['errorType'], string> = {
  'load-failed': "This site can't be reached",
  crashed: 'This page crashed',
  unresponsive: 'This page is not responding',
};

export const PageErrorOverlay: React.FC<PageErrorOverlayProps> = ({
  errorType,
  errorCode,
  errorDescription,
  onReload,
}) => {
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center px-8 fade-in"
      style={{ background: 'var(--surface-1)', color: 'var(--chrome-fg)' }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}
        aria-hidden
      >
        <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold mb-2 tracking-tight">{MESSAGES[errorType]}</h1>
      {errorDescription && (
        <p className="mb-1 text-sm max-w-md text-center" style={{ color: 'var(--chrome-fg-muted)' }}>
          {errorDescription}
        </p>
      )}
      {errorCode !== undefined && (
        <p className="text-xs mb-6" style={{ color: 'var(--chrome-fg-muted)' }}>
          Error code: {errorCode}
        </p>
      )}
      <button
        onClick={onReload}
        className="px-5 py-2 text-sm font-medium text-white rounded-lg"
        style={{
          background: 'var(--accent-gradient)',
          boxShadow: 'var(--shadow-md)',
          transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }}
      >
        Reload
      </button>
    </div>
  );
};
