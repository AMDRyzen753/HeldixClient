import { BrowserWindow } from 'electron';
import { bringToFront } from './front-window';

export interface ConfirmOptions {
  title: string;
  /** Text unter der Überschrift */
  message: string;
  /** kleine Zeile darunter, z. B. die Instanz */
  detail?: string;
  confirm: string;
  cancel: string;
  /** danach gilt die Frage als abgelehnt */
  timeoutMs?: number;
}

/** Ziel der beiden Knöpfe; wird abgefangen und nie geladen */
const ANSWER_HOST = 'heldix-confirm.invalid';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(options: ConfirmOptions): string {
  const detail = options.detail ? `<p class="detail">${escapeHtml(options.detail)}</p>` : '';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(options.title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #0f1420; color: #e6e9f0; font: 14px/1.45 "Segoe UI", system-ui, sans-serif; }
  body { display: flex; flex-direction: column; padding: 22px 24px 18px; box-sizing: border-box; user-select: none; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0 0 6px; color: #b4bccb; }
  .detail { color: #7d8799; font-size: 12.5px; }
  .buttons { margin-top: auto; display: flex; gap: 10px; justify-content: flex-end; }
  a { display: inline-block; padding: 8px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; border: 1px solid #2a3245; color: #e6e9f0; background: #171e2d; }
  a:hover, a:focus { border-color: #8b5cf6; outline: none; }
  a.primary { background: #8b5cf6; border-color: #8b5cf6; color: #fff; }
  a.primary:hover, a.primary:focus { background: #7c4ef0; }
</style></head><body>
<h1>${escapeHtml(options.title)}</h1>
<p>${escapeHtml(options.message)}</p>
${detail}
<div class="buttons">
  <a href="https://${ANSWER_HOST}/cancel">${escapeHtml(options.cancel)}</a>
  <a class="primary" href="https://${ANSWER_HOST}/ok">${escapeHtml(options.confirm)}</a>
</div>
</body></html>`;
}

/**
 * Kleines Fenster mit Ja/Nein über allem (wie das Anmeldefenster aus dem Spiel). Ohne JavaScript: Die Knöpfe sind
 * Links, deren Navigation abgefangen wird. Schließen, Escape oder Zeitablauf = abgelehnt.
 */
export function confirmOnTop(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 440,
      height: 230,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      autoHideMenuBar: true,
      title: options.title,
      backgroundColor: '#0f1420',
      webPreferences: {
        partition: 'heldix-confirm',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: false,
        spellcheck: false,
      },
    });

    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.close();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(false), options.timeoutMs ?? 120_000);

    const answerOf = (target: string): boolean | null => {
      try {
        const url = new URL(target);
        return url.host === ANSWER_HOST ? url.pathname === '/ok' : null;
      } catch {
        return null;
      }
    };
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault();
      const answer = answerOf(event.url);
      if (answer !== null) finish(answer);
    });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => finish(false));
    win.once('ready-to-show', () => bringToFront(win));
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(options))}`).catch(() => finish(false));
  });
}
