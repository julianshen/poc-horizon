import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { BrowserHarness } from './BrowserHarness';
import type { AgentEvent } from '../../src/types/ai';

interface PiOptions {
  binary: string;
  args: string[];
  maxIterations: number;
  /** Extra env vars merged into the subprocess (e.g. HORIZON_BRIDGE_PORT). */
  env?: Record<string, string>;
}

/**
 * Subprocess wrapper for `pi --mode rpc`. Speaks Pi's actual RPC protocol
 * (see /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md):
 *
 *   We send (one JSON object per line on stdin):
 *     {"type":"prompt","message":"..."}     start a turn
 *     {"type":"abort"}                       cancel
 *
 *   Pi emits (one JSON line per event on stdout):
 *     {"type":"agent_start"}
 *     {"type":"message_update", "assistantMessageEvent":
 *        {"type":"text_delta", "delta":"...", "contentIndex":0}}
 *     {"type":"tool_execution_start", "toolCallId":"...", "toolName":"bash", "args":{...}}
 *     {"type":"tool_execution_end",   "toolCallId":"...", "toolName":"bash",
 *        "result":{"content":[{"type":"text","text":"..."}]}, "isError":false}
 *     {"type":"turn_end"} / {"type":"agent_end"}
 *     {"type":"extension_ui_request", "method":"...", "id":"..."} (fire-and-forget or dialog)
 *
 * Pi's built-in tools (bash/read/edit/write) execute INSIDE Pi — they
 * don't reach us. To expose BrowserHarness as agent tools we need a Pi
 * extension (TypeScript file loaded via -e) that registers a 'browser'
 * tool and bridges back to Electron — that's tracked as the next step.
 *
 * For this iteration: we wire prompt/text/abort end-to-end so the AI
 * panel streams Pi's natural-language output and surfaces Pi's tool
 * activity as informational chips.
 */
export class PiSession extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buf = '';
  private running = false;
  /** Pi's session file path, captured from the first get_state response. */
  private sessionFile: string | null = null;
  /** Counter for request IDs we send to Pi (so we can correlate responses). */
  private reqId = 0;

  constructor(
    private readonly opts: PiOptions,
    private readonly harness: BrowserHarness,   // reserved for the extension bridge — read in next commit
  ) {
    super();
    void this.harness;
  }

  get isRunning(): boolean { return this.running; }
  /** Path of the Pi session file on disk, or null if not yet known. */
  get sessionPath(): string | null { return this.sessionFile; }

  /** Spawn the subprocess. Throws if the binary isn't found. */
  start(): void {
    if (this.proc) return;
    const proc = spawn(this.opts.binary, this.opts.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.opts.env ?? {}) },
    });
    proc.stdout!.setEncoding('utf8');
    proc.stderr!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => this.onStdout(chunk));
    proc.stderr!.on('data', (chunk: string) => {
      this.emitEvent({ type: 'error', message: `[pi stderr] ${chunk.trim()}` });
    });
    proc.on('exit', (code) => {
      this.proc = null;
      if (this.running) {
        this.emitEvent({ type: 'error', message: `Pi exited (code ${code ?? 'unknown'})` });
        this.emitEvent({ type: 'turn_end', reason: 'cancelled' });
      }
      this.running = false;
    });
    proc.on('error', (err) => {
      this.emitEvent({ type: 'error', message: `Pi spawn failed: ${err.message}` });
      this.proc = null;
    });
    this.proc = proc;
  }

  async startTurn(prompt: string): Promise<void> {
    if (!this.proc) this.start();
    if (!this.proc) return;
    if (this.running) {
      // Pi will reject overlapping prompts without streamingBehavior; we
      // queue with 'steer' so a second prompt during streaming is delivered
      // after the current turn's tool calls.
      this.send({ type: 'prompt', message: prompt, streamingBehavior: 'steer' });
      return;
    }
    this.running = true;
    this.send({ type: 'prompt', message: prompt });
  }

  cancel(): void {
    if (!this.proc || !this.running) return;
    this.send({ type: 'abort' });
    this.emitEvent({ type: 'turn_end', reason: 'cancelled' });
    this.running = false;
  }

  dispose(): void {
    if (!this.proc) return;
    try { this.proc.kill(); } catch { /* */ }
    this.proc = null;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      let line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length === 0) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        this.dispatch(msg);
      } catch (err) {
        this.emitEvent({ type: 'error', message: `Pi sent malformed JSON: ${(err as Error).message}` });
      }
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    const t = msg.type as string;
    switch (t) {
      case 'agent_start':
        return;

      case 'message_update': {
        const ev = msg.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (ev?.type === 'text_delta' && typeof ev.delta === 'string') {
          this.emitEvent({ type: 'text_delta', text: ev.delta });
        }
        return;
      }

      case 'tool_execution_start': {
        const id = String(msg.toolCallId ?? '');
        const name = String(msg.toolName ?? '');
        const input = (msg.args ?? {}) as Record<string, unknown>;
        this.emitEvent({ type: 'tool_use', id, name, input });
        return;
      }

      case 'tool_execution_end': {
        const id = String(msg.toolCallId ?? '');
        const result = msg.result as { content?: Array<{ text?: string }> } | undefined;
        const isError = Boolean(msg.isError);
        const text = result?.content?.map((c) => c.text ?? '').join('') ?? '';
        this.emitEvent({ type: 'tool_result', id, output: text || result, isError });
        return;
      }

      case 'agent_end':
      case 'turn_end': {
        // Pi emits turn_end after each assistant turn (per tool-call round)
        // and agent_end when the whole prompt completes. We only emit the
        // renderer-visible turn_end on agent_end so the AI panel shows
        // "still working" through intermediate tool-call rounds.
        if (t === 'agent_end') {
          this.emitEvent({ type: 'turn_end', reason: 'stop' });
          this.running = false;
          // Capture the session file path once per process, after the
          // first turn completes (Pi has actually written something to
          // it by now). main listens on 'session' to persist the path.
          if (!this.sessionFile) this.requestSessionFile();
        }
        return;
      }

      case 'extension_ui_request': {
        const method = String(msg.method ?? '');
        const id = String(msg.id ?? '');
        // Dialogs would block Pi; auto-cancel them in v0 so the agent
        // keeps moving. Fire-and-forget methods (notify/setStatus/
        // setWidget/setTitle/set_editor_text) we just ignore.
        if (['select', 'confirm', 'input', 'editor'].includes(method)) {
          this.send({ type: 'extension_ui_response', id, cancelled: true });
        }
        return;
      }

      case 'response': {
        if (msg.success === false) {
          this.emitEvent({ type: 'error', message: `Pi command failed: ${String(msg.error ?? 'unknown')}` });
          return;
        }
        // get_state reply carries sessionFile — persist for later resume.
        if (msg.command === 'get_state') {
          const data = msg.data as { sessionFile?: string } | undefined;
          if (data?.sessionFile && data.sessionFile !== this.sessionFile) {
            this.sessionFile = data.sessionFile;
            this.emit('session', data.sessionFile);
          }
        }
        return;
      }

      // queue_update, compaction_*, auto_retry_* — informational, ignore.
      default:
        return;
    }
  }

  private requestSessionFile(): void {
    this.send({ id: `req-${++this.reqId}`, type: 'get_state' });
  }

  private send(msg: object): void {
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  private emitEvent(e: AgentEvent): void {
    this.emit('event', e);
  }
}
