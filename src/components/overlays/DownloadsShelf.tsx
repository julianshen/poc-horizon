import React, { useCallback } from 'react';
import { useDownloads } from '../../hooks/useDownloads';
import { useBrowserStore } from '../../stores/browserStore';
import { formatBytes } from '../../utils/format';
import type { DownloadItem } from '../../types/browser';

const STATE_LABEL: Record<DownloadItem['state'], string> = {
  progressing: 'Downloading',
  completed: 'Completed',
  cancelled: 'Cancelled',
  interrupted: 'Failed',
};

export const DownloadsShelf: React.FC = () => {
  const { downloads, cancel, open, showInFolder, clearCompleted } = useDownloads();
  const { showDownloads, toggleOverlay } = useBrowserStore();

  const close = useCallback(() => toggleOverlay('showDownloads'), [toggleOverlay]);

  const visible = showDownloads || downloads.some((d) => d.state === 'progressing');
  if (!visible || downloads.length === 0) return null;

  return (
    <div
      className="absolute left-0 right-0 bottom-0 z-40 fade-in"
      style={{
        background: 'var(--surface-overlay)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderTop: '1px solid var(--chrome-border)',
        boxShadow: '0 -4px 12px rgba(15,17,21,0.06)',
      }}
    >
      <div
        className="flex items-center px-4 h-9"
        style={{ borderBottom: '1px solid var(--chrome-border)' }}
      >
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--chrome-fg-muted)' }}>
          Downloads
        </span>
        <button
          onClick={clearCompleted}
          className="ml-auto text-xs px-2 py-1 rounded"
          style={{ color: 'var(--chrome-fg-muted)' }}
        >
          Clear completed
        </button>
        <button
          onClick={close}
          aria-label="Close downloads shelf"
          className="icon-btn ml-1"
          style={{ width: 24, height: 24 }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 py-3">
        {downloads.map((d) => (
          <DownloadCard
            key={d.id}
            item={d}
            onCancel={() => cancel(d.id)}
            onOpen={() => open(d.id)}
            onShow={() => showInFolder(d.id)}
          />
        ))}
      </div>
    </div>
  );
};

interface CardProps {
  item: DownloadItem;
  onCancel: () => void;
  onOpen: () => void;
  onShow: () => void;
}

const DownloadCard: React.FC<CardProps> = ({ item, onCancel, onOpen, onShow }) => {
  const isDone = item.state === 'completed';
  const isProgressing = item.state === 'progressing';
  const pct = item.totalBytes > 0 ? Math.min(100, (item.receivedBytes / item.totalBytes) * 100) : 0;

  return (
    <div
      className="shrink-0 w-64 p-3 rounded-xl"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--chrome-border)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}
          aria-hidden
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" title={item.filename} style={{ color: 'var(--chrome-fg)' }}>
            {item.filename}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--chrome-fg-muted)' }}>
            {STATE_LABEL[item.state]} · {formatBytes(item.receivedBytes)}
            {item.totalBytes > 0 && ` / ${formatBytes(item.totalBytes)}`}
          </div>
        </div>
      </div>
      {isProgressing && (
        <div
          className="h-1 rounded-full overflow-hidden mb-2"
          style={{ background: 'var(--chrome-border)' }}
        >
          <div
            className="h-full"
            style={{
              width: `${pct}%`,
              background: 'var(--accent-gradient)',
              transition: 'width var(--transition-base)',
            }}
          />
        </div>
      )}
      <div className="flex gap-1 text-[11px]">
        {isDone && (
          <>
            <button onClick={onOpen} className="px-2 py-0.5 rounded" style={{ color: 'var(--accent-primary)' }}>Open</button>
            <button onClick={onShow} className="px-2 py-0.5 rounded" style={{ color: 'var(--chrome-fg-muted)' }}>Show in folder</button>
          </>
        )}
        {isProgressing && (
          <button onClick={onCancel} className="px-2 py-0.5 rounded" style={{ color: 'var(--chrome-fg-muted)' }}>Cancel</button>
        )}
      </div>
    </div>
  );
};
