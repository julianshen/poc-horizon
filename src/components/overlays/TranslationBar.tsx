import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  const activeTabId = useBrowserStore((s) => s.activeTabId);

  const [targetLang, setTargetLang] = useState('English');
  const [status, setStatus] = useState<'idle' | 'translating' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Monotonic request id. Bumped on every translate / cancel / restore /
  // close. Stale promise resolutions check this before applying state —
  // if the seq they captured no longer matches, their tab/operation is
  // gone and the resolution must be ignored. Otherwise quickly clicking
  // "Translate" twice leaves the first promise alive to overwrite UI.
  const requestSeq = useRef(0);
  // Which tab the last user-initiated translation was for. Used to decide
  // whether the current bar state is "ours" when the active tab changes.
  const lastTranslatedTabId = useRef<string | null>(null);

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

  // Switching tabs while a translation is in flight on a different tab:
  // the bar's local state belongs to the old tab. Reset to idle so the
  // user sees a clean control surface on the new tab; the old tab keeps
  // translating in the background (its progress events get filtered out
  // below).
  useEffect(() => {
    if (lastTranslatedTabId.current && activeTabId !== lastTranslatedTabId.current) {
      setStatus('idle');
      setErrorMsg('');
      setTranslationProgress(null);
    }
  }, [activeTabId, setTranslationProgress]);

  // Subscribe to progress events — filter to the currently-displayed tab.
  useEffect(() => {
    if (!showTranslationBar) return;
    const unsub = window.horizonAPI.on('translate:progress', (progress: { tabId: string; translated: number; total: number; done: boolean }) => {
      if (progress.tabId !== activeTabId) return;
      setTranslationProgress({ translated: progress.translated, total: progress.total });
      if (progress.done) {
        setStatus('done');
      }
    });
    return unsub;
  }, [showTranslationBar, activeTabId, setTranslationProgress]);

  const handleLanguageChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    setTargetLang(newLang);
    window.horizonAPI.invoke('settings:set', { key: 'translateTargetLang', value: newLang }).catch(() => {});
  }, []);

  const handleTranslate = useCallback(async () => {
    const seq = ++requestSeq.current;
    lastTranslatedTabId.current = activeTabId ?? null;
    setStatus('translating');
    setErrorMsg('');
    setTranslationProgress({ translated: 0, total: 100 });
    try {
      const res = (await window.horizonAPI.invoke('translate:page', { targetLang })) as { ok: boolean; error?: string };
      if (seq !== requestSeq.current) return;  // superseded by a newer click
      if (res && !res.ok) {
        setStatus('error');
        setErrorMsg(res.error || 'Translation failed');
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setStatus('error');
      setErrorMsg((err as Error).message || 'Translation failed');
    }
  }, [targetLang, activeTabId, setTranslationProgress]);

  const handleRestore = useCallback(async () => {
    requestSeq.current++;
    setStatus('idle');
    setErrorMsg('');
    setTranslationProgress(null);
    try {
      await window.horizonAPI.invoke('translate:restore');
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message || 'Restore failed');
    }
  }, [setTranslationProgress]);

  const handleCancel = useCallback(async () => {
    requestSeq.current++;
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
    requestSeq.current++;
    toggleOverlay('showTranslationBar');
    setStatus('idle');
    setErrorMsg('');
    setTranslationProgress(null);
  }, [toggleOverlay, setTranslationProgress]);

  // Window-level Escape listener — the onKeyDown on the bar's container
  // never fires reliably because the container isn't focused.
  useEffect(() => {
    if (!showTranslationBar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showTranslationBar, close]);

  if (!showTranslationBar) return null;

  const pct = translationProgress && translationProgress.total > 0
    ? Math.round((translationProgress.translated / translationProgress.total) * 100)
    : 0;

  return (
    <div
      className="absolute top-3 right-20 z-50 fade-in flex items-center gap-3 p-2 pl-4"
      role="dialog"
      aria-label="Translation"
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
