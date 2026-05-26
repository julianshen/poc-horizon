import { promises as fs } from 'fs';
import * as path from 'path';

interface DomainSkillFile {
  name: string;
  host: string;
  body: string;
  bytes: number;
  updatedAt: number;
}

/**
 * Per-site playbooks the AI agent writes as it learns a site's quirks.
 * Stored on disk under userData/domain-skills/<host>/<name>.md so that
 * notes survive across sessions and across the agent process restarting.
 *
 * Hosts are normalized to lowercase; "www." prefix is stripped so
 * `amazon.com` and `www.amazon.com` share notes. File names must end in
 * `.md` and contain no slashes — paths are confined to the host dir.
 */
export class DomainSkills {
  constructor(private readonly root: string) {}

  static normalizeHost(input: string): string {
    let h = input.toLowerCase().trim();
    if (h.startsWith('www.')) h = h.slice(4);
    if (h.length === 0 || /[\\/]/.test(h)) throw new Error(`invalid host: ${input}`);
    return h;
  }

  private static safeName(name: string): string {
    if (!name.endsWith('.md')) throw new Error('domain skill file must end in .md');
    if (/[\\/]/.test(name) || name.startsWith('.')) throw new Error(`invalid skill name: ${name}`);
    return name;
  }

  private hostDir(host: string): string {
    return path.join(this.root, DomainSkills.normalizeHost(host));
  }

  async list(host: string): Promise<string[]> {
    try {
      const dir = this.hostDir(host);
      const entries = await fs.readdir(dir);
      return entries.filter((e) => e.endsWith('.md')).sort();
    } catch {
      return [];
    }
  }

  async read(host: string, name: string): Promise<DomainSkillFile | null> {
    const safe = DomainSkills.safeName(name);
    const full = path.join(this.hostDir(host), safe);
    try {
      const [body, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
      return { name: safe, host: DomainSkills.normalizeHost(host), body, bytes: stat.size, updatedAt: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  async save(host: string, name: string, body: string): Promise<DomainSkillFile> {
    const safe = DomainSkills.safeName(name);
    const dir = this.hostDir(host);
    await fs.mkdir(dir, { recursive: true });
    const full = path.join(dir, safe);
    await fs.writeFile(full, body, 'utf8');
    const stat = await fs.stat(full);
    return { name: safe, host: DomainSkills.normalizeHost(host), body, bytes: stat.size, updatedAt: stat.mtimeMs };
  }

  async remove(host: string, name: string): Promise<boolean> {
    const safe = DomainSkills.safeName(name);
    const full = path.join(this.hostDir(host), safe);
    try {
      await fs.unlink(full);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Case-insensitive substring search across every saved skill on disk.
   * Returns matches grouped by file with the matching lines + line numbers
   * so the agent can decide which file is worth reading in full. Each hit
   * contributes ~1 to the score; ties broken by recency (mtime).
   *
   * `limit` caps the number of files returned, not the number of lines per
   * file — there's no value in dumping hundreds of files into context.
   */
  async search(query: string, limit = 20): Promise<Array<{ host: string; name: string; lines: Array<{ n: number; text: string }>; score: number; updatedAt: number }>> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hosts = await this.listHosts();
    const hits: Array<{ host: string; name: string; lines: Array<{ n: number; text: string }>; score: number; updatedAt: number }> = [];
    for (const host of hosts) {
      const files = await this.list(host);
      for (const name of files) {
        const skill = await this.read(host, name);
        if (!skill) continue;
        const lines: Array<{ n: number; text: string }> = [];
        skill.body.split('\n').forEach((text, i) => {
          if (text.toLowerCase().includes(q)) lines.push({ n: i + 1, text: text.slice(0, 200) });
        });
        if (lines.length > 0) {
          hits.push({ host, name, lines: lines.slice(0, 5), score: lines.length, updatedAt: skill.updatedAt });
        }
      }
    }
    hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
    return hits.slice(0, limit);
  }

  /** Hosts that have at least one skill on disk. */
  async listHosts(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      return entries.filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      return [];
    }
  }
}
