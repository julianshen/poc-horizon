import { useEffect } from 'react';
import { useBrowserStore } from '../stores/browserStore';
import type { Tab } from '../types/browser';

export function useTabs(): void {
  const { setTabs, setActiveTab, updateTab, removeTab, reorderTab } = useBrowserStore();

  useEffect(() => {
    const unsubCreated = window.horizonAPI.on('tab:created', (tab: Tab) => {
      const current = useBrowserStore.getState().tabs;
      setTabs([...current, tab]);
      setActiveTab(tab.id);
    });

    const unsubClosed = window.horizonAPI.on('tab:closed', ({ tabId }: { tabId: string }) => {
      removeTab(tabId);
    });

    const unsubActivated = window.horizonAPI.on('tab:activated', ({ tabId }: { tabId: string }) => {
      setActiveTab(tabId);
    });

    const unsubUpdated = window.horizonAPI.on('tab:updated', (updates: Partial<Tab> & { id: string }) => {
      updateTab(updates.id, updates);
    });

    const unsubNavState = window.horizonAPI.on(
      'navigation:state',
      (state: { tabId: string; canGoBack: boolean; canGoForward: boolean; isLoading: boolean; url: string }) => {
        const { tabId, ...rest } = state;
        updateTab(tabId, rest);
      }
    );

    const unsubLoadStarted = window.horizonAPI.on('load:started', ({ tabId, url }: { tabId: string; url: string }) => {
      updateTab(tabId, { isLoading: true, loadProgress: 0, url });
    });

    const unsubLoadFinished = window.horizonAPI.on('load:finished', ({ tabId, url }: { tabId: string; url: string }) => {
      updateTab(tabId, { isLoading: false, loadProgress: 100, url });
    });

    const unsubTitle = window.horizonAPI.on('page:title', ({ tabId, title }: { tabId: string; title: string }) => {
      updateTab(tabId, { title });
    });

    const unsubFavicon = window.horizonAPI.on('page:favicon', ({ tabId, faviconUrl }: { tabId: string; faviconUrl: string }) => {
      updateTab(tabId, { favicon: faviconUrl });
    });

    const unsubReordered = window.horizonAPI.on(
      'tab:reordered',
      ({ tabId, index }: { tabId: string; index: number }) => {
        reorderTab(tabId, index);
      }
    );

    return () => {
      unsubCreated();
      unsubClosed();
      unsubActivated();
      unsubUpdated();
      unsubNavState();
      unsubLoadStarted();
      unsubLoadFinished();
      unsubTitle();
      unsubFavicon();
      unsubReordered();
    };
  }, [setTabs, setActiveTab, updateTab, removeTab, reorderTab]);
}
