import fs from 'fs';
import type { DownloadItem } from '../../src/types/browser';

export type DownloadListener = (items: DownloadItem[]) => void;

export class DownloadStore {
  private items: Map<string, DownloadItem> = new Map();
  private listeners: Set<DownloadListener> = new Set();

  constructor(private downloadsPath: string) {
    this.load();
  }

  private load(): void {
    try {
      const data = fs.readFileSync(this.downloadsPath, 'utf-8');
      const items: DownloadItem[] = JSON.parse(data);
      items.forEach((item) => this.items.set(item.id, item));
    } catch {
      // empty store
    }
  }

  private save(): void {
    fs.writeFileSync(
      this.downloadsPath,
      JSON.stringify(Array.from(this.items.values()), null, 2)
    );
  }

  getAll(): DownloadItem[] {
    return Array.from(this.items.values());
  }

  upsert(item: DownloadItem): void {
    this.items.set(item.id, item);
    this.notify();
  }

  setState(id: string, state: DownloadItem['state']): void {
    const item = this.items.get(id);
    if (!item) return;
    item.state = state;
    this.notify();
  }

  finalize(id: string, state: DownloadItem['state'], endTime: number): void {
    const item = this.items.get(id);
    if (!item) return;
    item.state = state;
    item.endTime = endTime;
    this.save();
    this.notify();
  }

  clearCompleted(): void {
    for (const [id, item] of this.items) {
      if (item.state === 'completed' || item.state === 'cancelled') {
        this.items.delete(id);
      }
    }
    this.save();
    this.notify();
  }

  onUpdate(callback: DownloadListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(): void {
    const items = this.getAll();
    this.listeners.forEach((cb) => cb(items));
  }
}
