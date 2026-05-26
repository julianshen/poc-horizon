// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { translateText, translateBatch } from '@electron/services/LlmTranslator';

interface FakeStream extends EventEmitter { setEncoding(enc: string): this }
interface FakeProc extends EventEmitter { stdout: FakeStream; stderr: FakeStream; kill: () => void; killed: boolean }

let lastProc: FakeProc | null = null;
let stdoutPayload = '';

class Stream extends EventEmitter { setEncoding(_e: string): this { return this; } }

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const stdout = new Stream() as FakeStream;
    const stderr = new Stream() as FakeStream;
    const proc = Object.assign(new EventEmitter(), {
      stdout, stderr,
      killed: false,
      kill(): void { this.killed = true; this.emit('exit', null); },
    }) as unknown as FakeProc;
    lastProc = proc;
    // Schedule payload + exit after the next tick.
    setTimeout(() => {
      stdout.emit('data', stdoutPayload);
      proc.emit('exit', 0);
    }, 5);
    return proc;
  }),
}));

beforeEach(() => { lastProc = null; stdoutPayload = ''; });

describe('translateText', () => {
  it('returns trimmed stdout of the pi -p subprocess', async () => {
    stdoutPayload = '  Hola, mundo  \n';
    const r = await translateText('Hello, world', 'Spanish');
    expect(r).toBe('Hola, mundo');
  });

  it('returns null when text is empty', async () => {
    expect(await translateText('', 'Spanish')).toBeNull();
    expect(await translateText('   ', 'Spanish')).toBeNull();
  });

  it('returns null when the subprocess exits with empty stdout', async () => {
    stdoutPayload = '';
    expect(await translateText('hi', 'Spanish')).toBeNull();
  });

  it('returns null when the spawn errors', async () => {
    // Override the next spawn call to emit 'error'.
    stdoutPayload = 'unused';
    const p = translateText('hi', 'Spanish');
    setTimeout(() => lastProc?.emit('error', new Error('ENOENT')), 1);
    expect(await p).toBeNull();
  });
});

describe('translateBatch', () => {
  it('splits the delimited LLM reply back into fragments', async () => {
    stdoutPayload = 'Uno\n‡§HZ§‡\nDos\n‡§HZ§‡\nTres';
    const r = await translateBatch(['One', 'Two', 'Three'], 'Spanish');
    expect(r).toEqual(['Uno', 'Dos', 'Tres']);
  });

  it('returns all nulls when the LLM drifts and breaks the delimiter count', async () => {
    stdoutPayload = 'just one line back, no delimiters';
    const r = await translateBatch(['One', 'Two', 'Three'], 'Spanish');
    expect(r).toEqual([null, null, null]);
  });

  it('returns [] for empty input without spawning', async () => {
    const r = await translateBatch([], 'Spanish');
    expect(r).toEqual([]);
    expect(lastProc).toBeNull();
  });
});
