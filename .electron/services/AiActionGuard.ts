import { EventEmitter } from 'events';

export type ActionPolicy = 'never' | 'risky' | 'all';

export interface ActionPrompt {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

/**
 * Default set of tools considered "risky" — they cause side effects on
 * the user's session (the page, downloads, registry state). The agent
 * needs the user's nod before running them when policy is 'risky'.
 *
 * Pure read tools (screenshot, axtree, evaluate without writes, getDom,
 * getUrl, getTitle) are NOT in this set — they're cheap and reversible.
 * The agent makes hundreds of those calls per task; prompting on each
 * would be unusable.
 */
const RISKY_TOOLS = new Set<string>([
  'click', 'type', 'scroll',
  'navigate',
  'cdp',              // raw CDP — can do anything; safest to gate
  'callHelper',       // user-saved JS runs in page
  'evaluate',         // arbitrary JS
  'domainSkillSave', 'domainSkillRemove',
  'saveHelper', 'removeHelper',
  'cdpSubscribe', 'cdpUnsubscribe',
]);

/**
 * Decides whether a tool call needs explicit user approval before it
 * runs. Policy is one of:
 *   never  — pass through everything (default; preserves POC behavior)
 *   risky  — block tools in RISKY_TOOLS, allow the rest
 *   all    — block every tool call
 *
 * On a block: emits an `ActionPrompt` to listeners and returns a Promise
 * the caller awaits. The renderer (or whatever owns the UI) calls
 * `decide(id, true|false)` to resolve it. Timeout auto-denies.
 *
 * No UI in here — this is pure plumbing. The owner injects a broadcaster
 * (an EventEmitter listener) that knows how to ferry the prompt to the
 * renderer.
 */
export class AiActionGuard extends EventEmitter {
  private pending = new Map<string, { resolve: (v: boolean) => void; timer: NodeJS.Timeout }>();
  private counter = 0;

  constructor(
    private policyFn: () => ActionPolicy,
    private readonly timeoutMs: number = 60_000,
  ) { super(); }

  needsApproval(tool: string): boolean {
    const p = this.policyFn();
    if (p === 'never') return false;
    if (p === 'all') return true;
    return RISKY_TOOLS.has(tool);
  }

  /** Resolved with true (allow) / false (deny). Auto-denies on timeout. */
  request(tool: string, args: Record<string, unknown>): Promise<boolean> {
    const id = `a${++this.counter}_${Date.now().toString(36)}`;
    const summary = this.summarize(tool, args);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const e = this.pending.get(id);
        if (!e) return;
        this.pending.delete(id);
        e.resolve(false);
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.emit('prompt', { id, tool, args, summary });
    });
  }

  decide(id: string, allow: boolean): boolean {
    const e = this.pending.get(id);
    if (!e) return false;
    clearTimeout(e.timer);
    this.pending.delete(id);
    e.resolve(allow);
    return true;
  }

  cancelAll(): void {
    for (const e of this.pending.values()) {
      clearTimeout(e.timer);
      e.resolve(false);
    }
    this.pending.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Tool-call → human one-liner. Read by the UI, also surfaced in the
   * denial error so the agent learns what was blocked.
   */
  private summarize(tool: string, args: Record<string, unknown>): string {
    switch (tool) {
      case 'navigate':   return `Navigate to ${String(args.url ?? '?')}`;
      case 'click':      return `Click at (${args.x}, ${args.y})`;
      case 'type':       return `Type ${String(args.text ?? '').slice(0, 40)}…`;
      case 'scroll':     return `Scroll by (${args.deltaX ?? 0}, ${args.deltaY ?? 0})`;
      case 'evaluate':   return `Run JS: ${String(args.expression ?? '').slice(0, 60)}…`;
      case 'cdp':        return `Raw CDP: ${String(args.method ?? '')}`;
      case 'callHelper': return `Call helper '${String(args.name ?? '')}'`;
      case 'saveHelper': return `Save helper '${String(args.name ?? '')}'`;
      case 'removeHelper': return `Remove helper '${String(args.name ?? '')}'`;
      case 'domainSkillSave': return `Save note for ${String(args.host)}: ${String(args.name)}`;
      case 'domainSkillRemove': return `Delete note ${String(args.host)}/${String(args.name)}`;
      case 'cdpSubscribe': return `Subscribe to CDP event: ${String(args.method)}`;
      case 'cdpUnsubscribe': return `Unsubscribe CDP event`;
      default: return tool;
    }
  }
}

export const RISKY_TOOL_SET: ReadonlySet<string> = RISKY_TOOLS;
