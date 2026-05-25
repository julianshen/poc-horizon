import { useEffect } from 'react';
import { useBrowserStore } from '../stores/browserStore';

interface IncomingSelection {
  selection: string;
  pageUrl: string;
  pageTitle: string;
}

/**
 * Listens for ai:askFromSelection IPC events from main (sent when the
 * user right-clicked a text selection and chose "Ask Horizon"). Opens
 * the AI panel if closed and stashes the selection in the store so
 * AIPanel can prefill its draft.
 */
export function useAskFromSelection(): void {
  useEffect(() => {
    const unsub = window.horizonAPI.on('ai:askFromSelection', (payload: unknown) => {
      const s = payload as IncomingSelection;
      const store = useBrowserStore.getState();
      store.pushSelection(s);
      if (!store.showAI) store.toggleAI();
    });
    return unsub;
  }, []);
}
