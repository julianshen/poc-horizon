import { useCallback } from 'react';
import { useBrowserStore } from '../stores/browserStore';

export function useNavigation() {
  // Read per-tab navigation state from the active tab itself — the
  // root-level canGoBack/canGoForward/isLoading fields on the store are
  // unused legacy and never updated by the navigation:state IPC.
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const activeTab = useBrowserStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const canGoBack = activeTab?.canGoBack ?? false;
  const canGoForward = activeTab?.canGoForward ?? false;
  const isLoading = activeTab?.isLoading ?? false;

  const goBack = useCallback(() => {
    if (activeTabId) window.horizonAPI.invoke('navigation:back', { tabId: activeTabId });
  }, [activeTabId]);

  const goForward = useCallback(() => {
    if (activeTabId) window.horizonAPI.invoke('navigation:forward', { tabId: activeTabId });
  }, [activeTabId]);

  const reload = useCallback(() => {
    if (activeTabId) {
      if (isLoading) {
        window.horizonAPI.invoke('navigation:stop', { tabId: activeTabId });
      } else {
        window.horizonAPI.invoke('navigation:reload', { tabId: activeTabId });
      }
    }
  }, [activeTabId, isLoading]);

  return { goBack, goForward, reload, canGoBack, canGoForward, isLoading };
}
