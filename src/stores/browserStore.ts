import { create } from 'zustand';
import type { Tab } from '../types/browser';

interface BrowserState {
  tabs: Tab[];
  activeTabId: string | null;
  isLoading: boolean;
  loadProgress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  url: string;
  showSettings: boolean;
  showBookmarks: boolean;
  showHistory: boolean;
  showDownloads: boolean;
  showFindBar: boolean;
  showAI: boolean;
  showCmd: boolean;
  toggleAI: () => void;
  setTabs: (tabs: Tab[]) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  removeTab: (tabId: string) => void;
  reorderTab: (tabId: string, targetIndex: number) => void;
  setNavigationState: (state: { canGoBack: boolean; canGoForward: boolean; isLoading: boolean; url: string }) => void;
  setLoadProgress: (progress: number) => void;
  toggleOverlay: (overlay: 'showSettings' | 'showBookmarks' | 'showHistory' | 'showDownloads' | 'showFindBar' | 'showCmd') => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: [],
  activeTabId: null,
  isLoading: false,
  loadProgress: 0,
  canGoBack: false,
  canGoForward: false,
  url: '',
  showSettings: false,
  showBookmarks: false,
  showHistory: false,
  showDownloads: false,
  showFindBar: false,
  showAI: false,
  showCmd: false,
  toggleAI: () => set((state) => ({ showAI: !state.showAI })),

  setTabs: (tabs) => set({ tabs }),
  setActiveTab: (activeTabId) => set({ activeTabId }),
  updateTab: (tabId, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    })),
  removeTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.filter((t) => t.id !== tabId),
    })),
  reorderTab: (tabId, targetIndex) =>
    set((state) => {
      const from = state.tabs.findIndex((t) => t.id === tabId);
      if (from === -1) return state;
      const clamped = Math.max(0, Math.min(state.tabs.length - 1, targetIndex));
      if (from === clamped) return state;
      const next = state.tabs.slice();
      const [moved] = next.splice(from, 1);
      next.splice(clamped, 0, moved);
      return { tabs: next };
    }),
  setNavigationState: (state) => set(state),
  setLoadProgress: (loadProgress) => set({ loadProgress }),
  toggleOverlay: (overlay) => set((state) => ({ [overlay]: !state[overlay] })),
}));
