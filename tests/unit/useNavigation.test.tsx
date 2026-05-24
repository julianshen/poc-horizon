// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNavigation } from '@/hooks/useNavigation';
import { useBrowserStore } from '@/stores/browserStore';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import type { Tab } from '@/types/browser';

const tab = (overrides: Partial<Tab> = {}): Tab => ({
  id: 'a', schemaVersion: 1, url: 'https://a', title: 'A', isLoading: false, loadProgress: 0,
  canGoBack: false, canGoForward: false, isPinned: false, isMuted: false, isActive: true,
  isHibernated: false, zoomLevel: 1, createdAt: 0, lastAccessedAt: 0,
  ...overrides,
});

describe('useNavigation', () => {
  const { api } = setupRendererTest();
  const initialState = useBrowserStore.getState();

  it('derives canGoBack/canGoForward/isLoading from the active tab', () => {
    useBrowserStore.setState({
      ...initialState,
      activeTabId: 'a',
      tabs: [tab({ canGoBack: true, canGoForward: false, isLoading: true })],
    });
    const { result } = renderHook(() => useNavigation());
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('goBack/goForward dispatch IPC with the active tab id', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 'a', tabs: [tab()] });
    const { result } = renderHook(() => useNavigation());
    result.current.goBack();
    result.current.goForward();
    expect(api().invokes).toEqual([
      { channel: 'navigation:back', payload: { tabId: 'a' } },
      { channel: 'navigation:forward', payload: { tabId: 'a' } },
    ]);
  });

  it('goBack/goForward are no-ops when there is no active tab', () => {
    const { result } = renderHook(() => useNavigation());
    result.current.goBack();
    result.current.goForward();
    expect(api().invokes).toEqual([]);
  });

  it('reload dispatches navigation:reload when not currently loading', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 'a', tabs: [tab({ isLoading: false })] });
    const { result } = renderHook(() => useNavigation());
    result.current.reload();
    expect(api().invokes).toEqual([{ channel: 'navigation:reload', payload: { tabId: 'a' } }]);
  });

  it('reload dispatches navigation:stop when currently loading (Chrome parity)', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 'a', tabs: [tab({ isLoading: true })] });
    const { result } = renderHook(() => useNavigation());
    result.current.reload();
    expect(api().invokes).toEqual([{ channel: 'navigation:stop', payload: { tabId: 'a' } }]);
  });

  it('reload is a no-op when there is no active tab', () => {
    const { result } = renderHook(() => useNavigation());
    result.current.reload();
    expect(api().invokes).toEqual([]);
  });
});
