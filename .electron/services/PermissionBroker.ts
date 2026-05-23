/**
 * Bridges Electron permission requests to a renderer-side prompt.
 *
 * Pure with respect to Electron — it doesn't import session or BrowserWindow.
 * Tests inject the broadcast and the Electron callback so we can verify
 * the routing without spinning up a browser.
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

export class PermissionBroker {
  private readonly pending = new Map<string, ElectronCallback>();
  private readonly broadcast: Broadcaster;
  private readonly genId: IdGenerator;

  constructor(broadcast: Broadcaster, genId: IdGenerator = () => Math.random().toString(36).slice(2, 10)) {
    this.broadcast = broadcast;
    this.genId = genId;
  }

  /** Called from the Electron permission request handler. */
  request(permission: string, origin: string, callback: ElectronCallback): void {
    const id = this.genId();
    this.pending.set(id, callback);
    this.broadcast({ id, permission, origin });
  }

  /** Called when the renderer reports a decision. */
  respond(id: string, decision: PermissionDecision): boolean {
    const cb = this.pending.get(id);
    if (!cb) return false;
    this.pending.delete(id);
    cb(decision === 'allow');
    return true;
  }

  /** Cancel and block any in-flight prompt (e.g. on tab close). */
  cancelAll(): void {
    for (const cb of this.pending.values()) cb(false);
    this.pending.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
