import { promises as fs, existsSync, readFileSync } from "fs";

export interface Step {
  tool: string;
  args: Record<string, unknown>;
}

export interface ActionWorkflow {
  name: string;
  description?: string;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Tools we never record — they're side-effect-free reads. Replaying them
 * during a run wastes time and inflates the workflow with noise. The
 * agent calls them at run time too, just not from the stored script.
 */
const READ_ONLY = new Set<string>([
  "screenshot",
  "screenshotMarked",
  "axtree",
  "getDom",
  "getUrl",
  "getTitle",
  "describeAt",
  "listHelpers",
  "cdpCollect",
  "domainSkillList",
  "domainSkillRead",
  "domainSkillSearch",
  "skillPreamble",
  "skillListInteractions",
  "skillReadInteraction",
  "tabList",
  "reader_extract",
]);

/**
 * Tools we never record because they ARE the recorder. Lets the agent
 * call them mid-recording without polluting the steps list.
 */
const META = new Set<string>([
  "workflowRecordStart",
  "workflowRecordStop",
  "workflowRun",
  "workflowList",
  "workflowDelete",
]);

/**
 * Records the agent's tool-call stream into a named sequence that can be
 * replayed later. Bridges the LLM-driven world (slow, expensive, fuzzy)
 * and scripted automation (fast, cheap, deterministic).
 *
 * Usage flow:
 *   1. agent calls workflowRecordStart({ name: "foo" })
 *   2. agent does its task, calling navigate/click/type/evaluate/...
 *      (each side-effecting call is appended to the in-progress steps)
 *   3. agent calls workflowRecordStop()
 *   4. later: agent (or user) calls workflowRun({ name: "foo" })
 *      → ActionRecorder dispatches each step back through the bridge,
 *      reusing the existing tool routes.
 */
export class ActionRecorder {
  private active: { name: string; description?: string; steps: Step[] } | null =
    null;

  constructor(private readonly filePath: string) {}

  isRecording(): boolean {
    return this.active !== null;
  }
  activeName(): string | null {
    return this.active?.name ?? null;
  }

  start(name: string, description?: string): void {
    if (this.active)
      throw new Error(`already recording '${this.active.name}'; stop first`);
    if (!name || /[\\/]/.test(name))
      throw new Error(`invalid workflow name: ${name}`);
    this.active = { name, description, steps: [] };
  }

  /** Caller invokes this AFTER a successful tool call. Filters out
   *  read-only + meta tools — they don't need replaying. */
  capture(tool: string, args: Record<string, unknown>): void {
    if (!this.active) return;
    if (READ_ONLY.has(tool) || META.has(tool)) return;
    this.active.steps.push({ tool, args });
  }

  async stop(): Promise<ActionWorkflow> {
    if (!this.active) throw new Error("not recording");
    const all = this.read();
    const existing = all.find((w) => w.name === this.active!.name);
    const now = Date.now();
    const wf: ActionWorkflow = {
      name: this.active.name,
      description: this.active.description,
      steps: this.active.steps,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = all.filter((w) => w.name !== wf.name).concat(wf);
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
    this.active = null;
    return wf;
  }

  /** Cancel an in-progress recording without saving. */
  cancel(): void {
    this.active = null;
  }

  list(): ActionWorkflow[] {
    return this.read().map((w) => ({ ...w, steps: [] })); // name list — bodies fetched on demand
  }

  get(name: string): ActionWorkflow | undefined {
    return this.read().find((w) => w.name === name);
  }

  async remove(name: string): Promise<boolean> {
    const all = this.read();
    if (!all.some((w) => w.name === name)) return false;
    const next = all.filter((w) => w.name !== name);
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
    return true;
  }

  private read(): ActionWorkflow[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8"));
      return Array.isArray(data) ? (data as ActionWorkflow[]) : [];
    } catch {
      return [];
    }
  }
}

export const RECORDABLE_TOOLS = (tool: string): boolean =>
  !READ_ONLY.has(tool) && !META.has(tool);
