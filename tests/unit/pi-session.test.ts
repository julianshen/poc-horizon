// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { Writable } from "stream";
import { PiSession } from "@electron/services/PiSession";
import type { BrowserHarness } from "@electron/services/BrowserHarness";
import type { AgentEvent } from "../../src/types/ai";

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
class FakeStream extends EventEmitter {
  setEncoding(_e: string): this {
    return this;
  }
}

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const procEvents = new EventEmitter();
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const writes: string[] = [];
    const stdin = new Writable({
      write(chunk, _enc, cb) {
        writes.push(chunk.toString("utf8"));
        cb();
      },
    });
    const proc = Object.assign(procEvents, {
      stdout,
      stderr,
      stdin,
      writes,
      killed: false,
      kill(): void {
        this.killed = true;
        this.emit("exit", 0);
      },
    }) as unknown as FakeProc;
    lastProc = proc;
    return proc;
  }),
}));

function emit(line: object): void {
  (lastProc!.stdout as FakeStream).emit("data", JSON.stringify(line) + "\n");
}

describe("PiSession", () => {
  let session: PiSession;
  let events: AgentEvent[];
  let sessionPaths: string[];
  let harness: BrowserHarness;

  beforeEach(() => {
    harness = {} as BrowserHarness;
    session = new PiSession(
      { binary: "pi", args: [], maxIterations: 24 },
      harness,
    );
    events = [];
    sessionPaths = [];
    session.on("event", (e: AgentEvent) => events.push(e));
    session.on("session", (p: string) => sessionPaths.push(p));
    session.start();
  });

  afterEach(() => {
    session.dispose();
    lastProc = null;
  });

  it('starts a turn by sending {type:"prompt", message}', async () => {
    await session.startTurn("hello");
    // PiSession enables auto-compaction on spawn, so the prompt isn't
    // necessarily writes[0] anymore. Find the prompt write specifically.
    const prompt = lastProc!.writes
      .map((w) => JSON.parse(w))
      .find((m) => m.type === "prompt");
    expect(prompt).toMatchObject({ type: "prompt", message: "hello" });
  });

  it("enables Pi auto-compaction on spawn so large screenshot streams do not blow upstream size limits", async () => {
    await session.startTurn("hello");
    const autoComp = lastProc!.writes
      .map((w) => JSON.parse(w))
      .find((m) => m.type === "set_auto_compaction");
    expect(autoComp).toEqual({ type: "set_auto_compaction", enabled: true });
  });

  it('compact() sends a {type:"compact"} message (optionally with customInstructions)', () => {
    session.compact();
    expect(lastProc!.writes.map((w) => JSON.parse(w))).toContainEqual({
      type: "compact",
    });
    session.compact("focus on the cart state");
    expect(lastProc!.writes.map((w) => JSON.parse(w))).toContainEqual({
      type: "compact",
      customInstructions: "focus on the cart state",
    });
  });

  it('emits turn_end (reason:"error") + clears running on upstream LLM error', async () => {
    void session.startTurn("hi");
    expect(session.isRunning).toBe(true);
    // Pi emits this when the upstream LLM call fails outright (size limit,
    // auth, 4xx that auto-retry can't fix). No agent_end follows.
    emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "error",
        reason: "error",
        errorMessage: "400 message size exceeds limit",
      },
    });
    const turnEnd = events.find((e) => e.type === "turn_end");
    expect(turnEnd).toMatchObject({ type: "turn_end", reason: "error" });
    const errEv = events.find((e) => e.type === "error");
    expect(errEv).toMatchObject({ type: "error" });
    expect((errEv as { message: string }).message).toContain(
      "size exceeds limit",
    );
    expect(session.isRunning).toBe(false);
  });

  it("emits turn_end on auto_retry_end with aborted:true (retry gave up)", async () => {
    void session.startTurn("hi");
    expect(session.isRunning).toBe(true);
    emit({
      type: "auto_retry_end",
      aborted: true,
      finalError: "529 overloaded_error: Overloaded",
    });
    const turnEnd = events.find((e) => e.type === "turn_end");
    expect(turnEnd).toMatchObject({ type: "turn_end", reason: "error" });
    expect(session.isRunning).toBe(false);
  });

  it("auto_retry_end with aborted:false (retry succeeded) does NOT end the turn", async () => {
    void session.startTurn("hi");
    emit({ type: "auto_retry_end", aborted: false });
    expect(events.find((e) => e.type === "turn_end")).toBeUndefined();
    expect(session.isRunning).toBe(true);
  });

  it("emits each text_delta immediately without coalescing", () => {
    void session.startTurn("hi");
    emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello" },
    });
    emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: " world" },
    });
    // Each delta is emitted synchronously — no timer waiting required.
    expect(events.filter((e) => e.type === "text_delta")).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
    ]);
  });

  it("emits text_delta before agent_end when they arrive in sequence", () => {
    void session.startTurn("hi");
    emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "done." },
    });
    emit({ type: "agent_end" });
    const types = events.map((e) => e.type);
    expect(types.indexOf("text_delta")).toBeLessThan(types.indexOf("turn_end"));
    expect(events.find((e) => e.type === "text_delta")).toEqual({
      type: "text_delta",
      text: "done.",
    });
  });

  it("emits tool_use on tool_execution_start and tool_result on tool_execution_end", () => {
    void session.startTurn("go");
    emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_getUrl",
      args: {},
    });
    emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "browser_getUrl",
      result: { content: [{ type: "text", text: "https://x" }] },
      isError: false,
    });
    const toolEvents = events.filter(
      (e) => e.type === "tool_use" || e.type === "tool_result",
    );
    expect(toolEvents).toEqual([
      { type: "tool_use", id: "t1", name: "browser_getUrl", input: {} },
      { type: "tool_result", id: "t1", output: "https://x", isError: false },
    ]);
  });

  it("packages image content blocks into an {format,base64,width,height} payload", () => {
    void session.startTurn("go");
    emit({
      type: "tool_execution_start",
      toolCallId: "s1",
      toolName: "browser_screenshot",
      args: {},
    });
    emit({
      type: "tool_execution_end",
      toolCallId: "s1",
      toolName: "browser_screenshot",
      result: {
        content: [{ type: "image", data: "BASE64DATA", mimeType: "image/png" }],
        details: { width: 1280, height: 800 },
      },
      isError: false,
    });
    const result = events.find(
      (e) => e.type === "tool_result" && e.id === "s1",
    );
    expect(result).toMatchObject({
      type: "tool_result",
      output: { format: "png", base64: "BASE64DATA", width: 1280, height: 800 },
    });
  });

  it("on agent_end emits turn_end and requests get_state to learn the session path", () => {
    void session.startTurn("go");
    emit({ type: "agent_end" });
    expect(events).toContainEqual({ type: "turn_end", reason: "stop" });
    const sentTypes = lastProc!.writes.map(
      (l) => (JSON.parse(l) as { type: string }).type,
    );
    expect(sentTypes).toContain("get_state");
  });

  it('captures the sessionFile from a get_state response and emits "session"', () => {
    void session.startTurn("go");
    emit({ type: "agent_end" });
    emit({
      type: "response",
      command: "get_state",
      success: true,
      data: { sessionFile: "/tmp/abc.jsonl", isStreaming: false },
    });
    expect(sessionPaths).toEqual(["/tmp/abc.jsonl"]);
  });

  it('cancel sends {type:"abort"} and emits a cancelled turn_end', () => {
    void session.startTurn("go");
    session.cancel();
    const sent = lastProc!.writes.map((l) => JSON.parse(l));
    expect(sent.some((m) => m.type === "abort")).toBe(true);
    expect(
      events.some((e) => e.type === "turn_end" && e.reason === "cancelled"),
    ).toBe(true);
  });

  it("auto-cancels extension UI dialog requests so the agent doesn't block", () => {
    void session.startTurn("go");
    emit({
      type: "extension_ui_request",
      id: "d1",
      method: "confirm",
      title: "OK?",
    });
    const sent = lastProc!.writes.map((l) => JSON.parse(l));
    expect(sent).toContainEqual({
      type: "extension_ui_response",
      id: "d1",
      cancelled: true,
    });
  });

  it("surfaces a failed Pi response as an error event", () => {
    void session.startTurn("go");
    emit({
      type: "response",
      command: "prompt",
      success: false,
      error: "boom",
    });
    expect(
      events.some((e) => e.type === "error" && e.message.includes("boom")),
    ).toBe(true);
  });

  it("sets isRunning to false and emits turn_end on failed prompt response", async () => {
    void session.startTurn("go");
    expect(session.isRunning).toBe(true);
    emit({
      type: "response",
      command: "prompt",
      success: false,
      error: "exceeds limit",
    });
    expect(
      events.some(
        (e) => e.type === "error" && e.message.includes("exceeds limit"),
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "turn_end" && e.reason === "error"),
    ).toBe(true);
    expect(session.isRunning).toBe(false);
  });

  it("emits error and clears running on turn_end with assistant message error", async () => {
    void session.startTurn("go");
    expect(session.isRunning).toBe(true);
    emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "400 bad request",
      },
      toolResults: [],
    });
    expect(
      events.some(
        (e) => e.type === "error" && e.message.includes("400 bad request"),
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "turn_end" && e.reason === "error"),
    ).toBe(true);
    expect(session.isRunning).toBe(false);
  });

  it("emits error and clears running on agent_end with assistant message error", async () => {
    void session.startTurn("go");
    expect(session.isRunning).toBe(true);
    emit({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "400 context size exceeds limit",
        },
      ],
    });
    expect(
      events.some(
        (e) =>
          e.type === "error" &&
          e.message.includes("400 context size exceeds limit"),
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "turn_end" && e.reason === "error"),
    ).toBe(true);
    expect(session.isRunning).toBe(false);
  });

  it("does not emit duplicate error events on consecutive turn_end and agent_end with errors", async () => {
    void session.startTurn("go");
    expect(session.isRunning).toBe(true);
    emit({
      type: "turn_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "400 bad request",
      },
      toolResults: [],
    });
    emit({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "400 bad request",
        },
      ],
    });
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0]).toMatchObject({
      type: "error",
      message: "400 bad request",
    });
    const turnEndEvents = events.filter(
      (e) => e.type === "turn_end" && e.reason === "error",
    );
    expect(turnEndEvents.length).toBe(1);
    expect(session.isRunning).toBe(false);
  });

  it("does not clear running state or emit turn_end when a non-turn command (e.g. set_auto_compaction) fails", async () => {
    void session.startTurn("go");
    expect(session.isRunning).toBe(true);
    emit({
      type: "response",
      command: "set_auto_compaction",
      success: false,
      error: "compaction not supported",
    });
    // It should emit the error event
    expect(
      events.some(
        (e) =>
          e.type === "error" && e.message.includes("compaction not supported"),
      ),
    ).toBe(true);
    // But it should NOT emit turn_end
    expect(events.some((e) => e.type === "turn_end")).toBe(false);
    // And it should still be running
    expect(session.isRunning).toBe(true);
  });
});
