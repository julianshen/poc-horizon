import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { HistoryEntry, HistoryClearRange } from "../../src/types/browser";

const MAX_ENTRIES = 5000;

const CLEAR_RANGE_OFFSETS: Record<HistoryClearRange, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
};

export class HistoryManager {
  private entries: HistoryEntry[];

  constructor(private historyPath: string) {
    this.entries = this.load();
  }

  private load(): HistoryEntry[] {
    try {
      return JSON.parse(fs.readFileSync(this.historyPath, "utf-8"));
    } catch {
      return [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.historyPath, JSON.stringify(this.entries, null, 2));
  }

  addEntry(url: string, title: string): void {
    const existing = this.entries.find((e) => e.url === url);
    if (existing) {
      existing.visitCount += 1;
      existing.visitTime = Date.now();
      existing.title = title;
    } else {
      this.entries.push({
        id: uuidv4(),
        url,
        title,
        visitTime: Date.now(),
        visitCount: 1,
        typedCount: 0,
      });
    }
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this.save();
  }

  search(query: string, limit = 50): HistoryEntry[] {
    const q = query.toLowerCase();
    return this.entries
      .filter(
        (e) =>
          e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
      )
      .sort((a, b) => b.visitTime - a.visitTime)
      .slice(0, limit);
  }

  getRecent(limit = 50): HistoryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.visitTime - a.visitTime)
      .slice(0, limit);
  }

  clear(range?: HistoryClearRange): number {
    const before = this.entries.length;
    if (range) {
      const cutoff = Date.now() - CLEAR_RANGE_OFFSETS[range];
      this.entries = this.entries.filter((e) => e.visitTime < cutoff);
    } else {
      this.entries = [];
    }
    this.save();
    return before - this.entries.length;
  }
}
