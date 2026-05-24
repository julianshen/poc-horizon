import { describe, it, expect, beforeEach } from 'vitest';
import { useBrowserStore } from '@/stores/browserStore';
import type { Tab } from '@/types/browser';

const sampleTab = (id: string, overrides: Partial<Tab> = {}): Tab => ({
  id,
  schemaVersion: 1,
  url: `https://${id}.example`,
  title: `Tab ${id}`,
  isLoading: false,
  loadProgress: 0,
  canGoBack: false,
  canGoForward: false,
  isPinned: false,
  isMuted: false,
  isActive: false,
  isHibernated: false,
  zoomLevel: 1,
  createdAt: 0,
  lastAccessedAt: 0,
  ...overrides,
});

// Reset store state between tests. Zustand's `create` returns a hook
// whose underlying store exposes setState/getState — we read the
// initial state once, then reset back to it before each test.
const initialState = useBrowserStore.getState();

beforeEach(() => {
  useBrowserStore.setState({ ...initialState, tabs: [], activeTabId: null }, true);
});

describe('browserStore', () => {
  it('starts empty', () => {
    const s = useBrowserStore.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeTabId).toBeNull();
  });

  it('setTabs() replaces the tab list', () => {
    useBrowserStore.getState().setTabs([sampleTab('a'), sampleTab('b')]);
    expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('setActiveTab() sets activeTabId', () => {
    useBrowserStore.getState().setActiveTab('a');
    expect(useBrowserStore.getState().activeTabId).toBe('a');
  });

  it('updateTab() patches only the matching tab', () => {
    const s = useBrowserStore.getState();
    s.setTabs([sampleTab('a'), sampleTab('b')]);
    s.updateTab('a', { title: 'Updated', isLoading: true });
    const tabs = useBrowserStore.getState().tabs;
    expect(tabs.find((t) => t.id === 'a')?.title).toBe('Updated');
    expect(tabs.find((t) => t.id === 'a')?.isLoading).toBe(true);
    expect(tabs.find((t) => t.id === 'b')?.title).toBe('Tab b');
  });

  it('updateTab() is a no-op for unknown ids', () => {
    const s = useBrowserStore.getState();
    s.setTabs([sampleTab('a')]);
    s.updateTab('missing', { title: 'x' });
    expect(useBrowserStore.getState().tabs).toHaveLength(1);
    expect(useBrowserStore.getState().tabs[0].title).toBe('Tab a');
  });

  it('removeTab() drops the matching tab', () => {
    const s = useBrowserStore.getState();
    s.setTabs([sampleTab('a'), sampleTab('b')]);
    s.removeTab('a');
    expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['b']);
  });

  describe('reorderTab()', () => {
    beforeEach(() => {
      useBrowserStore.getState().setTabs([sampleTab('a'), sampleTab('b'), sampleTab('c'), sampleTab('d')]);
    });

    it('moves a tab to an earlier index', () => {
      useBrowserStore.getState().reorderTab('d', 1);
      expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('moves a tab to a later index', () => {
      useBrowserStore.getState().reorderTab('a', 2);
      expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('is a no-op when the source is missing', () => {
      useBrowserStore.getState().reorderTab('missing', 0);
      expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('is a no-op when the index equals the current position', () => {
      useBrowserStore.getState().reorderTab('b', 1);
      expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('clamps the target index into [0, len-1]', () => {
      useBrowserStore.getState().reorderTab('a', 99);
      expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['b', 'c', 'd', 'a']);
      useBrowserStore.getState().reorderTab('a', -5);
      expect(useBrowserStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  it.each([
    'showSettings',
    'showBookmarks',
    'showHistory',
    'showDownloads',
    'showFindBar',
  ] as const)('toggleOverlay(%s) flips that flag only', (overlay) => {
    const before = useBrowserStore.getState()[overlay];
    useBrowserStore.getState().toggleOverlay(overlay);
    expect(useBrowserStore.getState()[overlay]).toBe(!before);
    useBrowserStore.getState().toggleOverlay(overlay);
    expect(useBrowserStore.getState()[overlay]).toBe(before);
  });
});
