import { useEffect } from 'react';
import { useBrowserStore } from '../stores/browserStore';

interface IncomingGuide {
  origin: string;
  title?: string;
  summary?: string;
  sections: Array<{ name: string; links: Array<{ title: string; url: string; description?: string }> }>;
  hasFull: boolean;
  skillFile?: string;
}

/**
 * Listens for ai:llmsTxtFound IPC events sent from main when a tab
 * navigates to an origin with /llms.txt or /llms-full.txt. Pushes the
 * parsed guide into the Zustand queue and opens the AI panel if it's
 * closed — guarantees the user sees the guide even when AIPanel was
 * unmounted at the moment the event fired.
 */
export function useLlmsTxtGuide(): void {
  useEffect(() => {
    const unsub = window.horizonAPI.on('ai:llmsTxtFound', (payload: unknown) => {
      const g = payload as IncomingGuide;
      const store = useBrowserStore.getState();
      store.pushLlmsGuide(g);
      if (!store.showAI) store.toggleAI();
    });
    return unsub;
  }, []);
}
