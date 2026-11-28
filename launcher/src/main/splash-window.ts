// Startfenster vor dem Hauptfenster (Update beim Start, siehe core/startup-update.ts): Logo, „Suche nach Updates …“,
// Fortschritt beim Laden, „Wird installiert …“. Es bleibt offen, bis das Hauptfenster sichtbar ist.
import path from 'node:path';
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';

export interface SplashView {
  title: string;
  /** 0–1 = Balken mit Fortschritt, null = laufender Balken */
  progress: number | null;
  /** Knopf „Später – Launcher jetzt öffnen“ (nur beim Laden) */
  skip: boolean;
}

export class SplashWindow {
  private readonly win: BrowserWindow;
  private view: SplashView = { title: 'Suche nach Updates …', progress: null, skip: false };
  private skipListeners: (() => void)[] = [];
  private readonly onSkip = (event: IpcMainEvent) => {
    if (this.win.isDestroyed() || event.sender !== this.win.webContents) return;
    const listeners = this.skipListeners;
    this.skipListeners = [];
    for (const listener of listeners) listener();
  };

  constructor(title: string) {
    this.win = new BrowserWindow({
      width: 380,
      height: 300,
      useContentSize: true,
      frame: false,
      resizable: false,
      // nicht per Alt+F4 schließen (sonst endete der Launcher mitten in der Prüfung); „Später“ gibt es beim Laden
      closable: false,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      show: false,
      center: true,
      title,
      backgroundColor: '#080b12',
      webPreferences: {
        preload: path.join(__dirname, 'splash-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('will-navigate', (event) => event.preventDefault());
    this.win.once('ready-to-show', () => {
      if (!this.win.isDestroyed()) this.win.show();
    });
    this.win.webContents.on('did-finish-load', () => this.push());
    ipcMain.on('splash:skip', this.onSkip);
    this.win.on('closed', () => ipcMain.removeListener('splash:skip', this.onSkip));
    void this.win.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html')).catch(() => undefined);
  }

  get open(): boolean {
    return !this.win.isDestroyed();
  }

  update(view: SplashView): void {
    this.view = view;
    this.push();
  }

  /** Einmal benachrichtigen, wenn „Später“ geklickt wird */
  onceSkipped(listener: () => void): void {
    this.skipListeners.push(listener);
  }

  close(): void {
    this.skipListeners = [];
    if (!this.win.isDestroyed()) this.win.destroy();
  }

  private push(): void {
    if (!this.win.isDestroyed() && !this.win.webContents.isLoading()) this.win.webContents.send('splash:view', this.view);
  }
}
