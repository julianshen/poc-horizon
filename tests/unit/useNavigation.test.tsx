// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNavigation } from '@/hooks/useNavigation';
import { useBrowserStore } from '@/stores/browserStore';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';

describe('useNavigation', () => {
  const { api } = setupRendererTest();
  const initialState = useBrowserStore.getState();

  it('returns canGoBack/canGoForward/isLoading from the store', () => {
    useBrowserStore.setState({
      ...initialState,
      activeTabId: 'a',
      canGoBack: true,
      canGoForward: false,
      isLoading: true,
    });
    const { result } = renderHook(() => useNavigation());
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('goBack/goForward dispatch IPC with the active tab id', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 'a' });
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
    useBrowserStore.setState({ ...initialState, activeTabId: 'a', isLoading: false });
    const { result } = renderHook(() => useNavigation());
    result.current.reload();
    expect(api().invokes).toEqual([{ channel: 'navigation:reload', payload: { tabId: 'a' } }]);
  });

  it('reload dispatches navigation:stop when currently loading (Chrome parity)', () => {
    useBrowserStore.setState({ ...initialState, activeTabId: 'a', isLoading: true });
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
