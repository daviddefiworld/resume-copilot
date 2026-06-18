import dns from 'node:dns';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class DesktopApp {
  private server: Server | null = null;
  private window: BrowserWindow | null = null;

  async start(): Promise<void> {
    dns.setDefaultResultOrder('ipv4first');
    process.env.SELF_TOOL_DATA_DIR = path.join(app.getPath('userData'), 'data');

    try {
      process.loadEnvFile();
    } catch {
      // Environment files are optional for packaged installs.
    }

    const url = await this.startServer();
    this.createWindow(this.devUrl() || url);
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async startServer(): Promise<string> {
    const { createApp, applyServerTimeouts } = await import('../server/app.ts');
    const port = this.devUrl() ? Number(process.env.PORT || 3500) : 0;
    const clientDir = this.devUrl() ? undefined : path.join(__dirname, '..', 'dist');

    return new Promise((resolve, reject) => {
      const server = createApp({ clientDir }).listen(port, '127.0.0.1', () => {
        this.server = server;
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to start local application server.'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
      applyServerTimeouts(server);
      server.on('error', reject);
    });
  }

  private createWindow(url: string): void {
    Menu.setApplicationMenu(null);
    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 980,
      minHeight: 680,
      title: 'Sox Resume Builder',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        plugins: true // enable the built-in Chromium PDF viewer for the inline resume preview
      }
    });

    this.window.webContents.setWindowOpenHandler(({ url: target }) => {
      void shell.openExternal(target);
      return { action: 'deny' };
    });
    void this.window.loadURL(url);
  }

  private devUrl(): string {
    return process.env.VITE_DEV_SERVER_URL || '';
  }
}

const desktop = new DesktopApp();

app.whenReady().then(() => desktop.start());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void desktop.start();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => desktop.stop());
