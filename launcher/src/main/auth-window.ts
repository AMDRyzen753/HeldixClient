import { BrowserWindow } from 'electron';
import { AuthError, buildAuthorizeUrl, createPkce, exchangeCode, type MicrosoftTokens } from './core/auth';

/**
 * Öffnet das Microsoft-Anmeldefenster und fängt die Weiterleitung mit dem Code ab.
 * Nutzt PKCE, daher wird kein Client-Secret benötigt.
 */
export function interactiveMicrosoftLogin(parent: BrowserWindow | null, clientId: string, redirectUri: string): Promise<MicrosoftTokens> {
  const { verifier, challenge, state } = createPkce();
  const authorizeUrl = buildAuthorizeUrl(clientId, redirectUri, challenge, state);

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 680,
      parent: parent ?? undefined,
      modal: parent != null,
      autoHideMenuBar: true,
      title: 'Mit Microsoft anmelden',
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: 'heldix-auth', // nur im Speicher, keine dauerhaften Cookies
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let settled = false;
    const finish = (error: Error | null, tokens?: MicrosoftTokens) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.close();
      if (error) reject(error);
      else resolve(tokens!);
    };

    const handleUrl = (target: string): boolean => {
      if (!target.startsWith(redirectUri)) return false;
      const url = new URL(target);
      const error = url.searchParams.get('error');
      if (error) {
        finish(new AuthError(error === 'access_denied' ? 'Anmeldung abgebrochen.' : (url.searchParams.get('error_description') ?? error)));
      } else if (url.searchParams.get('state') !== state) {
        finish(new AuthError('Ungültige Antwort von Microsoft.'));
      } else {
        const code = url.searchParams.get('code');
        if (!code) {
          finish(new AuthError('Microsoft hat keinen Anmeldecode geliefert.'));
        } else {
          win.hide();
          exchangeCode(clientId, redirectUri, code, verifier).then(
            (tokens) => finish(null, tokens),
            (err: Error) => finish(err),
          );
        }
      }
      return true;
    };

    win.webContents.on('will-redirect', (event) => {
      if (handleUrl(event.url)) event.preventDefault();
    });
    win.webContents.on('will-navigate', (event) => {
      if (handleUrl(event.url)) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => finish(new AuthError('Anmeldung abgebrochen.')));
    win.loadURL(authorizeUrl).catch(() => undefined);
  });
}
