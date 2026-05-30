import { create } from "zustand";
import type { Tab, TabGroup } from "../types/browser";

interface BrowserState {
  tabs: Tab[];
  groups: TabGroup[];
  activeTabId: string | null;
  showSettings: boolean;
  showBookmarks: boolean;
  showHistory: boolean;
  showDownloads: boolean;
  showFindBar: boolean;
  showTranslationBar: boolean;
  translationProgress: { translated: number; total: number } | null;
  setTranslationProgress: (
    progress: { translated: number; total: number } | null,
  ) => void;
  /**
   * Per-tab translation status. Keyed by tabId so completion of a
   * background translation isn't lost when the user switches tabs and
   * back. TranslationBar reads its visible state from the entry for
   * activeTabId; absent = idle.
   */
  translationStatesByTab: Record<
    string,
    { status: "translating" | "done" | "error"; errorMsg?: string }
  >;
  setTranslationStateForTab: (
    tabId: string,
    state: {
      status: "translating" | "done" | "error";
      errorMsg?: string;
    } | null,
  ) => void;
  showAI: boolean;
  showCmd: boolean;
  /** Queue of llms.txt navigation guides pushed by main when a new
   *  origin with an llms.txt is navigated to. AIPanel drains this on
   *  next render so it can append system messages without re-fetching. */
  pendingLlmsGuides: Array<{
    origin: string;
    title?: string;
    summary?: string;
    sections: Array<{
      name: string;
      links: Array<{ title: string; url: string; description?: string }>;
    }>;
    hasFull: boolean;
    skillFile?: string;
  }>;
  pushLlmsGuide: (g: BrowserState["pendingLlmsGuides"][number]) => void;
  consumeLlmsGuides: () => BrowserState["pendingLlmsGuides"];
  /** A pending "ask AI about this selection" request — main pushes,
   *  AIPanel drains by prefilling its draft. Null when nothing pending. */
  pendingSelection: {
    selection: string;
    pageUrl: string;
    pageTitle: string;
  } | null;
  pushSelection: (s: {
    selection: string;
    pageUrl: string;
    pageTitle: string;
  }) => void;
  consumeSelection: () => {
    selection: string;
    pageUrl: string;
    pageTitle: string;
  } | null;
  /** Set true by requestLearnPage() (which also opens the AI panel via
   *  showAI:true) when a "learn this page" trigger fires. AIPanel drains
   *  it by running the learn preset, then clears it via
   *  consumeLearnRequest(). consumeLearnRequest only clears the flag — it
   *  intentionally leaves showAI untouched so the panel stays open while
   *  the agent's reply renders (mirrors consumeSelection). Flag-only: no
   *  return value. */
  pendingLearnRequest: boolean;
  requestLearnPage: () => void;
  consumeLearnRequest: () => void;
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
  upsertGroup: (group: TabGroup) => void;
  removeGroup: (groupId: string) => void;
  toggleOverlay: (
    overlay:
      | "showSettings"
      | "showBookmarks"
      | "showHistory"
      | "showDownloads"
      | "showFindBar"
      | "showCmd"
      | "showTranslationBar",
  ) => void;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  tabs: [],
  groups: [],
  activeTabId: null,
  showSettings: false,
  showBookmarks: false,
  showHistory: false,
  showDownloads: false,
  showFindBar: false,
  showTranslationBar: false,
  translationProgress: null,
  setTranslationProgress: (translationProgress) => set({ translationProgress }),
  translationStatesByTab: {},
  setTranslationStateForTab: (tabId, state) =>
    set((s) => {
      const next = { ...s.translationStatesByTab };
      if (state === null) delete next[tabId];
      else next[tabId] = state;
      return { translationStatesByTab: next };
    }),
  showAI: false,
  showCmd: false,
  showAppMenu: false,
  showTabContextMenu: false,
  setAppMenuOpen: (open) => set({ showAppMenu: open }),
  setTabContextMenuOpen: (open) => set({ showTabContextMenu: open }),
  toggleAI: () => set((state) => ({ showAI: !state.showAI })),
  pendingLlmsGuides: [],
  pushLlmsGuide: (g) =>
    set((state) => ({ pendingLlmsGuides: [...state.pendingLlmsGuides, g] })),
  consumeLlmsGuides: () => {
    let drained: BrowserState["pendingLlmsGuides"] = [];
    set((state) => {
      drained = state.pendingLlmsGuides;
      return { pendingLlmsGuides: [] };
    });
    return drained;
  },
  pendingSelection: null,
  pushSelection: (s) => set({ pendingSelection: s }),
  consumeSelection: () => {
    let drained: BrowserState["pendingSelection"] = null;
    set((state) => {
      drained = state.pendingSelection;
      return { pendingSelection: null };
    });
    return drained;
  },
  pendingLearnRequest: false,
  requestLearnPage: () => set({ showAI: true, pendingLearnRequest: true }),
  consumeLearnRequest: () => set({ pendingLearnRequest: false }),

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
  upsertGroup: (group) =>
    set((state) => {
      const idx = state.groups.findIndex((g) => g.id === group.id);
      if (idx === -1) return { groups: [...state.groups, group] };
      const next = state.groups.slice();
      next[idx] = group;
      return { groups: next };
    }),
  removeGroup: (groupId) =>
    set((state) => ({ groups: state.groups.filter((g) => g.id !== groupId) })),
  toggleOverlay: (overlay) => set((state) => ({ [overlay]: !state[overlay] })),
}));
