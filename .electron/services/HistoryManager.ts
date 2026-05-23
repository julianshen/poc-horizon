import fs from 'fs';
import type { HistoryEntry } from '../../src/types/browser';

export class HistoryManager {
  private entries: HistoryEntry[];

  constructor(private historyPath: string) {
    this.entries = this.load();
  }

  private load(): HistoryEntry[] {
    try {
      return JSON.parse(fs.readFileSync(this.historyPath, 'utf-8'));
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
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        url,
        title,
        visitTime: Date.now(),
        visitCount: 1,
        typedCount: 0,
      });
    }
    // Keep only last 5000 entries
    if (this.entries.length > 5000) {
      this.entries = this.entries.slice(-5000);
    }
    this.save();
  }

  search(query: string, limit = 50): HistoryEntry[] {
    const q = query.toLowerCase();
    return this.entries
      .filter((e) => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q))
      .sort((a, b) => b.visitTime - a.visitTime)
      .slice(0, limit);
  }

  getRecent(limit = 50): HistoryEntry[] {
    return [...this.entries].sort((a, b) => b.visitTime - a.visitTime).slice(0, limit);
  }

  clear(range?: string): number {
    const now = Date.now();
    let cutoff = 0;
    if (range === 'hour') cutoff = now - 3600000;
    else if (range === 'day') cutoff = now - 86400000;
    else if (range === 'week') cutoff = now - 604800000;
    else if (range === 'month') cutoff = now - 2592000000;

    const before = this.entries.length;
    if (cutoff > 0) {
      this.entries = this.entries.filter((e) => e.visitTime < cutoff);
    } else {
      this.entries = [];
    }
    this.save();
    return before - this.entries.length;
  }
}
