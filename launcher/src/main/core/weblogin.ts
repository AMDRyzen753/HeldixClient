// Anmeldung auf heldixclient.com ohne Passwort: Der Launcher meldet sich wie ein Minecraft-Server-Beitritt beim
// Heldix-Dienst an (Mojang bestätigt die UUID, der Dienst sieht kein Token), holt einen Einmal-Link
// (POST /v1/web/link, 2 Minuten gültig) und öffnet ihn im Browser. Siehe docs/dienst.md.

import { serviceBase, serviceLogin, serviceRequest, type LoginOptions, type ServiceAccount } from './heldixservice';

export type WebLoginAccount = ServiceAccount;

/** Einmal-Link zur Webseite mit einem schon vorhandenen Token des Dienstes. */
export async function webLinkUrl(serviceUrl: string, token: string, target?: string): Promise<string> {
  const base = serviceBase(serviceUrl);
  const { url } = await serviceRequest<{ url: string }>(base, '/v1/web/link', { method: 'POST', body: target ? { target } : undefined, token });
  const parsed = new URL(url);
  const local = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (parsed.protocol !== 'https:' && !local) throw new Error('Der Heldix-Dienst hat einen ungültigen Link geliefert.');
  return parsed.toString();
}

/**
 * Liefert den Einmal-Link zur Webseite. {@code devAuth}: nur für Tests gegen einen lokalen Dienst im
 * Entwicklungsmodus (POST /v1/auth/dev statt Mojang).
 */
export async function webLoginUrl(serviceUrl: string, account: WebLoginAccount, devAuth = false, target?: string, options: Omit<LoginOptions, 'devAuth'> = {}): Promise<string> {
  const { token } = await serviceLogin(serviceUrl, account, { ...options, devAuth });
  return webLinkUrl(serviceUrl, token, target);
}
