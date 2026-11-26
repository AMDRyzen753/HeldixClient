// Anmeldung auf der Webseite mit dem Minecraft-Konto: Der Browser meldet sich bei Microsoft an (OAuth 2.0 mit PKCE,
// alles auf dem Server – im Browser liegt nichts Geheimes), der Dienst tauscht den Code und holt über Xbox Live, XSTS
// und die Minecraft-Dienste das Java-Profil. Übrig bleiben nur UUID und Spielername; alle Tokens bleiben lokale
// Variablen dieses Ablaufs und sind danach weg (nie gespeichert, nie im Log, nie in Fehlertexten).
// Danach gibt es einen Einmal-Code wie beim Link aus dem Launcher (web.ts), die Webseite tauscht ihn gegen die Sitzung.
import { createHash, randomBytes } from 'node:crypto';
import { hashToken } from './auth';
import { isName, normalizeUuid } from './validate';

/** Adressen von Microsoft, Xbox Live und den Minecraft-Diensten (nur der Entwicklungsmodus stellt sie um, für Tests). */
export interface MicrosoftEndpoints {
  /** Microsoft-Anmeldung (authorize und token unter `/consumers/oauth2/v2.0/…`) */
  login: string;
  /** Xbox Live, Benutzer-Token (`/user/authenticate`) */
  xboxUser: string;
  /** XSTS (`/xsts/authorize`) */
  xsts: string;
  /** Minecraft-Dienste (`/authentication/login_with_xbox`, `/minecraft/profile`) */
  minecraft: string;
}

export const MICROSOFT_ENDPOINTS: Readonly<MicrosoftEndpoints> = {
  login: 'https://login.microsoftonline.com',
  xboxUser: 'https://user.auth.xboxlive.com',
  xsts: 'https://xsts.auth.xboxlive.com',
  minecraft: 'https://api.minecraftservices.com',
};

/** Weg der Rückkehr von Microsoft; die Umleitungs-URI ist `<HELDIX_DIENST_API_URL>` + dieser Weg. */
export const CALLBACK_PATH = '/v1/web/auth/microsoft/callback';
/** Nur XboxLive.signin: kein Refresh-Token, kein dauerhafter Zugriff. */
const SCOPE = 'XboxLive.signin';
/** Antworten der Gegenseite sind wenige KB groß; alles darüber ist verdächtig. */
const MAX_RESPONSE = 64 * 1024;
/** Höchstens so viele offene Anmeldeversuche im Speicher; darüber fallen die ältesten weg. */
const MAX_PENDING = 10_000;

/**
 * Fehler beim Anmelden, als Code für die Webseite (`/konto#fehler=<code>`); die Texte dazu stehen auf der Webseite
 * (anmelden.js) und in docs/dienst.md.
 */
export type LoginErrorCode =
  | 'abgebrochen'
  | 'abgelaufen'
  | 'microsoft'
  | 'kein-xbox'
  | 'xbox-land'
  | 'xbox-alter'
  | 'kinderkonto'
  | 'xbox-eltern'
  | 'xbox-bedingungen'
  | 'xbox-gesperrt'
  | 'xbox'
  | 'kein-minecraft'
  | 'minecraft'
  | 'gesperrt'
  | 'zu-viele'
  | 'nicht-erreichbar'
  | 'fehler';

export class LoginError extends Error {
  constructor(readonly code: LoginErrorCode) {
    super(code);
  }
}

/** Fehlercodes von XSTS (Feld `XErr` in der Antwort 401). Alle anderen: `xbox`. */
export const XSTS_ERRORS: Readonly<Record<number, LoginErrorCode>> = {
  2148916227: 'xbox-gesperrt',
  2148916229: 'xbox-eltern',
  2148916233: 'kein-xbox',
  2148916234: 'xbox-bedingungen',
  2148916235: 'xbox-land',
  2148916236: 'xbox-alter',
  2148916237: 'xbox-alter',
  2148916238: 'kinderkonto',
};

export interface MicrosoftOptions {
  clientId: string;
  /** Client-Geheimnis (vertraulicher Client, Plattform „Web“); null: öffentlicher Client nur mit PKCE */
  clientSecret: string | null;
  /** fertige Umleitungs-URI, genau wie in der App-Registrierung eingetragen */
  redirectUri: string;
  endpoints: MicrosoftEndpoints;
  /** So lange gilt ein Anmeldeversuch (state und PKCE-Verifier). */
  stateTtlMs: number;
  /** Zeitgrenze je Anfrage an Microsoft, Xbox Live und Minecraft */
  timeoutMs: number;
  log: (line: string) => void;
}

/** Offener Anmeldeversuch: nur im Arbeitsspeicher, gefunden über den Hash von `state`. */
export interface PendingLogin {
  verifier: string;
  target: string | null;
  /** Hash des Bindungs-Cookies des Browsers, der die Anmeldung begonnen hat */
  binding: string;
  expiresAt: number;
}

export interface MinecraftProfile {
  uuid: string;
  name: string;
}

const base64url = (data: Buffer) => data.toString('base64url');
const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** Kurzer, harmloser Wert aus einer fremden Antwort fürs Log (nur Buchstaben, Ziffern, _ und -). */
function safeWord(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

interface Answer {
  status: number;
  /** JSON-Körper oder null (leer, zu groß, kein JSON) */
  data: Record<string, unknown> | null;
}

export class MicrosoftLogin {
  private readonly pending = new Map<string, PendingLogin>();
  private warnedAppRegistration = false;

  constructor(readonly options: MicrosoftOptions) {}

  /** `public` (PKCE ohne Geheimnis) oder `confidential` (mit Client-Geheimnis) – für das Log beim Start. */
  get clientType(): 'public' | 'confidential' {
    return this.options.clientSecret === null ? 'public' : 'confidential';
  }

  /** Neuer Anmeldeversuch: Adresse bei Microsoft, zu der der Browser weitergeleitet wird. */
  begin(target: string | null, bindingHash: string, now = Date.now()): string {
    if (this.pending.size >= MAX_PENDING) this.sweep(now);
    while (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    this.pending.set(hashToken(state), { verifier, target, binding: bindingHash, expiresAt: now + this.options.stateTtlMs });
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: 'code',
      redirect_uri: this.options.redirectUri,
      response_mode: 'query',
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    });
    return `${trimSlash(this.options.endpoints.login)}/consumers/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /** Löst `state` ein: genau einmal, auch wenn danach etwas schiefgeht. Unbekannt oder abgelaufen: null. */
  take(state: string | null, now = Date.now()): PendingLogin | null {
    if (state === null || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
    const key = hashToken(state);
    const entry = this.pending.get(key);
    if (!entry) return null;
    this.pending.delete(key);
    return entry.expiresAt > now ? entry : null;
  }

  /** Fehler, mit dem Microsoft zurückkommt (`?error=…`): abgebrochen oder etwas anderes (dann mit Log). */
  authorizeError(error: string): LoginError {
    if (error === 'access_denied') return new LoginError('abgebrochen');
    this.options.log(`Anmeldung mit dem Minecraft-Konto: Microsoft meldet „${safeWord(error) ?? 'unbekannt'}“.`);
    return new LoginError('microsoft');
  }

  /**
   * Code von Microsoft → Minecraft-Profil. Wirft LoginError. Die Tokens auf dem Weg bleiben lokale Variablen dieser
   * Funktion; zurück kommen nur UUID und Name.
   */
  async profile(code: string, verifier: string): Promise<MinecraftProfile> {
    const { endpoints } = this.options;

    // 1. Microsoft: Code gegen ein Zugangs-Token (mit PKCE; mit Geheimnis als vertraulicher Client)
    const form = new URLSearchParams({
      client_id: this.options.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.options.redirectUri,
      code_verifier: verifier,
      scope: SCOPE,
    });
    if (this.options.clientSecret !== null) form.set('client_secret', this.options.clientSecret);
    const token = await this.call('Microsoft', `${trimSlash(endpoints.login)}/consumers/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
    const msToken = token.data?.access_token;
    if (token.status !== 200 || typeof msToken !== 'string' || msToken === '') {
      const codes = Array.isArray(token.data?.error_codes) ? token.data.error_codes.filter((c) => Number.isInteger(c)).slice(0, 3) : [];
      this.options.log(
        `Anmeldung mit dem Minecraft-Konto: Microsoft lehnt den Code ab (HTTP ${token.status}` +
          `${safeWord(token.data?.error) ? `, ${safeWord(token.data?.error)}` : ''}${codes.length ? `, AADSTS${codes.join('/')}` : ''}). ` +
          'Bei invalid_client: Client-ID, Client-Geheimnis und Plattform der Umleitungs-URI prüfen (docs/einrichtung.md).',
      );
      throw new LoginError('microsoft');
    }

    // 2. Xbox Live: Benutzer-Token
    const xbl = await this.call('Xbox Live', `${trimSlash(endpoints.xboxUser)}/user/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
      body: JSON.stringify({
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
      }),
    });
    const xblToken = xbl.data?.Token;
    if (xbl.status === 401) throw new LoginError(xstsError(xbl.data));
    if (xbl.status !== 200 || typeof xblToken !== 'string' || xblToken === '') throw new LoginError('xbox');

    // 3. XSTS für die Minecraft-Dienste: hier kommen kein Xbox-Profil, Kinderkonto, Land und Sperre zurück
    const xsts = await this.call('Xbox Live', `${trimSlash(endpoints.xsts)}/xsts/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
      body: JSON.stringify({
        Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      }),
    });
    if (xsts.status === 401) throw new LoginError(xstsError(xsts.data));
    const xstsToken = xsts.data?.Token;
    const uhs = userHash(xsts.data);
    if (xsts.status !== 200 || typeof xstsToken !== 'string' || xstsToken === '' || uhs === null) throw new LoginError('xbox');

    // 4. Minecraft-Dienste: Xbox-Token gegen ein Minecraft-Token (geht nur mit der von Mojang freigegebenen App-ID)
    const mc = await this.call('Minecraft', `${trimSlash(endpoints.minecraft)}/authentication/login_with_xbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` }),
    });
    const mcToken = mc.data?.access_token;
    if (mc.status !== 200 || typeof mcToken !== 'string' || mcToken === '') {
      const message = typeof mc.data?.errorMessage === 'string' ? mc.data.errorMessage : '';
      if (mc.status === 403 && /app registration|AppRegInfo/i.test(message)) {
        if (!this.warnedAppRegistration) {
          this.warnedAppRegistration = true;
          this.options.log(
            'Anmeldung mit dem Minecraft-Konto: Die Minecraft-Dienste lehnen die App-ID ab („Invalid app registration“). ' +
              'HELDIX_DIENST_MS_CLIENT_ID muss die von Mojang freigegebene App-ID des Launchers sein.',
          );
        }
      } else {
        this.options.log(`Anmeldung mit dem Minecraft-Konto: login_with_xbox antwortet mit HTTP ${mc.status}.`);
      }
      throw new LoginError('minecraft');
    }

    // 5. Profil: UUID und Name. 404: kein Minecraft: Java Edition (oder noch kein Spielername)
    const profile = await this.call('Minecraft', `${trimSlash(endpoints.minecraft)}/minecraft/profile`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${mcToken}`, Accept: 'application/json' },
    });
    if (profile.status === 404) throw new LoginError('kein-minecraft');
    const uuid = normalizeUuid(profile.data?.id);
    const name = profile.data?.name;
    if (profile.status !== 200 || uuid === null || !isName(name)) {
      this.options.log(`Anmeldung mit dem Minecraft-Konto: Profil nicht lesbar (HTTP ${profile.status}).`);
      throw new LoginError('minecraft');
    }
    return { uuid, name };
  }

  /**
   * Eine Anfrage an Microsoft, Xbox Live oder die Minecraft-Dienste. Keine Verbindung, Zeitüberschreitung oder 5xx:
   * `nicht-erreichbar`, 429: `zu-viele`. Der Körper wird höchstens 64 KB gelesen; Fehler beim Lesen oder JSON zählen
   * als „kein Körper“ (ihre Texte könnten Teile der Antwort enthalten und landen deshalb nirgends).
   */
  private async call(service: string, url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Answer> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs) });
    } catch {
      this.options.log(`Anmeldung mit dem Minecraft-Konto: ${service} nicht erreichbar.`);
      throw new LoginError('nicht-erreichbar');
    }
    let data: Record<string, unknown> | null = null;
    try {
      const length = Number(res.headers.get('content-length') ?? '0');
      if (length > MAX_RESPONSE) {
        await res.body?.cancel().catch(() => {});
      } else {
        const text = await res.text();
        if (text.length <= MAX_RESPONSE && text.trim() !== '') {
          const parsed: unknown = JSON.parse(text);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
        }
      }
    } catch {
      data = null;
    }
    if (res.status === 429) throw new LoginError('zu-viele');
    if (res.status >= 500) {
      this.options.log(`Anmeldung mit dem Minecraft-Konto: ${service} antwortet mit HTTP ${res.status}.`);
      throw new LoginError('nicht-erreichbar');
    }
    return { status: res.status, data };
  }

  /** Abgelaufene Anmeldeversuche entfernen. */
  sweep(now = Date.now()): void {
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(key);
    }
  }
}

function xstsError(data: Record<string, unknown> | null): LoginErrorCode {
  const code = data?.XErr;
  return (typeof code === 'number' && XSTS_ERRORS[code]) || 'xbox';
}

/** `DisplayClaims.xui[0].uhs` aus der Antwort von XSTS oder null. */
function userHash(data: Record<string, unknown> | null): string | null {
  const claims = data?.DisplayClaims as { xui?: unknown } | undefined;
  const first = Array.isArray(claims?.xui) ? (claims.xui[0] as { uhs?: unknown } | undefined) : undefined;
  return typeof first?.uhs === 'string' && /^[A-Za-z0-9]{1,64}$/.test(first.uhs) ? first.uhs : null;
}
