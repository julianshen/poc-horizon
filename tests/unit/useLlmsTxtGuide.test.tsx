// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { useBrowserStore } from '@/stores/browserStore';
import { useLlmsTxtGuide } from '@/hooks/useLlmsTxtGuide';

describe('useLlmsTxtGuide', () => {
  const { api } = setupRendererTest();

  it('subscribes to ai:llmsTxtFound on mount + unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useLlmsTxtGuide());
    expect(api().listenerCount('ai:llmsTxtFound')).toBe(1);
    unmount();
    expect(api().listenerCount('ai:llmsTxtFound')).toBe(0);
  });

  it('queues the guide into pendingLlmsGuides and opens the AI panel', () => {
    renderHook(() => useLlmsTxtGuide());
    const guide = {
      origin: 'https://docs.example.com',
      title: 'Example Docs',
      sections: [{ name: 'Guides', links: [{ title: 'Quickstart', url: 'https://x/qs' }] }],
      hasFull: false,
    };
    act(() => api().emit('ai:llmsTxtFound', guide));
    const s = useBrowserStore.getState();
    expect(s.pendingLlmsGuides).toHaveLength(1);
    expect(s.pendingLlmsGuides[0].origin).toBe('https://docs.example.com');
    expect(s.showAI).toBe(true);
  });

  it('does not toggle the AI panel when it is already open', () => {
    useBrowserStore.setState({ showAI: true });
    renderHook(() => useLlmsTxtGuide());
    act(() => api().emit('ai:llmsTxtFound', {
      origin: 'https://x', sections: [], hasFull: false,
    }));
    expect(useBrowserStore.getState().showAI).toBe(true);
  });
});
