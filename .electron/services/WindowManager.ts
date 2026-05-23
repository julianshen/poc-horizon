import { BrowserWindow, screen, session } from 'electron';
import path from 'path';

const CHROME_HEIGHT = 40 + 36 + 40; // toolbar + tabbar + titlebar approx
const INCOGNITO_PARTITION = 'incognito';

interface CreateOptions {
  incognito?: boolean;
}

export class WindowManager {
  private windows = new Set<BrowserWindow>();

  createWindow(options: CreateOptions = {}): BrowserWindow {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const incognito = options.incognito === true;

    const win = new BrowserWindow({
      width: Math.min(1280, width * 0.8),
      height: Math.min(800, height * 0.8),
      minWidth: 400,
      minHeight: 300,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 },
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Incognito windows use a non-persistent session partition so their
        // cookies/storage/cache are wiped on quit. The renderer chrome
        // itself still loads from the default partition so it shares
        // preload + assets with regular windows.
        additionalArguments: incognito ? ['--horizon-incognito=1'] : [],
      },
      show: false,
    });

    if (incognito) {
      // Pre-resolve the incognito session so BrowserViews can attach to it.
      session.fromPartition(INCOGNITO_PARTITION, { cache: false });
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      const sep = process.env.VITE_DEV_SERVER_URL.includes('?') ? '&' : '?';
      win.loadURL(`${process.env.VITE_DEV_SERVER_URL}${incognito ? `${sep}incognito=1` : ''}`);
      win.webContents.openDevTools();
    } else {
      win.loadFile(
        path.join(__dirname, '../dist/index.html'),
        incognito ? { query: { incognito: '1' } } : undefined
      );
    }

    win.once('ready-to-show', () => win.show());
    win.on('closed', () => this.windows.delete(win));
    this.windows.add(win);

    return win;
  }

  getWindow(): BrowserWindow | null {
    // First non-destroyed window (preserves legacy callers).
    for (const w of this.windows) if (!w.isDestroyed()) return w;
    return null;
  }

  static incognitoPartition(): string {
    return INCOGNITO_PARTITION;
  }

  getContentBounds(): { x: number; y: number; width: number; height: number } {
    const win = this.getWindow();
    if (!win) return { x: 0, y: 0, width: 0, height: 0 };
    const bounds = win.getBounds();
    return { x: 0, y: CHROME_HEIGHT, width: bounds.width, height: bounds.height - CHROME_HEIGHT };
  }
}
