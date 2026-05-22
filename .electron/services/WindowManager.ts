import { BrowserWindow, screen } from 'electron';
import path from 'path';

const CHROME_HEIGHT = 40 + 36 + 40; // toolbar + tabbar + titlebar approx

export class WindowManager {
  private window: BrowserWindow | null = null;

  createWindow(): BrowserWindow {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    this.window = new BrowserWindow({
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
      },
      show: false,
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      this.window.loadURL(process.env.VITE_DEV_SERVER_URL);
      this.window.webContents.openDevTools();
    } else {
      this.window.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    this.window.once('ready-to-show', () => {
      this.window?.show();
    });

    return this.window;
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }

  getContentBounds(): { x: number; y: number; width: number; height: number } {
    if (!this.window) return { x: 0, y: 0, width: 0, height: 0 };
    const bounds = this.window.getBounds();
    return {
      x: 0,
      y: CHROME_HEIGHT,
      width: bounds.width,
      height: bounds.height - CHROME_HEIGHT,
    };
  }
}
