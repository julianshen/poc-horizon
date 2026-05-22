import { useCallback } from 'react';
import { useBrowserStore } from '../stores/browserStore';

export function useNavigation() {
  const { activeTabId, canGoBack, canGoForward, isLoading } = useBrowserStore();

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
