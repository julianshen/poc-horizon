import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import type { HistoryEntry } from '../../src/types/browser';

export class HistoryManager {
  private db: Database.Database;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'history.db');
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        visitTime INTEGER NOT NULL,
        visitCount INTEGER DEFAULT 1,
        typedCount INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
      CREATE INDEX IF NOT EXISTS idx_history_time ON history(visitTime);
    `);
  }

  addEntry(url: string, title: string): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const existing = this.db.prepare('SELECT * FROM history WHERE url = ?').get(url) as HistoryEntry | undefined;
    if (existing) {
      this.db.prepare('UPDATE history SET visitCount = visitCount + 1, visitTime = ?, title = ? WHERE id = ?')
        .run(Date.now(), title, existing.id);
    } else {
      this.db.prepare('INSERT INTO history (id, url, title, visitTime) VALUES (?, ?, ?, ?)')
        .run(id, url, title, Date.now());
    }
  }

  search(query: string, limit = 50): HistoryEntry[] {
    return this.db.prepare(
      'SELECT * FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY visitTime DESC LIMIT ?'
    ).all(`%${query}%`, `%${query}%`, limit) as HistoryEntry[];
  }

  getRecent(limit = 50): HistoryEntry[] {
    return this.db.prepare('SELECT * FROM history ORDER BY visitTime DESC LIMIT ?').all(limit) as HistoryEntry[];
  }

  clear(range?: string): number {
    const now = Date.now();
    let cutoff = 0;
    if (range === 'hour') cutoff = now - 3600000;
    else if (range === 'day') cutoff = now - 86400000;
    else if (range === 'week') cutoff = now - 604800000;
    else if (range === 'month') cutoff = now - 2592000000;

    if (cutoff > 0) {
      this.db.prepare('DELETE FROM history WHERE visitTime < ?').run(cutoff);
    } else {
      this.db.prepare('DELETE FROM history').run();
    }
    const info = this.db.prepare('SELECT changes() as count').get() as { count: number };
    return info.count;
  }
}
