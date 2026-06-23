import dns from 'node:dns';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class DesktopApp {
  private server: Server | null = null;
  private integrationServer: Server | null = null;
  private window: BrowserWindow | null = null;

  async start(): Promise<void> {
    dns.setDefaultResultOrder('ipv4first');
    // Pin the data directory to a FIXED folder name, decoupled from the package
    // name. app.getPath('userData') embeds app.getName() (the package.json name),
    // so renaming the app silently repoints SQLite at a fresh empty database and
    // orphans the user's memory, profiles, and sessions. Anchoring to a constant
    // under the roaming appData root keeps one stable database across renames.
    process.env.SELF_TOOL_DATA_DIR = path.join(app.getPath('appData'), 'job-hunter-copilot', 'data');

    try {
      process.loadEnvFile();
    } catch {
      // Environment files are optional for packaged installs.
    }

    const url = await this.startServer();
    this.createWindow(this.devUrl() || url);
    await this.startIntegrationServer();
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.integrationServer?.close();
    this.integrationServer = null;
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

  // The web-facing integration bridge on a FIXED loopback port, so the Lazybidder
  // dashboard can detect this app and ask it to start a job hunt. Best-effort: if
  // the port is taken (e.g. a second instance), the app still runs fully — only the
  // dashboard's "Apply with Copilot" detection goes dark. Never blocks/crashes start.
  private async startIntegrationServer(): Promise<void> {
    const { createIntegrationApp } = await import('../server/integration/integrationApp.ts');
    const { INTEGRATION_PORT } = await import('../server/integration/config.ts');
    const { integrationService } = await import('../server/services/integrationService.ts');

    // When the dashboard asks to start a hunt, bring the desktop window forward.
    integrationService.setFocusHandler(() => this.focusWindow());

    await new Promise<void>((resolve) => {
      const server = createIntegrationApp().listen(INTEGRATION_PORT, '127.0.0.1', () => {
        this.integrationServer = server;
        resolve();
      });
      server.on('error', () => resolve());
    });
  }

  private focusWindow(): void {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  private createWindow(url: string): void {
    Menu.setApplicationMenu(null);
    this.window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 980,
      minHeight: 680,
      title: 'Sox Job Hunter Copilot',
      // Sox's face as the window/taskbar icon. Generated from the .webp avatar by
      // `npm run icon`; bundled into dist/ by Vite (from public/) so it resolves
      // both in dev (public/) and in the packaged asar (dist/). The installed
      // .exe/shortcut icon is set separately by electron-builder (build.icon).
      icon: path.join(__dirname, '..', this.devUrl() ? 'public' : 'dist', 'icon.png'),
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
