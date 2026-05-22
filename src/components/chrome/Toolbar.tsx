import React from 'react';
import { Omnibox } from './Omnibox';
import { useNavigation } from '../../hooks/useNavigation';

export const Toolbar: React.FC = () => {
  const { goBack, goForward, reload, canGoBack, canGoForward, isLoading } = useNavigation();

  return (
    <div className="h-[40px] flex items-center gap-2 px-3" style={{ background: 'var(--toolbar-bg)' }}>
      <button
        onClick={goBack}
        disabled={!canGoBack}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"
      >
        ←
      </button>
      <button
        onClick={goForward}
        disabled={!canGoForward}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100 disabled:opacity-30"
      >
        →
      </button>
      <button
        onClick={reload}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100"
      >
        {isLoading ? '✕' : '↻'}
      </button>
      <Omnibox />
      <button className="w-7 h-7 rounded flex items-center justify-center hover:bg-gray-100 ml-auto">
        ⋮
      </button>
    </div>
  );
};
