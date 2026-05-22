import { app, DownloadItem, Event, WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import type { DownloadItem as DownloadItemType } from '../../src/types/browser';

export class DownloadManager {
  private downloadsPath: string;
  private downloads: Map<string, DownloadItemType> = new Map();
  private listeners: Set<(items: DownloadItemType[]) => void> = new Set();

  constructor() {
    this.downloadsPath = path.join(app.getPath('userData'), 'downloads.json');
    this.load();
  }

  private load(): void {
    try {
      const data = fs.readFileSync(this.downloadsPath, 'utf-8');
      const items: DownloadItemType[] = JSON.parse(data);
      items.forEach((item) => this.downloads.set(item.id, item));
    } catch {
      // No existing downloads
    }
  }

  private save(): void {
    fs.writeFileSync(this.downloadsPath, JSON.stringify(Array.from(this.downloads.values()), null, 2));
  }

  handleDownload(event: Event, item: DownloadItem, _webContents: WebContents): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const downloadPath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(downloadPath);

    const downloadItem: DownloadItemType = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startTime: Date.now(),
      savePath: downloadPath,
      mimeType: item.getMimeType(),
    };

    // Track active downloads for pause/resume/cancel
    (downloadItem as any)._electronItem = item;

    this.downloads.set(id, downloadItem);
    this.notifyListeners();

    item.on('updated', (_event, state) => {
      downloadItem.receivedBytes = item.getReceivedBytes();
      downloadItem.totalBytes = item.getTotalBytes();
      downloadItem.state = state === 'progressing' ? 'progressing' : 'interrupted';
      this.downloads.set(id, downloadItem);
      this.notifyListeners();
    });

    item.once('done', (_event, state) => {
      downloadItem.state = state === 'completed' ? 'completed' : 'cancelled';
      downloadItem.endTime = Date.now();
      this.downloads.set(id, downloadItem);
      this.save();
      this.notifyListeners();
    });
  }

  getDownloads(): DownloadItemType[] {
    return Array.from(this.downloads.values());
  }

  pause(downloadId: string): void {
    const item = this.downloads.get(downloadId);
    const electronItem = (item as any)?._electronItem as DownloadItem;
    if (electronItem) {
      electronItem.pause();
      item!.state = 'interrupted';
      this.downloads.set(downloadId, item!);
      this.notifyListeners();
    }
  }

  resume(downloadId: string): void {
    const item = this.downloads.get(downloadId);
    const electronItem = (item as any)?._electronItem as DownloadItem;
    if (electronItem) {
      electronItem.resume();
      item!.state = 'progressing';
      this.downloads.set(downloadId, item!);
      this.notifyListeners();
    }
  }

  cancel(downloadId: string): void {
    const item = this.downloads.get(downloadId);
    const electronItem = (item as any)?._electronItem as DownloadItem;
    if (electronItem) {
      electronItem.cancel();
      item!.state = 'cancelled';
      this.downloads.set(downloadId, item!);
      this.save();
      this.notifyListeners();
    }
  }

  clearCompleted(): void {
    for (const [id, item] of this.downloads) {
      if (item.state === 'completed' || item.state === 'cancelled') {
        this.downloads.delete(id);
      }
    }
    this.save();
    this.notifyListeners();
  }

  onUpdate(callback: (items: DownloadItemType[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const items = this.getDownloads();
    this.listeners.forEach((cb) => cb(items));
  }
}
