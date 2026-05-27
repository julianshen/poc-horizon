import { promises as fs, existsSync, readFileSync } from "fs";
import { v4 as uuidv4 } from "uuid";

export interface SavedWorkflow {
  id: string;
  name: string;
  prompt: string;
  /** 'activeTab' | 'allTabs' | 'none' — how to attach tabs when running. */
  attach: "activeTab" | "allTabs" | "none";
  createdAt: number;
}

/**
 * Saved workflows = named, reusable Pi prompts that can be triggered
 * with one click. Persisted as JSON next to the other data managers.
 * Write-through (single-writer; user only); read on every call to keep
 * it simple — workflow lists are small (≤100 typically).
 */
export class WorkflowsManager {
  constructor(private readonly filePath: string) {}

  list(): SavedWorkflow[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8"));
      return Array.isArray(data) ? (data as SavedWorkflow[]) : [];
    } catch {
      return [];
    }
  }

  async create(
    input: Omit<SavedWorkflow, "id" | "createdAt">,
  ): Promise<SavedWorkflow> {
    const wf: SavedWorkflow = { ...input, id: uuidv4(), createdAt: Date.now() };
    const next = [...this.list(), wf];
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
    return wf;
  }

  async delete(id: string): Promise<void> {
    const next = this.list().filter((w) => w.id !== id);
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
  }

  get(id: string): SavedWorkflow | undefined {
    return this.list().find((w) => w.id === id);
  }
}
