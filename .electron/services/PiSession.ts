import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { BrowserHarness } from './BrowserHarness';
import type { AgentEvent } from '../../src/types/ai';

interface PiOptions {
  binary: string;
  args: string[];
  maxIterations: number;
}

interface PendingTurn {
  prompt: string;
  iterations: number;
  cancelled: boolean;
}

/**
 * Owns the lifecycle of the Pi agent subprocess and brokers between Pi
 * (which decides what to do) and the BrowserHarness (which does it).
 *
 * Protocol assumption (until we verify against Pi's docs/rpc.md):
 *   Pi speaks JSON-RPC 2.0 over stdio.
 *   - We send: { method: 'session.start', params: { prompt, tools } }
 *   - Pi emits: { method: 'tool_use', params: { id, name, input } }
 *                 (renderer-visible as 'tool_use' AgentEvent)
 *   - We reply: { method: 'tool_result', params: { id, output } }
 *   - Pi emits: { method: 'text_delta', params: { text } }
 *                 streaming natural-language output
 *   - Pi emits: { method: 'turn_end', params: { reason } } → we reset
 *
 * If Pi's real protocol differs, this is the ONE file to change. Tool
 * definitions and the dispatch logic are kept agent-agnostic so an
 * Anthropic/OpenAI direct backend can replace PiSession with the same
 * AgentEvent stream contract.
 */
export class PiSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buf = '';
  private current: PendingTurn | null = null;

  constructor(
    private readonly opts: PiOptions,
    private readonly harness: BrowserHarness,
  ) { super(); }

  /** True if the subprocess is alive. */
  get running(): boolean { return this.proc !== null && !this.proc.killed; }

  /**
   * Spawn the Pi subprocess. Throws if the binary isn't found — caller
   * should surface a 'Pi not installed' UI in that case rather than
   * silently disabling AI.
   */
  start(): void {
    if (this.proc) return;
    const proc = spawn(this.opts.binary, this.opts.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout!.setEncoding('utf8');
    proc.stderr!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => this.onStdout(chunk));
    proc.stderr!.on('data', (chunk: string) => {
      // Non-fatal Pi log lines; surface as a soft error event.
      this.emitEvent({ type: 'error', message: `[pi stderr] ${chunk.trim()}` });
    });
    proc.on('exit', (code) => {
      this.proc = null;
      if (this.current && !this.current.cancelled) {
        this.emitEvent({ type: 'error', message: `Pi subprocess exited (code ${code ?? 'unknown'})` });
      }
      this.current = null;
    });
    proc.on('error', (err) => {
      this.emitEvent({ type: 'error', message: `Pi spawn failed: ${err.message}` });
      this.proc = null;
    });
    this.proc = proc;
  }

  /** Begin a turn with the given user prompt. Streams AgentEvents on 'event'. */
  async startTurn(prompt: string): Promise<void> {
    if (!this.proc) this.start();
    if (!this.proc) return; // start failed → error event already emitted
    if (this.current) {
      // Refuse overlapping turns — Pi's session is single-threaded.
      this.emitEvent({ type: 'error', message: 'Agent is already running. Cancel first.' });
      return;
    }
    this.current = { prompt, iterations: 0, cancelled: false };
    this.send({
      jsonrpc: '2.0',
      method: 'session.start',
      params: { prompt, tools: TOOL_SCHEMAS },
    });
  }

  cancel(): void {
    if (!this.current || !this.proc) return;
    this.current.cancelled = true;
    this.send({ jsonrpc: '2.0', method: 'session.cancel', params: {} });
    this.emitEvent({ type: 'turn_end', reason: 'cancelled' });
    this.current = null;
  }

  /** Shut down the subprocess. Call on app quit. */
  dispose(): void {
    if (!this.proc) return;
    try { this.proc.kill(); } catch { /* */ }
    this.proc = null;
  }

  // ─── Internal: stdio framing + JSON-RPC dispatch ───────────────────

  private onStdout(chunk: string): void {
    this.buf += chunk;
    // Pi (assumed) sends one JSON message per line. Parse line-by-line.
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        const msg = JSON.parse(line) as { method?: string; params?: Record<string, unknown> };
        void this.dispatch(msg);
      } catch (err) {
        this.emitEvent({ type: 'error', message: `Pi sent malformed JSON: ${(err as Error).message}` });
      }
    }
  }

  private async dispatch(msg: { method?: string; params?: Record<string, unknown> }): Promise<void> {
    if (!this.current) return;
    if (msg.method === 'text_delta') {
      this.emitEvent({ type: 'text_delta', text: String(msg.params?.text ?? '') });
      return;
    }
    if (msg.method === 'tool_use') {
      const id = String(msg.params?.id ?? '');
      const name = String(msg.params?.name ?? '');
      const input = (msg.params?.input ?? {}) as Record<string, unknown>;
      this.emitEvent({ type: 'tool_use', id, name, input });
      if (++this.current.iterations > this.opts.maxIterations) {
        this.send({ jsonrpc: '2.0', method: 'session.cancel', params: {} });
        this.emitEvent({ type: 'turn_end', reason: 'max_iterations' });
        this.current = null;
        return;
      }
      const result = await this.runTool(name, input);
      this.emitEvent({ type: 'tool_result', id, output: result.output, isError: result.isError });
      this.send({
        jsonrpc: '2.0',
        method: 'tool_result',
        params: { id, output: result.output, isError: result.isError ?? false },
      });
      return;
    }
    if (msg.method === 'turn_end') {
      const reason = (msg.params?.reason as 'stop' | 'tool_use' | 'max_iterations') ?? 'stop';
      this.emitEvent({ type: 'turn_end', reason });
      this.current = null;
      return;
    }
    // Unknown method — log but don't crash.
    this.emitEvent({ type: 'error', message: `Pi sent unknown method: ${String(msg.method)}` });
  }

  /** Dispatch a tool name to the BrowserHarness. Returns JSON-safe output. */
  private async runTool(name: string, input: Record<string, unknown>): Promise<{ output: unknown; isError?: boolean }> {
    try {
      switch (name) {
        case 'navigate':   await this.harness.navigate(String(input.url));                       return { output: { ok: true } };
        case 'click':      await this.harness.click(input as never);                              return { output: { ok: true } };
        case 'type':       await this.harness.type(input as never);                               return { output: { ok: true } };
        case 'scroll':     await this.harness.scroll(input as never);                             return { output: { ok: true } };
        case 'screenshot': return { output: await this.harness.screenshot() };
        case 'evaluate':   return { output: await this.harness.evaluate(String(input.expression)) };
        case 'getDom':     return { output: await this.harness.getDom(Number(input.depth ?? 4)) };
        case 'getUrl':     return { output: await this.harness.getUrl() };
        case 'getTitle':   return { output: await this.harness.getTitle() };
        default: return { output: { error: `Unknown tool: ${name}` }, isError: true };
      }
    } catch (err) {
      return { output: { error: (err as Error).message }, isError: true };
    }
  }

  private send(msg: object): void {
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  private emitEvent(e: AgentEvent): void {
    this.emit('event', e);
  }
}

/**
 * JSON-schema definitions for each tool, sent to Pi at session start so
 * the underlying LLM knows how to call them. Matches BrowserHarness
 * primitives 1:1.
 */
const TOOL_SCHEMAS = [
  { name: 'navigate',   description: 'Navigate the active tab to a URL.', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'click',      description: 'Click at viewport coordinates.', input_schema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right', 'middle'] } }, required: ['x', 'y'] } },
  { name: 'type',       description: 'Type text into the focused element.', input_schema: { type: 'object', properties: { text: { type: 'string' }, delayMs: { type: 'number' } }, required: ['text'] } },
  { name: 'scroll',     description: 'Scroll the page by a delta.', input_schema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, deltaX: { type: 'number' }, deltaY: { type: 'number' } } } },
  { name: 'screenshot', description: 'Take a PNG screenshot of the visible viewport.', input_schema: { type: 'object', properties: {} } },
  { name: 'evaluate',   description: 'Run a JS expression in the page; returns the value or an error.', input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'getDom',     description: 'Capture the current document tree (depth-limited).', input_schema: { type: 'object', properties: { depth: { type: 'number' } } } },
  { name: 'getUrl',     description: 'Get the current URL of the active tab.', input_schema: { type: 'object', properties: {} } },
  { name: 'getTitle',   description: 'Get the current title of the active tab.', input_schema: { type: 'object', properties: {} } },
];
