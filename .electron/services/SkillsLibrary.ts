import { promises as fs } from "fs";
import * as path from "path";

/**
 * Read-only access to the bundled SKILL.md + interaction-skills/*.md files
 * shipped under resources/pi-extension/skills/. The AI agent pulls these on
 * demand: SKILL.md is the top-level preamble; interaction-skills cover
 * reusable web mechanics like dropdowns, iframes, uploads.
 *
 * Bundled at build time; never written. Domain-specific notes are a
 * separate concern — see DomainSkills.
 */
export class SkillsLibrary {
  constructor(private readonly root: string) {}

  async preamble(): Promise<string> {
    return fs.readFile(path.join(this.root, "SKILL.md"), "utf8");
  }

  async listInteractions(): Promise<string[]> {
    try {
      const dir = path.join(this.root, "interaction-skills");
      const entries = await fs.readdir(dir);
      return entries.filter((e) => e.endsWith(".md")).sort();
    } catch {
      return [];
    }
  }

  async readInteraction(name: string): Promise<string | null> {
    if (!name.endsWith(".md") || /[\\/]/.test(name) || name.startsWith(".")) {
      throw new Error(`invalid skill name: ${name}`);
    }
    try {
      return await fs.readFile(
        path.join(this.root, "interaction-skills", name),
        "utf8",
      );
    } catch {
      return null;
    }
  }
}
