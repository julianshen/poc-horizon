import fs from 'fs';

export interface PersistedTab {
  url: string;
  title?: string;
  isPinned?: boolean;
  isActive?: boolean;
}

const DEBOUNCE_MS = 400;
const RESTORABLE = /^(https?:\/\/|horizon:\/\/newtab)/;
const SKIP_PATTERNS = [/^horizon:\/\/error/, /^about:blank$/];

/**
 * Persists the list of open tabs to disk so the next launch can restore
 * them. The store is intentionally agnostic of TabManager — main.ts wires
 * the two together via subscribe().
 */
export class TabSessionStore {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionPath: string,
    private readonly schedule: (cb: () => void, ms: number) => NodeJS.Timeout = setTimeout,
    private readonly cancel: (t: NodeJS.Timeout) => void = clearTimeout
  ) {}

  load(): PersistedTab[] {
    try {
      const raw = fs.readFileSync(this.sessionPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRestorable);
    } catch {
      return [];
    }
  }

  save(tabs: PersistedTab[]): void {
    const restorable = tabs.filter(isRestorable);
    fs.writeFileSync(this.sessionPath, JSON.stringify(restorable, null, 2));
  }

  scheduleSave(tabs: PersistedTab[]): void {
    if (this.timer) this.cancel(this.timer);
    this.timer = this.schedule(() => {
      this.timer = null;
      this.save(tabs);
    }, DEBOUNCE_MS);
  }

  flush(tabs: PersistedTab[]): void {
    if (this.timer) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.save(tabs);
  }
}

function isRestorable(t: PersistedTab): boolean {
  if (!t || typeof t.url !== 'string') return false;
  if (SKIP_PATTERNS.some((p) => p.test(t.url))) return false;
  return RESTORABLE.test(t.url);
}
