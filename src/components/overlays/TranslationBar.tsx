import React, { useState, useCallback, useEffect } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

const POPULAR_LANGUAGES = [
  'English',
  'Spanish',
  'Chinese',
  'French',
  'German',
  'Japanese',
  'Korean',
  'Italian',
  'Portuguese',
  'Russian',
  'Arabic',
];

export const TranslationBar: React.FC = () => {
  const {
    showTranslationBar,
    translationProgress,
    setTranslationProgress,
    toggleOverlay,
  } = useBrowserStore();

  const [targetLang, setTargetLang] = useState('English');
  const [status, setStatus] = useState<'idle' | 'translating' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch initial setting
  useEffect(() => {
    if (!showTranslationBar) return;
    window.horizonAPI.invoke('settings:get', { key: 'translateTargetLang' })
      .then((val) => {
        if (typeof val === 'string' && val.trim()) {
          setTargetLang(val);
        }
      })
      .catch(() => {});
  }, [showTranslationBar]);

  // Subscribe to progress events
  useEffect(() => {
    if (!showTranslationBar) return;
    const unsub = window.horizonAPI.on('translate:progress', (progress: { translated: number; total: number; done: boolean }) => {
      setTranslationProgress({ translated: progress.translated, total: progress.total });
      if (progress.done) {
        setStatus('done');
      }
    });
    return unsub;
  }, [showTranslationBar, setTranslationProgress]);

  const handleLanguageChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    setTargetLang(newLang);
    window.horizonAPI.invoke('settings:set', { key: 'translateTargetLang', value: newLang }).catch(() => {});
  }, []);

  const handleTranslate = useCallback(async () => {
    setStatus('translating');
    setErrorMsg('');
    setTranslationProgress({ translated: 0, total: 100 });
    try {
      const res = (await window.horizonAPI.invoke('translate:page', { targetLang })) as { ok: boolean; error?: string };
      if (res && !res.ok) {
        setStatus('error');
        setErrorMsg(res.error || 'Translation failed');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message || 'Translation failed');
    }
  }, [targetLang, setTranslationProgress]);

  const handleRestore = useCallback(async () => {
    setStatus('idle');
    setTranslationProgress(null);
    try {
      await window.horizonAPI.invoke('translate:restore');
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message || 'Restore failed');
    }
  }, [setTranslationProgress]);

  const handleCancel = useCallback(async () => {
    setStatus('idle');
    setTranslationProgress(null);
    try {
      await window.horizonAPI.invoke('translate:cancel');
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message || 'Cancellation failed');
    }
  }, [setTranslationProgress]);

  const close = useCallback(() => {
    toggleOverlay('showTranslationBar');
    setTranslationProgress(null);
  }, [toggleOverlay, setTranslationProgress]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    },
    [close]
  );

  if (!showTranslationBar) return null;

  const pct = translationProgress && translationProgress.total > 0
    ? Math.round((translationProgress.translated / translationProgress.total) * 100)
    : 0;

  return (
    <div
      className="absolute top-3 right-20 z-50 fade-in flex items-center gap-3 p-2 pl-4"
      onKeyDown={onKey}
      tabIndex={-1}
      style={{
        background: 'var(--surface-overlay)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        boxShadow: 'var(--shadow-lg)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--chrome-border)',
        outline: 'none',
      }}
    >
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="var(--chrome-fg-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 8h10M4 14h6M9 5v3M12 14c0 3-2 5-5 5M5 19c3 0 5-2 5-5" />
          <path d="M14 20l4-9 4 9M15.5 17h5" />
        </svg>
        <span className="text-xs font-semibold" style={{ color: 'var(--chrome-fg)' }}>
          Translate
        </span>
      </div>

      {status === 'translating' && translationProgress ? (
        <div className="flex items-center gap-2">
          <div
            className="w-24 h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--chrome-bg-hover)' }}
          >
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${pct}%`,
                background: 'var(--accent-color, #1a73e8)',
              }}
            />
          </div>
          <span
            className="text-xs tabular-nums"
            style={{ color: 'var(--chrome-fg-muted)' }}
          >
            {pct}%
          </span>
        </div>
      ) : (
        <select
          value={targetLang}
          onChange={handleLanguageChange}
          className="text-sm bg-transparent outline-none cursor-pointer"
          style={{
            color: 'var(--chrome-fg)',
            border: 'none',
          }}
        >
          {POPULAR_LANGUAGES.map((lang) => (
            <option key={lang} value={lang} style={{ color: '#000' }}>
              {lang}
            </option>
          ))}
          {!POPULAR_LANGUAGES.includes(targetLang) && (
            <option key={targetLang} value={targetLang} style={{ color: '#000' }}>
              {targetLang}
            </option>
          )}
        </select>
      )}

      <div className="flex items-center gap-1.5">
        {status === 'idle' && (
          <button
            onClick={handleTranslate}
            className="text-xs px-2.5 py-1 rounded"
            style={{
              background: 'var(--accent-color, #1a73e8)',
              color: '#fff',
              fontWeight: 500,
            }}
          >
            Translate
          </button>
        )}
        {status === 'translating' && (
          <button
            onClick={handleCancel}
            className="text-xs px-2.5 py-1 rounded"
            style={{
              borderColor: '#fca5a5',
              color: '#b91c1c',
              background: '#fef2f2',
              fontWeight: 500,
              border: '1px solid #fca5a5',
            }}
          >
            Cancel
          </button>
        )}
        {(status === 'done' || status === 'error') && (
          <button
            onClick={handleRestore}
            className="text-xs px-2.5 py-1 rounded border"
            style={{
              borderColor: 'var(--chrome-border)',
              color: 'var(--chrome-fg)',
              background: 'var(--chrome-bg-hover)',
              fontWeight: 500,
            }}
          >
            Show Original
          </button>
        )}
        <button
          onClick={close}
          className="icon-btn"
          aria-label="Close translation bar"
          style={{ width: 28, height: 28 }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>

      {status === 'error' && errorMsg && (
        <div
          className="absolute -bottom-7 right-0 text-xs px-2 py-0.5 rounded shadow-sm whitespace-nowrap"
          style={{
            background: '#fee2e2',
            color: '#991b1b',
            border: '1px solid #fca5a5',
          }}
        >
          {errorMsg}
        </div>
      )}
    </div>
  );
};
