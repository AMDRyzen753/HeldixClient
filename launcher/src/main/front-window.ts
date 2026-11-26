import { app, type BrowserWindow } from 'electron';

/**
 * Fenster aus dem laufenden Spiel heraus nach vorn holen (Anmeldung, Bestätigung des Kontowechsels): über allem,
 * auch über einem Spiel im Vollbild, und mit Fokus. Lässt das System den Fokus nicht zu (Windows gibt ihn einem
 * Hintergrundprozess nicht immer), blinkt das Fenster in der Taskleiste.
 */
export function bringToFront(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.moveTop();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
  win.webContents.focus();
  setTimeout(() => {
    if (win.isDestroyed() || win.isFocused()) return;
    win.flashFrame(true);
    win.once('focus', () => {
      if (!win.isDestroyed()) win.flashFrame(false);
    });
  }, 150);
}
