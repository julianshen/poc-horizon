// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { setupRendererTest } from '../helpers/fakeHorizonAPI';
import { useMenuCommands } from '@/hooks/useMenuCommands';
import { useBrowserStore } from '@/stores/browserStore';
import type { Tab } from '@/types/browser';

const tab = (overrides: Partial<Tab> = {}): Tab => ({
  id: 't1', schemaVersion: 1, url: 'https://example.com', title: 'Ex', isLoading: false,
  loadProgress: 0, canGoBack: false, canGoForward: false, isPinned: false, isMuted: false,
  isActive: true, isHibernated: false, zoomLevel: 1, createdAt: 0, lastAccessedAt: 0,
  ...overrides,
});

describe('useMenuCommands', () => {
  const { api } = setupRendererTest();

  it('find:open toggles showFindBar', () => {
    renderHook(() => useMenuCommands());
    api().emit('menu:command', { command: 'find:open' });
    expect(useBrowserStore.getState().showFindBar).toBe(true);
  });

  it('panel:history / panel:bookmarks / panel:settings each toggle the matching overlay', () => {
    renderHook(() => useMenuCommands());
    api().emit('menu:command', { command: 'panel:history' });
    expect(useBrowserStore.getState().showHistory).toBe(true);
    api().emit('menu:command', { command: 'panel:bookmarks' });
    expect(useBrowserStore.getState().showBookmarks).toBe(true);
    api().emit('menu:command', { command: 'panel:settings' });
    expect(useBrowserStore.getState().showSettings).toBe(true);
  });

  it('bookmark:add dispatches bookmark:add IPC with the active tab', () => {
    useBrowserStore.setState({ activeTabId: 't1', tabs: [tab()] });
    renderHook(() => useMenuCommands());
    api().emit('menu:command', { command: 'bookmark:add' });
    expect(api().invokes).toContainEqual({
      channel: 'bookmark:add',
      payload: { url: 'https://example.com', title: 'Ex' },
    });
  });

  it('bookmark:add is a no-op for horizon:// URLs', () => {
    useBrowserStore.setState({ activeTabId: 't1', tabs: [tab({ url: 'horizon://newtab' })] });
    renderHook(() => useMenuCommands());
    api().emit('menu:command', { command: 'bookmark:add' });
    expect(api().invokes.some((i) => i.channel === 'bookmark:add')).toBe(false);
  });

  it('translate:open opens the TranslationBar if it is closed (idempotent if already open)', () => {
    renderHook(() => useMenuCommands());
    api().emit('menu:command', { command: 'translate:open' });
    expect(useBrowserStore.getState().showTranslationBar).toBe(true);
    // Second emit should NOT toggle it off.
    api().emit('menu:command', { command: 'translate:open' });
    expect(useBrowserStore.getState().showTranslationBar).toBe(true);
  });

  it('translate:restore opens the bar, dispatches horizon:translate-restore, AND invokes the IPC', () => {
    renderHook(() => useMenuCommands());
    const listener = vi.fn();
    window.addEventListener('horizon:translate-restore', listener);
    api().emit('menu:command', { command: 'translate:restore' });
    expect(useBrowserStore.getState().showTranslationBar).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(api().invokes).toContainEqual({ channel: 'translate:restore', payload: undefined });
    window.removeEventListener('horizon:translate-restore', listener);
  });

  it('bookmark:add is a no-op when there is no active tab', () => {
    renderHook(() => useMenuCommands());
    api().emit('menu:command', { command: 'bookmark:add' });
    expect(api().invokes.some((i) => i.channel === 'bookmark:add')).toBe(false);
  });

  it('unknown commands are ignored, not thrown', () => {
    renderHook(() => useMenuCommands());
    expect(() => api().emit('menu:command', { command: 'something:weird' })).not.toThrow();
  });
});
