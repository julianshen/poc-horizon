// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { ActionRecorder } from "@electron/services/ActionRecorder";

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rec-"));
  return path.join(dir, "workflows.json");
}

describe("ActionRecorder", () => {
  let file: string;
  let r: ActionRecorder;

  beforeEach(async () => {
    file = await tmpFile();
    r = new ActionRecorder(file);
  });

  it("list() returns [] when no file exists", () => {
    expect(r.list()).toEqual([]);
  });

  it("captures side-effecting tool calls between start and stop", async () => {
    r.start("order-history");
    r.capture("navigate", { url: "https://a.com/orders" });
    r.capture("waitFor", { networkIdleMs: 500 });
    r.capture("click", { x: 100, y: 200 });
    const wf = await r.stop();
    expect(wf.name).toBe("order-history");
    expect(wf.steps).toHaveLength(3);
    expect(wf.steps[0]).toEqual({
      tool: "navigate",
      args: { url: "https://a.com/orders" },
    });
  });

  it("filters out read-only and meta tools from the recording", async () => {
    r.start("foo");
    r.capture("navigate", { url: "https://x" });
    r.capture("screenshot", {}); // read — skipped
    r.capture("axtree", {}); // read — skipped
    r.capture("getUrl", {}); // read — skipped
    r.capture("workflowList", {}); // meta — skipped
    r.capture("click", { x: 1, y: 1 });
    const wf = await r.stop();
    expect(wf.steps.map((s) => s.tool)).toEqual(["navigate", "click"]);
  });

  it("capture is a no-op when not recording", () => {
    r.capture("click", { x: 1, y: 1 });
    expect(r.isRecording()).toBe(false);
  });

  it("start() throws when already recording", () => {
    r.start("a");
    expect(() => r.start("b")).toThrow(/already recording/);
    r.cancel();
  });

  it("overwrites by name on stop", async () => {
    r.start("w");
    r.capture("click", { x: 1, y: 1 });
    await r.stop();
    r.start("w");
    r.capture("click", { x: 2, y: 2 });
    r.capture("type", { text: "hi" });
    await r.stop();
    const wf = r.get("w");
    expect(wf?.steps).toHaveLength(2);
    expect((wf?.steps[0].args as { x: number }).x).toBe(2);
  });

  it("list() returns workflow names without step bodies (cheap)", async () => {
    r.start("a");
    r.capture("navigate", { url: "x" });
    await r.stop();
    r.start("b");
    r.capture("navigate", { url: "y" });
    await r.stop();
    const ls = r.list();
    expect(ls).toHaveLength(2);
    expect(ls.every((w) => w.steps.length === 0)).toBe(true);
  });

  it("get() returns the full workflow including steps", async () => {
    r.start("w");
    r.capture("click", { x: 5, y: 5 });
    await r.stop();
    expect(r.get("w")?.steps).toHaveLength(1);
    expect(r.get("nope")).toBeUndefined();
  });

  it("remove() deletes a workflow and is idempotent", async () => {
    r.start("w");
    r.capture("click", { x: 1, y: 1 });
    await r.stop();
    expect(await r.remove("w")).toBe(true);
    expect(await r.remove("w")).toBe(false);
    expect(r.list()).toEqual([]);
  });

  it("cancel() drops the in-progress recording without persisting", async () => {
    r.start("w");
    r.capture("click", { x: 1, y: 1 });
    r.cancel();
    expect(r.isRecording()).toBe(false);
    expect(r.list()).toEqual([]);
  });

  it("rejects invalid workflow names", () => {
    expect(() => r.start("")).toThrow(/invalid/);
    expect(() => r.start("with/slash")).toThrow(/invalid/);
  });
});
