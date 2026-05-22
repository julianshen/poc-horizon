import { useEffect } from 'react';
import { useBrowserStore } from '../stores/browserStore';

export function useKeyboardShortcuts(): void {
  const { activeTabId, toggleOverlay } = useBrowserStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 't') {
        e.preventDefault();
        window.horizonAPI.invoke('tab:create', {});
      }
      if (mod && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) window.horizonAPI.invoke('tab:close', { tabId: activeTabId });
      }
      if (mod && e.key === 'l') {
        e.preventDefault();
        document.querySelector('input')?.focus();
      }
      if (mod && e.key === 'r') {
        e.preventDefault();
        if (activeTabId) window.horizonAPI.invoke('navigation:reload', { tabId: activeTabId });
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        toggleOverlay('showSettings');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, toggleOverlay]);
}
