import { app, DownloadItem as ElectronDownloadItem, Event, WebContents } from 'electron';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { DownloadItem } from '../../src/types/browser';
import { DownloadStore, type DownloadListener } from './DownloadStore';

export class DownloadManager {
  private store: DownloadStore;
  private handles: Map<string, ElectronDownloadItem> = new Map();

  constructor(store: DownloadStore) {
    this.store = store;
  }

  handleDownload(_event: Event, item: ElectronDownloadItem, _wc: WebContents): void {
    const id = uuidv4();
    const downloadPath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(downloadPath);

    const record: DownloadItem = {
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

    this.handles.set(id, item);
    this.store.upsert(record);

    item.on('updated', (_e, state) => {
      const current = this.store.getAll().find((d) => d.id === id);
      if (!current) return;
      this.store.upsert({
        ...current,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: state === 'progressing' ? 'progressing' : 'interrupted',
      });
    });

    item.once('done', (_e, state) => {
      this.handles.delete(id);
      this.store.finalize(id, state === 'completed' ? 'completed' : 'cancelled', Date.now());
    });
  }

  pause(downloadId: string): void {
    const handle = this.handles.get(downloadId);
    if (!handle) return;
    handle.pause();
    this.store.setState(downloadId, 'interrupted');
  }

  resume(downloadId: string): void {
    const handle = this.handles.get(downloadId);
    if (!handle) return;
    handle.resume();
    this.store.setState(downloadId, 'progressing');
  }

  cancel(downloadId: string): void {
    const handle = this.handles.get(downloadId);
    if (!handle) return;
    handle.cancel();
    this.store.finalize(downloadId, 'cancelled', Date.now());
  }

  getDownloads(): DownloadItem[] {
    return this.store.getAll();
  }

  clearCompleted(): void {
    this.store.clearCompleted();
  }

  onUpdate(callback: DownloadListener): () => void {
    return this.store.onUpdate(callback);
  }
}
