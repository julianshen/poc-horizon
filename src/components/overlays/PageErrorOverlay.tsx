import React from 'react';

interface PageErrorOverlayProps {
  errorType: 'load-failed' | 'crashed' | 'unresponsive';
  errorCode?: number;
  errorDescription?: string;
  onReload: () => void;
}

export const PageErrorOverlay: React.FC<PageErrorOverlayProps> = ({
  errorType,
  errorCode,
  errorDescription,
  onReload,
}) => {
  const messages: Record<string, string> = {
    'load-failed': "This site can't be reached",
    crashed: 'This page crashed',
    unresponsive: 'This page is not responding',
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-40">
      <h1 className="text-2xl font-medium mb-4">{messages[errorType]}</h1>
      {errorDescription && <p className="text-gray-600 mb-4">{errorDescription}</p>}
      {errorCode && <p className="text-gray-400 text-sm mb-4">Error code: {errorCode}</p>}
      <button
        onClick={onReload}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Reload
      </button>
    </div>
  );
};
