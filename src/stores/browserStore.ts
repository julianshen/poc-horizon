import { create } from 'zustand';
import type { Tab } from '../types/browser';

interface BrowserState {
  tabs: Tab[];
  activeTabId: string | null;
  showSettings: boolean;
  showBookmarks: boolean;
  showHistory: boolean;
  showDownloads: boolean;
  showFindBar: boolean;
  showAI: boolean;
  showCmd: boolean;
  // Component-local menus lifted to the store so BrowserContentArea can
  // hide the BrowserView when they're open — Electron's BrowserView paints
  // above all DOM, so an open menu that crosses into the view region would
  // otherwise be hidden behind the page contents.
  showAppMenu: boolean;
  showTabContextMenu: boolean;
  setAppMenuOpen: (open: boolean) => void;
  setTabContextMenuOpen: (open: boolean) => void;
  toggleAI: () => void;
  setTabs: (tabs: Tab[]) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  removeTab: (tabId: string) => void;
  reorderTab: (tabId: string, targetIndex: number) => void;
  toggleOverlay: (overlay: 'showSettings' | 'showBookmarks' | 'showHistory' | 'showDownloads' | 'showFindBar' | 'showCmd') => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: [],
  activeTabId: null,
  showSettings: false,
  showBookmarks: false,
  showHistory: false,
  showDownloads: false,
  showFindBar: false,
  showAI: false,
  showCmd: false,
  showAppMenu: false,
  showTabContextMenu: false,
  setAppMenuOpen: (open) => set({ showAppMenu: open }),
  setTabContextMenuOpen: (open) => set({ showTabContextMenu: open }),
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
  toggleOverlay: (overlay) => set((state) => ({ [overlay]: !state[overlay] })),
}));
