// Nachgebaute Gegenseite für die Anmeldung mit dem Minecraft-Konto in einem HTTP-Server: Microsoft (Token-Endpunkt),
// Xbox Live (Benutzer-Token, XSTS) und die Minecraft-Dienste (login_with_xbox, Profil). Jedes Konto hat eigene,
// erkennbare Tokens: So prüfen die Tests, dass keins davon im Log oder in der Datenbank landet.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeReply {
  status: number;
  body?: unknown;
}

export interface FakeAccount {
  /** Autorisierungscode, mit dem „Microsoft“ den Browser zurückschickt (einmal gültig) */
  code: string;
  uuid: string;
  name: string;
  msToken: string;
  xblToken: string;
  xstsToken: string;
  mcToken: string;
  uhs: string;
  /** Challenge aus der Weiterleitung: Der Verifier im Token-Tausch muss dazu passen. */
  challenge?: string;
  /** Feste Antworten zum Durchspielen von Fehlern, je Schritt */
  token?: FakeReply;
  xbl?: FakeReply;
  xsts?: FakeReply;
  mc?: FakeReply;
  profile?: FakeReply;
}

export interface FakeRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface FakeMicrosoft {
  url: string;
  requests: FakeRequest[];
  /** Neues Konto mit frischen Tokens; `uuid` mit Bindestrichen wie bei Mojang. */
  account(fields: Partial<FakeAccount> & { name: string }): FakeAccount;
  /** Alle Geheimnisse aller Konten (Tokens, Codes) – dürfen nirgends gespeichert werden. */
  secrets(): string[];
  /** Antworten um so viele Millisekunden verzögern (Zeitgrenze). */
  delayMs: number;
  close(): Promise<void>;
}

const secret = (prefix: string) => `${prefix}-${randomBytes(18).toString('base64url')}`;

/**
 * @param expect Was der Token-Endpunkt verlangt: Client-ID, Umleitungs-URI und (vertraulicher Client) das Geheimnis.
 */
export async function startFakeMicrosoft(expect: { clientId: string; redirectUri: string; clientSecret?: string }): Promise<FakeMicrosoft> {
  const accounts: FakeAccount[] = [];
  const used = new Set<string>();
  const requests: FakeRequest[] = [];
  const fake: Partial<FakeMicrosoft> = { delayMs: 0 };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = new URL(req.url ?? '/', 'http://fake').pathname;
      requests.push({ path, headers: req.headers, body });
      const send = (reply: FakeReply) => {
        const text = reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(text);
        }, fake.delayMs ?? 0);
      };
      let json: any = null;
      try {
        json = body.startsWith('{') ? JSON.parse(body) : null;
      } catch {
        json = null;
      }

      if (req.method === 'POST' && path === '/consumers/oauth2/v2.0/token') {
        const form = new URLSearchParams(body);
        const account = accounts.find((a) => a.code === form.get('code'));
        if (form.get('client_id') !== expect.clientId) return send({ status: 400, body: { error: 'unauthorized_client', error_codes: [700016] } });
        if (expect.clientSecret !== undefined && form.get('client_secret') !== expect.clientSecret) {
          return send({ status: 401, body: { error: 'invalid_client', error_codes: [7000218], error_description: 'AADSTS7000218: secret missing' } });
        }
        if (form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== expect.redirectUri || form.get('scope') !== 'XboxLive.signin') {
          return send({ status: 400, body: { error: 'invalid_request' } });
        }
        if (!account || used.has(account.code)) return send({ status: 400, body: { error: 'invalid_grant', error_codes: [70008] } });
        used.add(account.code);
        const verifier = form.get('code_verifier') ?? '';
        if (account.challenge !== undefined && createHash('sha256').update(verifier).digest('base64url') !== account.challenge) {
          return send({ status: 400, body: { error: 'invalid_grant', error_codes: [501481] } });
        }
        if (account.token) return send(account.token);
        return send({ status: 200, body: { token_type: 'Bearer', scope: 'XboxLive.signin', expires_in: 3600, access_token: account.msToken } });
      }
      if (req.method === 'POST' && path === '/user/authenticate') {
        const account = accounts.find((a) => json?.Properties?.RpsTicket === `d=${a.msToken}`);
        if (!account || json?.RelyingParty !== 'http://auth.xboxlive.com' || json?.Properties?.AuthMethod !== 'RPS') return send({ status: 400 });
        if (account.xbl) return send(account.xbl);
        return send({ status: 200, body: { Token: account.xblToken, DisplayClaims: { xui: [{ uhs: account.uhs }] } } });
      }
      if (req.method === 'POST' && path === '/xsts/authorize') {
        const account = accounts.find((a) => json?.Properties?.UserTokens?.[0] === a.xblToken);
        if (!account || json?.RelyingParty !== 'rp://api.minecraftservices.com/' || json?.Properties?.SandboxId !== 'RETAIL') return send({ status: 400 });
        if (account.xsts) return send(account.xsts);
        return send({ status: 200, body: { Token: account.xstsToken, DisplayClaims: { xui: [{ uhs: account.uhs }] } } });
      }
      if (req.method === 'POST' && path === '/authentication/login_with_xbox') {
        const account = accounts.find((a) => json?.identityToken === `XBL3.0 x=${a.uhs};${a.xstsToken}`);
        if (!account) return send({ status: 401, body: { errorMessage: 'Invalid token' } });
        if (account.mc) return send(account.mc);
        return send({ status: 200, body: { username: randomBytes(16).toString('hex'), access_token: account.mcToken, token_type: 'Bearer', expires_in: 86400 } });
      }
      if (req.method === 'GET' && path === '/minecraft/profile') {
        const account = accounts.find((a) => req.headers.authorization === `Bearer ${a.mcToken}`);
        if (!account) return send({ status: 401 });
        if (account.profile) return send(account.profile);
        return send({ status: 200, body: { id: account.uuid.replace(/-/g, ''), name: account.name, skins: [], capes: [] } });
      }
      send({ status: 404 });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    requests,
    account(fields: Partial<FakeAccount> & { name: string }): FakeAccount {
      const hex = randomBytes(16).toString('hex');
      const account: FakeAccount = {
        code: secret('MSCODE'),
        uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        msToken: secret('MSTOKEN'),
        xblToken: secret('XBLTOKEN'),
        xstsToken: secret('XSTSTOKEN'),
        mcToken: secret('MCTOKEN'),
        uhs: randomBytes(10).toString('hex'),
        ...fields,
      };
      accounts.push(account);
      return account;
    },
    secrets: () => accounts.flatMap((a) => [a.code, a.msToken, a.xblToken, a.xstsToken, a.mcToken]),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  });
  return fake as FakeMicrosoft;
}
