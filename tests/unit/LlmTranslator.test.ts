// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

interface FakeProc extends EventEmitter {
  stdout: EventEmitter & { setEncoding: (e: string) => void };
  stderr: EventEmitter & { setEncoding: (e: string) => void };
  kill: () => void;
  killed: boolean;
}

let lastProc: FakeProc | null = null;

class FakeStream extends EventEmitter {
  setEncoding(_e: string): this {
    return this;
  }
}

vi.mock("child_process", () => ({
  spawn: vi.fn((_bin: string, _args: string[]) => {
    const p = new EventEmitter() as FakeProc;
    p.stdout = new FakeStream();
    p.stderr = new FakeStream();
    p.killed = false;
    p.kill = function () {
      this.killed = true;
      this.emit("exit", 0);
    };
    lastProc = p;
    return p as never;
  }),
}));

const { translateText } = await import("@electron/services/LlmTranslator");

describe("translateText", () => {
  beforeEach(() => {
    lastProc = null;
  });

  it("returns null immediately for empty / whitespace input without spawning Pi", async () => {
    expect(await translateText("", "Spanish")).toBeNull();
    expect(await translateText("   ", "Spanish")).toBeNull();
    expect(lastProc).toBeNull();
  });

  it("returns the trimmed stdout when Pi exits successfully", async () => {
    const promise = translateText("hello", "Spanish");
    // Drive the fake Pi.
    await Promise.resolve();
    lastProc!.stdout.emit("data", "  Hola  \n");
    lastProc!.emit("exit", 0);
    expect(await promise).toBe("Hola");
  });

  it("returns null when Pi prints empty output", async () => {
    const promise = translateText("hi", "Spanish");
    await Promise.resolve();
    lastProc!.stdout.emit("data", "\n\n");
    lastProc!.emit("exit", 0);
    expect(await promise).toBeNull();
  });

  it('returns null when Pi fails to spawn (proc emits "error")', async () => {
    const promise = translateText("hi", "Spanish");
    await Promise.resolve();
    lastProc!.emit("error", new Error("ENOENT"));
    expect(await promise).toBeNull();
  });

  it("returns null and kills Pi on timeout", async () => {
    vi.useFakeTimers();
    const promise = translateText("long text", "Spanish", { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(lastProc!.killed).toBe(true);
    expect(await promise).toBeNull();
    vi.useRealTimers();
  });

  it("returns null immediately if the abort signal is already aborted", async () => {
    const c = new AbortController();
    c.abort();
    expect(
      await translateText("hi", "Spanish", { signal: c.signal }),
    ).toBeNull();
    // No subprocess started.
    expect(lastProc).toBeNull();
  });

  it("aborting mid-flight kills Pi + resolves null", async () => {
    const c = new AbortController();
    const promise = translateText("hi", "Spanish", { signal: c.signal });
    await Promise.resolve();
    expect(lastProc!.killed).toBe(false);
    c.abort();
    expect(lastProc!.killed).toBe(true);
    expect(await promise).toBeNull();
  });

  it("cleanup removes the timeout when Pi exits cleanly (no stray kill later)", async () => {
    vi.useFakeTimers();
    const promise = translateText("hi", "Spanish", { timeoutMs: 5000 });
    await Promise.resolve();
    lastProc!.stdout.emit("data", "Hi");
    lastProc!.emit("exit", 0);
    await promise;
    const procRef = lastProc!;
    // Advance past the timeout — if cleanup didn't clear the timer,
    // kill would fire again here. Either way the proc is already exited.
    await vi.advanceTimersByTimeAsync(10_000);
    // killed flag would be set by the stray timeout if it fired; we
    // assert false because cleanup should have cleared it.
    expect(procRef.killed).toBe(false);
    vi.useRealTimers();
  });
});
