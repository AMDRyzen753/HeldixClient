import { createHash, randomBytes } from 'node:crypto';
import { HttpError, request } from './http';

// Ablauf: Microsoft OAuth -> Xbox Live -> XSTS -> Minecraft Services
// Doku: https://minecraft.wiki/w/Microsoft_authentication

const MS_AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const MS_SCOPE = 'XboxLive.signin offline_access';

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
}

export interface MinecraftSession {
  name: string;
  /** UUID ohne Bindestriche */
  uuid: string;
  accessToken: string;
  expiresAt: number;
  xuid?: string;
  skinUrl?: string;
  refreshToken: string;
}

export class AuthError extends Error {}

const base64url = (data: Buffer) => data.toString('base64url');

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: base64url(randomBytes(16)) };
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: MS_SCOPE,
    prompt: 'select_account',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${MS_AUTHORIZE}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<MicrosoftTokens> {
  const res = await request(MS_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new AuthError(`Microsoft-Anmeldung fehlgeschlagen: ${json.error_description ?? res.status}`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

export function exchangeCode(clientId: string, redirectUri: string, code: string, verifier: string): Promise<MicrosoftTokens> {
  return tokenRequest({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: MS_SCOPE,
  });
}

export function refreshMicrosoft(clientId: string, refreshToken: string): Promise<MicrosoftTokens> {
  return tokenRequest({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: MS_SCOPE });
}

interface XboxResponse {
  Token: string;
  DisplayClaims: { xui: { uhs: string; xid?: string }[] };
}

const XSTS_ERRORS: Record<number, string> = {
  2148916227: 'Dieses Konto wurde von Xbox gesperrt.',
  2148916233: 'Dieses Microsoft-Konto hat noch kein Xbox-Profil. Bitte einmal auf xbox.com anmelden und ein Profil erstellen.',
  2148916235: 'Xbox Live ist in deinem Land nicht verfügbar.',
  2148916236: 'Für dieses Konto ist eine Altersverifizierung nötig (Südkorea).',
  2148916237: 'Für dieses Konto ist eine Altersverifizierung nötig (Südkorea).',
  2148916238: 'Kinderkonto: Ein Erwachsener muss das Konto erst zu einer Microsoft-Familie hinzufügen.',
};

async function xboxPost(url: string, body: unknown): Promise<XboxResponse> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    const err = (await res.json().catch(() => ({}))) as { XErr?: number };
    throw new AuthError(XSTS_ERRORS[err.XErr ?? 0] ?? `Xbox-Anmeldung abgelehnt (XErr ${err.XErr ?? '?'})`);
  }
  if (!res.ok) throw new HttpError(url, res.status, await res.text().catch(() => ''));
  return (await res.json()) as XboxResponse;
}

function decodeJwt(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Tauscht ein Microsoft-Token gegen eine Minecraft-Sitzung. */
export async function loginMinecraft(ms: MicrosoftTokens): Promise<MinecraftSession> {
  const xbl = await xboxPost('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${ms.accessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const xsts = await xboxPost('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  const uhs = xsts.DisplayClaims.xui[0]?.uhs;

  const loginRes = await request('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }),
  });
  if (loginRes.status === 403) {
    const body = await loginRes.text().catch(() => '');
    if (/app registration|AppRegInfo/i.test(body)) {
      // Antwort von Mojang: "Invalid app registration, see https://aka.ms/AppRegInfo for more information"
      throw new AuthError(
        'Mojang hat die Microsoft-Anmeldung von HeldixClient noch nicht freigeschaltet. Bis zur Freigabe klappt sie für niemanden – dein Konto ist in Ordnung.',
      );
    }
    const message = /"errorMessage"\s*:\s*"([^"]+)"/.exec(body)?.[1];
    throw new AuthError(`Minecraft lehnt die Anmeldung ab${message ? `: ${message}` : ' (403)'}.`);
  }
  if (!loginRes.ok) throw new HttpError(loginRes.url, loginRes.status, await loginRes.text().catch(() => ''));
  const mc = (await loginRes.json()) as { access_token: string; expires_in: number };

  const session = await sessionFromAccessToken(mc.access_token);
  return { ...session, expiresAt: Date.now() + mc.expires_in * 1000, refreshToken: ms.refreshToken };
}

/**
 * Sitzung zu einem fertigen Minecraft-Zugangs-Token (z. B. vom offiziellen Launcher über die Brücke):
 * fragt das Profil bei Mojang ab – das prüft zugleich, dass das Token gilt und Minecraft gekauft ist.
 * Ohne Refresh-Token: Läuft die Sitzung ab, muss sie neu übergeben werden.
 */
export async function sessionFromAccessToken(accessToken: string, xuidHint?: string): Promise<MinecraftSession> {
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  const profileRes = await request('https://api.minecraftservices.com/minecraft/profile', auth);
  if (profileRes.status === 401) throw new AuthError('Die Anmeldung ist abgelaufen oder ungültig. Bitte noch mal anmelden.');
  if (profileRes.status === 404) {
    throw new AuthError('Mit diesem Konto wurde Minecraft: Java Edition nicht gekauft (oder es gibt noch kein Profil).');
  }
  if (!profileRes.ok) throw new HttpError(profileRes.url, profileRes.status, '');
  const profile = (await profileRes.json()) as { id: string; name: string; skins?: { state: string; url: string }[] };

  const claims = decodeJwt(accessToken);
  // Minecraft-Tokens gelten 24 Stunden; die genaue Zeit steht im Token
  const expiresAt = typeof claims.exp === 'number' ? claims.exp * 1000 : Date.now() + 23 * 60 * 60 * 1000;
  const xuid = typeof claims.xuid === 'string' ? claims.xuid : xuidHint && /^\d+$/.test(xuidHint) ? xuidHint : undefined;
  return {
    name: profile.name,
    uuid: profile.id.replace(/-/g, ''),
    accessToken,
    expiresAt,
    xuid,
    skinUrl: profile.skins?.find((s) => s.state === 'ACTIVE')?.url,
    refreshToken: '',
  };
}

/** UUID für Offline-Konten, identisch zu Java's UUID.nameUUIDFromBytes("OfflinePlayer:<name>"). */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString('hex');
}
