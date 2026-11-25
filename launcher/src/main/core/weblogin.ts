// Anmeldung auf heldixclient.com ohne Passwort: Der Launcher meldet sich wie ein Minecraft-Server-Beitritt beim
// Heldix-Dienst an (Mojang bestätigt die UUID, der Dienst sieht kein Token), holt einen Einmal-Link
// (POST /v1/web/link, 2 Minuten gültig) und öffnet ihn im Browser. Siehe docs/dienst.md.

export interface WebLoginAccount {
  name: string;
  uuid: string;
  accessToken: string;
}

interface ServiceError {
  error?: string;
}

async function call<T>(base: string, path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as T & ServiceError;
  if (!response.ok) throw new Error(json.error ?? `Der Heldix-Dienst antwortet mit ${response.status}.`);
  return json;
}

function isLoopback(base: string): boolean {
  const host = new URL(base).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

/**
 * Liefert den Einmal-Link zur Webseite. {@code devAuth}: nur für Tests gegen einen lokalen Dienst im
 * Entwicklungsmodus (POST /v1/auth/dev statt Mojang).
 */
export async function webLoginUrl(serviceUrl: string, account: WebLoginAccount, devAuth = false, target?: string): Promise<string> {
  const base = serviceUrl.replace(/\/+$/, '');
  if (!base) throw new Error('Kein Heldix-Dienst eingerichtet.');
  const uuid = account.uuid.replace(/-/g, '').toLowerCase();
  let token: string;
  if (devAuth && isLoopback(base)) {
    token = (await call<{ token: string }>(base, '/v1/auth/dev', { name: account.name, uuid })).token;
  } else {
    const { serverId } = await call<{ serverId: string }>(base, '/v1/auth/challenge', undefined);
    // wie beim Betreten eines Minecraft-Servers: Mojang bestätigt dem Dienst, wem die UUID gehört
    const join = await fetch('https://sessionserver.mojang.com/session/minecraft/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: account.accessToken, selectedProfile: uuid, serverId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!join.ok) throw new Error('Mojang hat die Anmeldung abgelehnt. Bitte das Konto im Launcher neu anmelden.');
    token = (await call<{ token: string }>(base, '/v1/auth/login', { name: account.name, serverId })).token;
  }
  const { url } = await call<{ url: string }>(base, '/v1/web/link', target ? { target } : undefined, token);
  const parsed = new URL(url);
  const local = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (parsed.protocol !== 'https:' && !local) throw new Error('Der Heldix-Dienst hat einen ungültigen Link geliefert.');
  return parsed.toString();
}
