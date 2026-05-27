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
    translationStatesByTab,
    setTranslationStateForTab,
    toggleOverlay,
  } = useBrowserStore();
  const activeTabId = useBrowserStore((s) => s.activeTabId);

  const [targetLang, setTargetLang] = useState('English');

  // Per-tab status lives in the store — that's how a translation that
  // completes while the user is on a different tab survives the tab
  // switch. The bar's visible status is whatever the active tab's
  // store entry says (absent → idle).
  const tabState = activeTabId ? translationStatesByTab[activeTabId] : undefined;
  const status: 'idle' | 'translating' | 'done' | 'error' = tabState?.status ?? 'idle';
  const errorMsg = tabState?.errorMsg ?? '';

  // Monotonic request id keyed by tabId. Bumped on every translate /
  // restore / cancel / close so stale promise resolutions check seq
  // before applying state — superseded operations drop instead of
  // overwriting the current tab state.
  const requestSeq = useRef<Record<string, number>>({});
  const bumpSeq = useCallback((tabId: string): number => {
    const n = (requestSeq.current[tabId] ?? 0) + 1;
    requestSeq.current[tabId] = n;
    return n;
  }, []);

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

  // Progress events update the per-tab store entry REGARDLESS of which
  // tab is currently active. Switching tabs after a background
  // translation finishes preserves the 'done' state so the user sees
  // "Show Original" when they return.
  // The visible progress bar still tracks the active tab only.
  useEffect(() => {
    if (!showTranslationBar) return;
    const unsub = window.horizonAPI.on('translate:progress', (progress: { tabId: string; translated: number; total: number; done: boolean }) => {
      if (progress.done) {
        setTranslationStateForTab(progress.tabId, { status: 'done' });
      }
      if (progress.tabId === activeTabId) {
        setTranslationProgress({ translated: progress.translated, total: progress.total });
      }
    });
    return unsub;
  }, [showTranslationBar, activeTabId, setTranslationProgress, setTranslationStateForTab]);

  // When the active tab changes, sync the visible progress bar to the
  // new tab (the per-tab status itself is already in the store).
  useEffect(() => {
    setTranslationProgress(null);
  }, [activeTabId, setTranslationProgress]);

  const handleLanguageChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    setTargetLang(newLang);
    window.horizonAPI.invoke('settings:set', { key: 'translateTargetLang', value: newLang }).catch(() => {});
  }, []);

  const handleTranslate = useCallback(async () => {
    if (!activeTabId) return;
    const seq = bumpSeq(activeTabId);
    const tabId = activeTabId;
    setTranslationStateForTab(tabId, { status: 'translating' });
    setTranslationProgress({ translated: 0, total: 100 });
    try {
      const res = (await window.horizonAPI.invoke('translate:page', { targetLang })) as { ok: boolean; error?: string };
      if (seq !== requestSeq.current[tabId]) return;
      if (res && !res.ok) {
        setTranslationStateForTab(tabId, { status: 'error', errorMsg: res.error || 'Translation failed' });
      }
    } catch (err) {
      if (seq !== requestSeq.current[tabId]) return;
      setTranslationStateForTab(tabId, { status: 'error', errorMsg: (err as Error).message || 'Translation failed' });
    }
  }, [targetLang, activeTabId, bumpSeq, setTranslationProgress, setTranslationStateForTab]);

  const handleRestore = useCallback(async () => {
    if (!activeTabId) return;
    bumpSeq(activeTabId);
    setTranslationStateForTab(activeTabId, null);
    setTranslationProgress(null);
    try {
      await window.horizonAPI.invoke('translate:restore');
    } catch (err) {
      setTranslationStateForTab(activeTabId, { status: 'error', errorMsg: (err as Error).message || 'Restore failed' });
    }
  }, [activeTabId, bumpSeq, setTranslationProgress, setTranslationStateForTab]);

  const handleCancel = useCallback(async () => {
    if (!activeTabId) return;
    bumpSeq(activeTabId);
    setTranslationStateForTab(activeTabId, null);
    setTranslationProgress(null);
    try {
      await window.horizonAPI.invoke('translate:cancel');
    } catch (err) {
      setTranslationStateForTab(activeTabId, { status: 'error', errorMsg: (err as Error).message || 'Cancellation failed' });
    }
  }, [activeTabId, bumpSeq, setTranslationProgress, setTranslationStateForTab]);

  const close = useCallback(() => {
    if (activeTabId) bumpSeq(activeTabId);
    toggleOverlay('showTranslationBar');
    setTranslationProgress(null);
    // Leave translationStatesByTab intact — a hidden bar doesn't
    // forget; reopening on a translated tab still shows "Show Original".
  }, [activeTabId, bumpSeq, toggleOverlay, setTranslationProgress]);

  // Menu-driven Restore (useMenuCommands) dispatches this event so the
  // bar's status resets in lockstep with the IPC. Without it, the menu
  // path bypasses handleRestore and the bar shows "Show Original" even
  // though the page has been restored.
  useEffect(() => {
    const onMenuRestore = () => {
      if (!activeTabId) return;
      bumpSeq(activeTabId);
      setTranslationStateForTab(activeTabId, null);
      setTranslationProgress(null);
    };
    window.addEventListener('horizon:translate-restore', onMenuRestore);
    return () => window.removeEventListener('horizon:translate-restore', onMenuRestore);
  }, [activeTabId, bumpSeq, setTranslationProgress, setTranslationStateForTab]);

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
