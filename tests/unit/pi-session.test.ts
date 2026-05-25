// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { PiSession } from '@electron/services/PiSession';
import type { BrowserHarness } from '@electron/services/BrowserHarness';
import type { AgentEvent } from '../../src/types/ai';

// Mock child_process.spawn — return a fake process whose stdout we drive
// directly to simulate Pi's JSON-line output.
interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: Writable;
  killed: boolean;
  kill: () => void;
  writes: string[];
}

let lastProc: FakeProc | null = null;

// Stand-in for child_process.stdout: just an EventEmitter with a no-op
// setEncoding so PiSession's stdout!.setEncoding('utf8') call doesn't
// blow up, plus emit('data', …) that drives the parser.
class FakeStream extends EventEmitter { setEncoding(_e: string): this { return this; } }

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const procEvents = new EventEmitter();
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const writes: string[] = [];
    const stdin = new Writable({
      write(chunk, _enc, cb) { writes.push(chunk.toString('utf8')); cb(); },
    });
    const proc = Object.assign(procEvents, {
      stdout, stderr, stdin, writes,
      killed: false,
      kill(): void { this.killed = true; this.emit('exit', 0); },
    }) as unknown as FakeProc;
    lastProc = proc;
    return proc;
  }),
}));

function emit(line: object): void {
  (lastProc!.stdout as FakeStream).emit('data', JSON.stringify(line) + '\n');
}

describe('PiSession', () => {
  let session: PiSession;
  let events: AgentEvent[];
  let sessionPaths: string[];
  let harness: BrowserHarness;

  beforeEach(() => {
    harness = {} as BrowserHarness;
    session = new PiSession({ binary: 'pi', args: [], maxIterations: 24 }, harness);
    events = [];
    sessionPaths = [];
    session.on('event', (e: AgentEvent) => events.push(e));
    session.on('session', (p: string) => sessionPaths.push(p));
    session.start();
  });

  afterEach(() => { session.dispose(); lastProc = null; });

  it('starts a turn by sending {type:"prompt", message}', async () => {
    await session.startTurn('hello');
    const sent = JSON.parse(lastProc!.writes[0]);
    expect(sent).toMatchObject({ type: 'prompt', message: 'hello' });
  });

  it('streams text_delta from message_update events', () => {
    void session.startTurn('hi');
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' world' } });
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
    ]);
  });

  it('emits tool_use on tool_execution_start and tool_result on tool_execution_end', () => {
    void session.startTurn('go');
    emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'browser_getUrl', args: {} });
    emit({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'browser_getUrl',
           result: { content: [{ type: 'text', text: 'https://x' }] }, isError: false });
    const toolEvents = events.filter((e) => e.type === 'tool_use' || e.type === 'tool_result');
    expect(toolEvents).toEqual([
      { type: 'tool_use', id: 't1', name: 'browser_getUrl', input: {} },
      { type: 'tool_result', id: 't1', output: 'https://x', isError: false },
    ]);
  });

  it('on agent_end emits turn_end and requests get_state to learn the session path', () => {
    void session.startTurn('go');
    emit({ type: 'agent_end' });
    expect(events).toContainEqual({ type: 'turn_end', reason: 'stop' });
    const sentTypes = lastProc!.writes.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(sentTypes).toContain('get_state');
  });

  it('captures the sessionFile from a get_state response and emits "session"', () => {
    void session.startTurn('go');
    emit({ type: 'agent_end' });
    emit({ type: 'response', command: 'get_state', success: true,
           data: { sessionFile: '/tmp/abc.jsonl', isStreaming: false } });
    expect(sessionPaths).toEqual(['/tmp/abc.jsonl']);
  });

  it('cancel sends {type:"abort"} and emits a cancelled turn_end', () => {
    void session.startTurn('go');
    session.cancel();
    const sent = lastProc!.writes.map((l) => JSON.parse(l));
    expect(sent.some((m) => m.type === 'abort')).toBe(true);
    expect(events.some((e) => e.type === 'turn_end' && e.reason === 'cancelled')).toBe(true);
  });

  it('auto-cancels extension UI dialog requests so the agent doesn\'t block', () => {
    void session.startTurn('go');
    emit({ type: 'extension_ui_request', id: 'd1', method: 'confirm', title: 'OK?' });
    const sent = lastProc!.writes.map((l) => JSON.parse(l));
    expect(sent).toContainEqual({ type: 'extension_ui_response', id: 'd1', cancelled: true });
  });

  it('surfaces a failed Pi response as an error event', () => {
    void session.startTurn('go');
    emit({ type: 'response', command: 'prompt', success: false, error: 'boom' });
    expect(events.some((e) => e.type === 'error' && e.message.includes('boom'))).toBe(true);
  });
});
