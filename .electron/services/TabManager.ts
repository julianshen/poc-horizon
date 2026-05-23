import { BrowserView, BrowserWindow } from 'electron';
import { writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Tab } from '../../src/types/browser';
import type { HistoryManager } from './HistoryManager';

export class TabManager {
  private tabs = new Map<string, { tab: Tab; view: BrowserView }>();
  private activeTabId: string | null = null;
  private window: BrowserWindow;
  private historyManager: HistoryManager;
  private readonly partition?: string;
  private changeListeners = new Set<() => void>();

  constructor(window: BrowserWindow, historyManager: HistoryManager, partition?: string) {
    this.window = window;
    this.historyManager = historyManager;
    this.partition = partition;
  }

  /** True if this manager's tabs use a non-default (incognito) partition. */
  isIncognito(): boolean {
    return this.partition === 'incognito';
  }

  /** Subscribe to any change in the tab set (create/close/activate/update/reorder/pin/mute). */
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
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
        partition: this.partition,
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
    view.setAutoResize({ width: true, height: true });
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

    wc.on('did-navigate', (_event, url) => {
      const entry = this.tabs.get(tabId);
      const canGoBack = wc.navigationHistory.canGoBack();
      const canGoForward = wc.navigationHistory.canGoForward();
      this.updateTab(tabId, { url, canGoBack, canGoForward });
      if (!this.isIncognito()) this.historyManager.addEntry(url, entry?.tab.title ?? '');
      this.safeSend('navigation:state', {
        tabId,
        canGoBack,
        canGoForward,
        isLoading: entry?.tab.isLoading ?? false,
        url,
      });
    });

    wc.on('page-title-updated', (_event, title) => {
      this.updateTab(tabId, { title });
      const entry = this.tabs.get(tabId);
      if (entry?.tab.url && !this.isIncognito()) {
        this.historyManager.addEntry(entry.tab.url, title);
      }
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

    const bounds = this.window.getBounds();
    // Dia layout: titlebar 36 + tabbar 30 + toolbar 48 + bookmarks 32 = 146
    // Content sits in a floating card with 12px side/bottom inset.
    const chromeHeight = 146;
    const inset = 12;
    current.view.setBounds({
      x: inset,
      y: chromeHeight,
      width: Math.max(0, bounds.width - inset * 2),
      height: Math.max(0, bounds.height - chromeHeight - inset),
    });

    this.safeSend('tab:activated', { tabId });
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
    if (entry) {
      entry.view.webContents.toggleDevTools();
    }
  }

  openDevTools(tabId: string, mode: 'right' | 'bottom' | 'undocked'): void {
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
