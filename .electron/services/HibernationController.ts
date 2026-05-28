interface TabRecord {
  id: string;
  url: string;
  pinned: boolean;
  hibernated: boolean;
  createdAt: number;
}

export interface HibernationTabManagerHooks {
  getAllTabs(): TabRecord[];
  getActiveTabId(): string | null;
  isLoading(tabId: string): boolean;
  isAudible(tabId: string): boolean;
  isIncognito(): boolean;
  hibernateTab(tabId: string): boolean;
}

export interface HibernationSettings {
  autoHibernate: boolean;
  hibernationTimeoutMinutes: number;
  maxActiveTabs: number;
}

export interface HibernationControllerOptions {
  tabManager: HibernationTabManagerHooks;
  getSettings: () => HibernationSettings;
  now?: () => number;
  sweepIntervalMs?: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export class HibernationController {
  private readonly tabManager: HibernationTabManagerHooks;
  private readonly getSettings: () => HibernationSettings;
  private readonly now: () => number;
  private readonly sweepIntervalMs: number;
  private readonly lastActivatedAt = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: HibernationControllerOptions) {
    this.tabManager = opts.tabManager;
    this.getSettings = opts.getSettings;
    this.now = opts.now ?? Date.now;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  noteActivated(tabId: string): void {
    this.lastActivatedAt.set(tabId, this.now());
  }

  forgetTab(tabId: string): void {
    this.lastActivatedAt.delete(tabId);
  }

  trackedTabCount(): number {
    return this.lastActivatedAt.size;
  }

  sweep(): void {
    const settings = this.getSettings();
    if (!settings.autoHibernate) return;

    const timeoutMs = Math.max(1, settings.hibernationTimeoutMinutes) * 60_000;
    const cap = Math.max(1, settings.maxActiveTabs);
    const now = this.now();
    const tabs = this.tabManager.getAllTabs();
    const activeId = this.tabManager.getActiveTabId();
    const incognito = this.tabManager.isIncognito();

    const eligible = (t: TabRecord): boolean => {
      if (t.id === activeId) return false;
      if (t.hibernated) return false;
      if (t.pinned) return false;
      if (t.url.startsWith("horizon://")) return false;
      if (incognito) return false;
      if (this.tabManager.isLoading(t.id)) return false;
      if (this.tabManager.isAudible(t.id)) return false;
      return true;
    };

    // Phase 1 — time-based.
    for (const t of tabs) {
      if (!eligible(t)) continue;
      const last = this.lastActivatedAt.get(t.id) ?? t.createdAt;
      if (now - last >= timeoutMs) {
        this.tabManager.hibernateTab(t.id);
      }
    }

    // Phase 2 — count-based safety net.
    const liveEligible = tabs.filter(eligible);
    if (liveEligible.length <= cap) return;
    const surplus = liveEligible.length - cap;
    const victims = liveEligible
      .slice()
      .sort((a, b) => {
        const la = this.lastActivatedAt.get(a.id) ?? a.createdAt;
        const lb = this.lastActivatedAt.get(b.id) ?? b.createdAt;
        if (la !== lb) return la - lb;
        return a.createdAt - b.createdAt;
      })
      .slice(0, surplus);
    for (const v of victims) {
      this.tabManager.hibernateTab(v.id);
    }
  }
}
