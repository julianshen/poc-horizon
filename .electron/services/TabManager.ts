import { BrowserView, BrowserWindow } from 'electron';
import { writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Tab, TabGroup, TabGroupColor } from '../../src/types/browser';
import type { HistoryManager } from './HistoryManager';
import { buildWebContextMenu } from './webContextMenu';
import { translateText } from './LlmTranslator';

export type TabManagerMode =
  | { kind: 'default'; historyManager: HistoryManager }
  | { kind: 'incognito' };

const INCOGNITO_PARTITION = 'incognito';

/**
 * In-page overlay shown next to the user's text selection while a
 * "Translate selection" is in flight. The overlay starts in
 * "Translating…" state; main runs the LLM in the background and then
 * replaces textContent + flips data-state to "done". A click anywhere
 * outside or the close button removes the overlay.
 */
const SELECTION_TRANSLATE_OVERLAY_SHOW = `(function() {
  document.getElementById('horizon-translate-overlay')?.remove();
  const sel = window.getSelection();
  let rect = null;
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (r && (r.width > 0 || r.height > 0)) rect = r;
  }
  const overlay = document.createElement('div');
  overlay.id = 'horizon-translate-overlay';
  overlay.dataset.state = 'loading';
  overlay.textContent = 'Translating…';
  Object.assign(overlay.style, {
    position: 'fixed',
    zIndex: '2147483647',
    top: (rect ? (rect.bottom + 6) : 80) + 'px',
    left: (rect ? Math.max(8, rect.left) : 8) + 'px',
    maxWidth: '420px',
    minWidth: '180px',
    padding: '10px 14px',
    background: '#ffffff',
    color: '#1a1814',
    border: '0.5px solid rgba(20,15,10,0.14)',
    borderRadius: '10px',
    boxShadow: '0 1px 2px rgba(20,15,10,0.04), 0 12px 32px rgba(20,15,10,0.10)',
    font: '13px -apple-system, BlinkMacSystemFont, "Inter", sans-serif',
    lineHeight: '1.45',
    whiteSpace: 'pre-wrap',
    cursor: 'default',
  });
  const close = document.createElement('button');
  close.textContent = '×';
  Object.assign(close.style, {
    position: 'absolute', top: '2px', right: '6px',
    border: '0', background: 'transparent', color: '#9a948b',
    fontSize: '14px', cursor: 'pointer', padding: '2px 4px',
  });
  close.onclick = () => overlay.remove();
  overlay.appendChild(close);
  document.body.appendChild(overlay);
  const dismiss = (e) => {
    if (!overlay.contains(e.target)) { overlay.remove(); document.removeEventListener('mousedown', dismiss, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 10);
})()`;

export class TabManager {
  private tabs = new Map<string, { tab: Tab; view: BrowserView }>();
  private groups = new Map<string, TabGroup>();
  private activeTabId: string | null = null;
  private window: BrowserWindow;
  private readonly mode: TabManagerMode;
  private changeListeners = new Set<() => void>();
  private navigateListeners = new Set<(url: string, tabId: string) => void>();
  // Rect of the BrowserContentArea slot in the renderer DOM, reported by
  // the renderer via 'ui:contentBounds'. null until the renderer mounts and
  // measures itself for the first time.
  private contentBounds: { x: number; y: number; width: number; height: number } | null = null;

  constructor(window: BrowserWindow, mode: TabManagerMode) {
    this.window = window;
    this.mode = mode;
  }

  /** True when this manager's tabs live in the non-persistent partition. */
  isIncognito(): boolean {
    return this.mode.kind === 'incognito';
  }

  /**
   * Record a navigation in history. A no-op in incognito mode — the
   * HistoryManager isn't even held, so leakage is unrepresentable.
   */
  private recordHistory(url: string, title: string): void {
    if (this.mode.kind === 'default') {
      this.mode.historyManager.addEntry(url, title);
    }
  }

  private partition(): string | undefined {
    return this.mode.kind === 'incognito' ? INCOGNITO_PARTITION : undefined;
  }

  /** Subscribe to any change in the tab set (create/close/activate/update/reorder/pin/mute). */
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /** Subscribe to navigation events from any tab in this window. Fires for
   *  did-navigate AND did-navigate-in-page (SPA pushState etc). */
  onNavigate(fn: (url: string, tabId: string) => void): () => void {
    this.navigateListeners.add(fn);
    return () => this.navigateListeners.delete(fn);
  }

  private emitNavigate(url: string, tabId: string): void {
    for (const fn of this.navigateListeners) {
      try { fn(url, tabId); } catch { /* non-fatal */ }
    }
  }

  private emitChange(): void {
    for (const fn of this.changeListeners) {
      try {
        fn();
      } catch {
        /* listener errors are not fatal */
      }
    }
  }

  /** Send to the chrome renderer if the window/webContents is still alive. */
  private safeSend(channel: string, payload: unknown): void {
    if (this.window.isDestroyed()) return;
    const wc = this.window.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(channel, payload);
    this.emitChange();
  }

  createTab(url = 'horizon://newtab'): Tab {
    const id = uuidv4();
    const view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        partition: this.partition(),
      },
    });

    const tab: Tab = {
      id,
      schemaVersion: 1,
      url,
      title: 'New Tab',
      isLoading: false,
      loadProgress: 0,
      canGoBack: false,
      canGoForward: false,
      isPinned: false,
      isMuted: false,
      isActive: false,
      isHibernated: false,
      zoomLevel: 1.0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.tabs.set(id, { tab, view });
    this.window.addBrowserView(view);
    // No setAutoResize — Electron's native autoResize stretches the view
    // synchronously on window resize using the previous bounds as anchor,
    // ignoring the AI sidebar / chrome layout. That re-introduces the
    // exact overlap fixed by df05cfa for one frame after every resize.
    // The renderer's ResizeObserver + window resize listener already
    // forwards an accurate rect via ui:contentBounds.
    view.webContents.loadURL(url);

    this.setupWebContentsEvents(id, view);
    this.safeSend('tab:created', tab);
    this.activateTab(id);

    return tab;
  }

  private setupWebContentsEvents(tabId: string, view: BrowserView): void {
    const wc = view.webContents;

    wc.on('did-start-loading', () => {
      const entry = this.tabs.get(tabId);
      this.updateTab(tabId, { isLoading: true, loadProgress: 0 });
      this.safeSend('load:started', { tabId, url: entry?.tab.url ?? '' });
    });

    wc.on('did-stop-loading', () => {
      const entry = this.tabs.get(tabId);
      this.updateTab(tabId, { isLoading: false, loadProgress: 100 });
      this.safeSend('load:finished', { tabId, url: entry?.tab.url ?? '' });
    });

    const broadcastNavState = (url: string): void => {
      const entry = this.tabs.get(tabId);
      const canGoBack = wc.navigationHistory.canGoBack();
      const canGoForward = wc.navigationHistory.canGoForward();
      this.updateTab(tabId, { url, canGoBack, canGoForward });
      this.recordHistory(url, entry?.tab.title ?? '');
      this.safeSend('navigation:state', {
        tabId,
        canGoBack,
        canGoForward,
        isLoading: entry?.tab.isLoading ?? false,
        url,
      });
      this.emitNavigate(url, tabId);
    };

    wc.on('did-navigate', (_event, url) => broadcastNavState(url));
    // SPA navigations (history.pushState / replaceState) don't fire
    // 'did-navigate' — they fire 'did-navigate-in-page' instead. Without
    // this handler, modern client-routed apps (Gmail, GitHub PR pages,
    // React/Vue SPAs) would update the BrowserView but the Tab state
    // would stay stale, so Back/Forward buttons appear disabled even
    // though Electron's navigationHistory tracks the entries correctly.
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) broadcastNavState(url);
    });

    // target="_blank" / window.open: open in a new tab in this window
    // instead of letting Electron try to spawn a stray BrowserWindow.
    wc.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: 'deny' };
    });

    // Web-content context menu: build a Chrome-parity native menu from the
    // ContextMenuParams Electron supplies (link / image / selection /
    // editable detection is all in `params.editFlags` + URL fields).
    wc.on('context-menu', (_event, params) => {
      const menu = buildWebContextMenu(params, {
        wc,
        openInNewTab: (url) => this.createTab(url),
        // Tell the chrome renderer to open the AI panel and prefill
        // a prompt with the selection. The chrome's webContents is on
        // this.window — distinct from the BrowserView's wc.
        askAI: (selection) => {
          const chromeWc = this.window.webContents;
          if (chromeWc && !chromeWc.isDestroyed()) {
            chromeWc.send('ai:askFromSelection', {
              selection,
              pageUrl: wc.getURL(),
              pageTitle: wc.getTitle(),
            });
          }
        },
        translateSelection: (selection) => {
          // Pop a small overlay near the selection that says "Translating…",
          // call the LLM in the background, then replace with the result.
          // Live state is kept in window.__horizonTranslateOverlay so a
          // second invocation can reuse / re-position the same box.
          void wc.executeJavaScript(SELECTION_TRANSLATE_OVERLAY_SHOW, true);
          translateText(selection, 'English').then((translated) => {
            const payload = translated ?? '⚠ Translation failed';
            const safe = JSON.stringify(payload);
            void wc.executeJavaScript(`(function(){
              const el = document.getElementById('horizon-translate-overlay');
              if (!el) return;
              el.textContent = ${safe};
              el.dataset.state = 'done';
            })()`, true);
          }).catch(() => { /* */ });
        },
      });
      menu.popup({ window: this.window });
    });

    wc.on('page-title-updated', (_event, title) => {
      this.updateTab(tabId, { title });
      const entry = this.tabs.get(tabId);
      if (entry?.tab.url) this.recordHistory(entry.tab.url, title);
      this.safeSend('page:title', { tabId, title });
    });

    wc.on('page-favicon-updated', (_event, favicons) => {
      if (favicons.length > 0) {
        this.updateTab(tabId, { favicon: favicons[0] });
        this.safeSend('page:favicon', { tabId, faviconUrl: favicons[0] });
      }
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED
      wc.loadURL(`horizon://error?code=${errorCode}&url=${encodeURIComponent(validatedURL)}`);
      this.updateTab(tabId, {
        errorState: { type: 'load-failed', errorCode, errorDescription, validatedURL },
      });
    });

    wc.on('render-process-gone', () => {
      wc.loadURL(`horizon://error/crashed?tabId=${tabId}`);
      this.updateTab(tabId, { errorState: { type: 'crashed' } });
    });
  }

  activateTab(tabId: string): void {
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev) {
        prev.tab.isActive = false;
        prev.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }

    const current = this.tabs.get(tabId);
    if (!current) return;

    current.tab.isActive = true;
    current.tab.lastAccessedAt = Date.now();
    this.activeTabId = tabId;

    this.applyBoundsToActive();

    this.safeSend('tab:activated', { tabId });
  }

  /**
   * The renderer measures its BrowserContentArea slot and reports the rect
   * here. Storing + reapplying eliminates the old magic chromeHeight/inset
   * numbers and makes the BrowserView track AI sidebar toggles + window
   * resizes automatically.
   */
  setContentBounds(rect: { x: number; y: number; width: number; height: number }): void {
    this.contentBounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    this.applyBoundsToActive();
  }

  private applyBoundsToActive(): void {
    if (!this.activeTabId) return;
    const current = this.tabs.get(this.activeTabId);
    if (!current) return;
    const rect = this.contentBounds ?? this.fallbackBounds();
    current.view.setBounds(rect);
  }

  /**
   * Sensible default rect used only until the renderer reports its slot
   * for the first time. Matches the chrome strip heights from the design
   * spec (titlebar 36 + tabbar 30 + toolbar 48 + bookmarks 32 = 146) plus
   * the floating-card 12px inset. The AI sidebar defaults to closed, so
   * full window-width minus the inset is correct at startup. The renderer
   * overwrites this within the first paint frame after mount.
   */
  private fallbackBounds(): { x: number; y: number; width: number; height: number } {
    const w = this.window.getBounds();
    const chromeHeight = 146;
    const inset = 12;
    return {
      x: inset,
      y: chromeHeight,
      width: Math.max(0, w.width - inset * 2),
      height: Math.max(0, w.height - chromeHeight - inset),
    };
  }

  closeTab(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    if (!this.window.isDestroyed()) {
      this.window.removeBrowserView(entry.view);
    }
    const wc = entry.view.webContents as Electron.WebContents & { destroy?: () => void };
    if (wc && !wc.isDestroyed()) {
      // Electron's BrowserView webContents has a destroy() method that
      // releases the renderer process. Optional-chain on the off-chance
      // it's been renamed in a future API revision.
      wc.destroy?.();
    }
    this.tabs.delete(tabId);
    this.safeSend('tab:closed', { tabId });

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.values());
      if (remaining.length > 0) {
        this.activateTab(remaining[remaining.length - 1].tab.id);
      } else {
        this.activeTabId = null;
        this.window.close();
      }
    }
  }

  navigate(tabId: string, url: string): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      // Update tab.url eagerly so the immediately-following did-start-loading
      // event reports the URL we are *navigating to*, not the previous one.
      this.updateTab(tabId, { url });
      entry.view.webContents.loadURL(url);
    }
  }

  goBack(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry?.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack();
    }
  }

  goForward(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry?.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward();
    }
  }

  reload(tabId: string, hard = false): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      if (hard) {
        entry.view.webContents.reloadIgnoringCache();
      } else {
        entry.view.webContents.reload();
      }
    }
  }

  stop(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.view.webContents.stop();
    }
  }

  getTab(tabId: string): Tab | undefined {
    return this.tabs.get(tabId)?.tab;
  }

  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values()).map((t) => t.tab);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  // ─── Tab Groups ──────────────────────────────────────────────────────
  getAllGroups(): TabGroup[] {
    return Array.from(this.groups.values());
  }

  createGroup(name: string, color: TabGroupColor, tabIds: string[] = []): TabGroup {
    const group: TabGroup = { id: uuidv4(), name, color };
    this.groups.set(group.id, group);
    for (const tabId of tabIds) this.assignTabToGroup(tabId, group.id);
    this.safeSend('tabGroup:created', group);
    this.emitChange();
    return group;
  }

  updateGroup(groupId: string, changes: Partial<{ name: string; color: TabGroupColor }>): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    if (changes.name !== undefined) group.name = changes.name;
    if (changes.color !== undefined) group.color = changes.color;
    this.safeSend('tabGroup:updated', group);
    this.emitChange();
  }

  deleteGroup(groupId: string): void {
    if (!this.groups.has(groupId)) return;
    // Remove the groupId from every tab that belonged to it, but leave
    // the tabs themselves intact — same as Chrome's "Ungroup" behavior.
    for (const { tab } of this.tabs.values()) {
      if (tab.groupId === groupId) this.updateTab(tab.id, { groupId: undefined });
    }
    this.groups.delete(groupId);
    this.safeSend('tabGroup:deleted', { groupId });
    this.emitChange();
  }

  assignTabToGroup(tabId: string, groupId: string): void {
    if (!this.groups.has(groupId)) return;
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    this.updateTab(tabId, { groupId });
  }

  removeTabFromGroup(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry || entry.tab.groupId === undefined) return;
    this.updateTab(tabId, { groupId: undefined });
  }

  setZoom(tabId: string, level: number): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      const zoomLevel = Math.log2(level) / Math.log2(1.2);
      entry.view.webContents.setZoomLevel(zoomLevel);
      entry.tab.zoomLevel = level;
    }
  }

  toggleDevTools(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    const wc = entry.view.webContents;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      // 'detach' opens DevTools as a separate window. On BrowserView a
      // docked mode ('right'/'bottom') tries to dock inside the BV's
      // own bounded area, which we explicitly size — the result is that
      // DevTools renders inside the (possibly hidden / clipped) BV slot
      // and the user perceives "nothing happened". A detached window
      // is unambiguously visible.
      wc.openDevTools({ mode: 'detach' });
    }
  }

  openDevTools(tabId: string, mode: 'right' | 'bottom' | 'undocked' | 'detach' = 'detach'): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.view.webContents.openDevTools({ mode });
    }
  }

  print(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (entry) {
      entry.view.webContents.print();
    }
  }

  printToPDF(tabId: string, outputPath: string): Promise<string> {
    const entry = this.tabs.get(tabId);
    if (!entry) throw new Error('Tab not found');
    return entry.view.webContents.printToPDF({}).then(async (data) => {
      await writeFile(outputPath, data);
      return outputPath;
    });
  }

  getBrowserView(tabId: string): BrowserView | undefined {
    return this.tabs.get(tabId)?.view;
  }

  setPinned(tabId: string, pinned: boolean): void {
    this.updateTab(tabId, { isPinned: pinned });
  }

  setMuted(tabId: string, muted: boolean): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    entry.view.webContents.setAudioMuted(muted);
    this.updateTab(tabId, { isMuted: muted });
  }

  duplicate(tabId: string): Tab | undefined {
    const entry = this.tabs.get(tabId);
    if (!entry) return undefined;
    return this.createTab(entry.tab.url);
  }

  closeOthers(tabId: string): void {
    for (const id of Array.from(this.tabs.keys())) {
      if (id !== tabId) this.closeTab(id);
    }
  }

  /**
   * Reorder the tab map so the tab with `tabId` lands at `targetIndex`.
   *
   * Pinned tabs are kept ahead of unpinned in the underlying Map order: a
   * pinned tab is clamped into the pinned region [0, pinnedCount-1] and
   * an unpinned one into [pinnedCount, length-1]. This matches the
   * render-side sort in TabBar and means restored sessions can't come
   * back with a broken pin order.
   */
  reorder(tabId: string, targetIndex: number): void {
    const ids = Array.from(this.tabs.keys());
    const from = ids.indexOf(tabId);
    if (from === -1) return;

    const isPinned = !!this.tabs.get(tabId)?.tab.isPinned;
    const pinnedCount = Array.from(this.tabs.values()).filter((t) => t.tab.isPinned).length;
    const min = isPinned ? 0 : pinnedCount;
    const max = isPinned ? Math.max(0, pinnedCount - 1) : ids.length - 1;
    const clamped = Math.max(min, Math.min(max, targetIndex));
    if (from === clamped) return;

    ids.splice(from, 1);
    ids.splice(clamped, 0, tabId);

    const next = new Map<string, { tab: Tab; view: BrowserView }>();
    for (const id of ids) {
      const entry = this.tabs.get(id);
      if (entry) next.set(id, entry);
    }
    this.tabs = next;
    this.safeSend('tab:reordered', { tabId, index: clamped });
  }

  private updateTab(tabId: string, updates: Partial<Tab>): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    Object.assign(entry.tab, updates);
    // Notify renderer via IPC
    this.safeSend('tab:updated', { ...entry.tab, ...updates });
  }
}
