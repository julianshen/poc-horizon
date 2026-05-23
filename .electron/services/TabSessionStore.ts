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

interface Logger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Persists the list of open tabs to disk so the next launch can restore
 * them. The store is intentionally agnostic of TabManager — main.ts wires
 * the two together via subscribe().
 *
 * Error handling:
 * - load() distinguishes "no file yet" (silent empty) from "file exists
 *   but is unparseable" (logged + quarantined as `<path>.corrupt-<ts>`
 *   so we never overwrite a recoverable session with [] on startup).
 * - save() and the debounced timer never throw out — write failures are
 *   logged and the timer is reset so a bad disk doesn't kill the main
 *   process.
 * - save([]) is rejected when `guardAgainstEmpty` is set, which lets
 *   callers opt out of wiping a populated session when the in-memory
 *   tab list briefly hits zero (e.g. mid-close before the next tab
 *   activates).
 */
export class TabSessionStore {
  private timer: NodeJS.Timeout | null = null;
  private guardAgainstEmpty = true;

  constructor(
    private readonly sessionPath: string,
    private readonly schedule: (cb: () => void, ms: number) => NodeJS.Timeout = setTimeout,
    private readonly cancel: (t: NodeJS.Timeout) => void = clearTimeout,
    private readonly log: Logger = console
  ) {}

  load(): PersistedTab[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.sessionPath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return []; // First launch — expected, silent.
      this.log.warn(`[TabSessionStore] failed to read ${this.sessionPath}:`, err);
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.log.warn(`[TabSessionStore] session file is not an array; ignoring`);
        return [];
      }
      return parsed.filter(isRestorable);
    } catch (err) {
      // Don't lose the user's session — quarantine the bad file so they can
      // recover and we start clean.
      this.log.error(`[TabSessionStore] session file is corrupt; quarantining`, err);
      try {
        fs.renameSync(this.sessionPath, `${this.sessionPath}.corrupt-${Date.now()}`);
      } catch (renameErr) {
        this.log.error(`[TabSessionStore] could not quarantine corrupt session:`, renameErr);
      }
      return [];
    }
  }

  /**
   * Write tabs to disk. Failures are logged, not thrown — callers run in
   * timer callbacks and on app-quit where an uncaught throw would crash
   * the main process or abort shutdown.
   */
  save(tabs: PersistedTab[]): void {
    const restorable = tabs.filter(isRestorable);
    if (this.guardAgainstEmpty && restorable.length === 0) {
      // Don't replace an existing populated session with []. Callers can
      // explicitly clear by passing { allowEmpty: true } via clear().
      return;
    }
    try {
      fs.writeFileSync(this.sessionPath, JSON.stringify(restorable, null, 2));
    } catch (err) {
      this.log.error(`[TabSessionStore] failed to write ${this.sessionPath}:`, err);
    }
  }

  /** Explicitly wipe the session (e.g. user "Clear browsing data"). */
  clear(): void {
    if (this.timer) {
      this.cancel(this.timer);
      this.timer = null;
    }
    try {
      fs.writeFileSync(this.sessionPath, '[]');
    } catch (err) {
      this.log.error(`[TabSessionStore] failed to clear session:`, err);
    }
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
