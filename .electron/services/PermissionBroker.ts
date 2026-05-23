/**
 * Bridges Electron permission requests to a renderer-side prompt.
 *
 * Pure with respect to Electron — it doesn't import session or BrowserWindow.
 * Tests inject the broadcast, id generator, and timeout scheduler so we can
 * verify the routing without a browser.
 */

export type PermissionDecision = 'allow' | 'block';

export interface PermissionPrompt {
  id: string;
  permission: string;
  origin: string;
}

type ElectronCallback = (granted: boolean) => void;
type Broadcaster = (prompt: PermissionPrompt) => void;
type IdGenerator = () => string;
type Schedule = (cb: () => void, ms: number) => NodeJS.Timeout;
type Cancel = (t: NodeJS.Timeout) => void;

// Auto-deny after 60s if the renderer never responds — protects against a
// crashed renderer keeping a Chromium permission callback resident.
const DEFAULT_TIMEOUT_MS = 60_000;

interface PendingEntry {
  callback: ElectronCallback;
  timer: NodeJS.Timeout | null;
}

export class PermissionBroker {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly broadcast: Broadcaster;
  private readonly genId: IdGenerator;
  private readonly schedule: Schedule;
  private readonly cancel: Cancel;
  private readonly timeoutMs: number;

  constructor(
    broadcast: Broadcaster,
    genId: IdGenerator = () => Math.random().toString(36).slice(2, 10),
    schedule: Schedule = setTimeout,
    cancel: Cancel = clearTimeout,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {
    this.broadcast = broadcast;
    this.genId = genId;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timeoutMs = timeoutMs;
  }

  /** Called from the Electron permission request handler. */
  request(permission: string, origin: string, callback: ElectronCallback): string {
    const id = this.genId();
    const timer = this.timeoutMs > 0
      ? this.schedule(() => {
          // Auto-deny on timeout. Mirrors the existing respond() path so the
          // renderer can no longer reply for this id.
          const entry = this.pending.get(id);
          if (!entry) return;
          this.pending.delete(id);
          entry.callback(false);
        }, this.timeoutMs)
      : null;
    this.pending.set(id, { callback, timer });
    this.broadcast({ id, permission, origin });
    return id;
  }

  /** Called when the renderer reports a decision. Returns whether the id was known. */
  respond(id: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    if (entry.timer) this.cancel(entry.timer);
    this.pending.delete(id);
    entry.callback(decision === 'allow');
    return true;
  }

  /** Cancel and block any in-flight prompt (e.g. on tab close). */
  cancelAll(): void {
    for (const entry of this.pending.values()) {
      if (entry.timer) this.cancel(entry.timer);
      entry.callback(false);
    }
    this.pending.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
