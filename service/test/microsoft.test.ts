// Anmeldung auf der Webseite mit dem Minecraft-Konto (über Microsoft): Start mit PKCE und state, Rückkehr, Xbox Live,
// XSTS, Minecraft-Dienste und Profil gegen nachgebaute Server; Fehlercodes, Bindung an den Browser, Ziele, Grenzen und
// dass keins der Tokens gespeichert oder ins Log geschrieben wird.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { ServiceOptions } from '../src/app';
import { Store } from '../src/db';
import { BINDING_COOKIE, LINK_EXPIRED, MICROSOFT_EXPIRED, SESSION_COOKIE } from '../src/web';
import { startFakeMicrosoft, type FakeAccount, type FakeMicrosoft } from './fake-microsoft';
import { api, devPlayer, rawRequest, sleep, startService, type RawResponse, type TestService } from './helpers';
import { cookieFrom, webApi, webLogin, WEBSITE } from './web-helpers';

const API = 'https://api.heldix.example';
/** Platzhalter für Tests (keine echte App-ID) */
const CLIENT_ID = '00000000-0000-4000-8000-0000000000aa';
const REDIRECT = `${API}/v1/web/auth/microsoft/callback`;
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const PROXY = { 'X-Forwarded-For': '203.0.113.5', 'X-Forwarded-Proto': 'https' };

interface Setup {
  service: TestService;
  fake: FakeMicrosoft;
  close(): Promise<void>;
}

async function setup(options: Partial<ServiceOptions> = {}, clientSecret?: string, fakeSecret = clientSecret): Promise<Setup> {
  const fake = await startFakeMicrosoft({ clientId: CLIENT_ID, redirectUri: REDIRECT, clientSecret: fakeSecret });
  const service = await startService({
    dev: true,
    website: WEBSITE,
    apiUrl: `${API}/`,
    microsoft: { clientId: CLIENT_ID, clientSecret: clientSecret ?? null },
    microsoftEndpoints: { login: fake.url, xboxUser: fake.url, xsts: fake.url, minecraft: fake.url },
    ...options,
  });
  return {
    service,
    fake,
    async close() {
      await service.close();
      await fake.close();
    },
  };
}

function setCookies(res: RawResponse): string[] {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

/** Start wie der Browser über die Webseite: Weiterleitung, state, Challenge und das Bindungs-Cookie. */
async function begin(service: TestService, options: { ziel?: string; binding?: string; headers?: Record<string, string> } = {}) {
  const query = options.ziel !== undefined ? `?ziel=${encodeURIComponent(options.ziel)}` : '';
  const headers: Record<string, string> = { ...options.headers };
  if (options.binding !== undefined) headers.Cookie = `${BINDING_COOKIE}=${options.binding}`;
  const res = await rawRequest(service.url, 'GET', `/v1/web/auth/microsoft${query}`, headers);
  assert.equal(res.status, 303, res.body.toString('utf8'));
  const location = new URL(String(res.headers.location));
  const cookie = setCookies(res).find((c) => c.startsWith(`${BINDING_COOKIE}=`)) ?? '';
  return {
    res,
    location,
    cookie,
    state: location.searchParams.get('state') ?? '',
    challenge: location.searchParams.get('code_challenge') ?? '',
    binding: /^[^=]+=([^;]*)/.exec(cookie)?.[1] ?? '',
  };
}

/** Rückkehr von Microsoft, wie der Browser sie aufruft. */
async function callback(service: TestService, query: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await rawRequest(service.url, 'GET', `/v1/web/auth/microsoft/callback?${new URLSearchParams(query).toString()}`, headers);
  const location = res.headers.location ? new URL(String(res.headers.location)) : null;
  return { res, status: res.status, location, hash: new URLSearchParams(location?.hash.slice(1) ?? '') };
}

/** Start, „Anmeldung bei Microsoft“ und Rückkehr: bis zur Weiterleitung auf die Webseite. */
async function signIn(service: TestService, account: FakeAccount, options: { ziel?: string; headers?: Record<string, string> } = {}) {
  const started = await begin(service, options);
  account.challenge = started.challenge;
  const back = await callback(service, { code: account.code, state: started.state }, options.headers);
  return { ...started, back };
}

/** Code auf der Webseite einlösen (POST /v1/web/session), mit Bindungs-Cookie, wenn angegeben. */
function exchange(service: TestService, code: string, binding?: string, headers: Record<string, string> = {}) {
  const all: Record<string, string> = { ...headers };
  if (binding !== undefined) all.Cookie = `${BINDING_COOKIE}=${binding}`;
  return api(service.url, 'POST', '/v1/web/session', { body: { code }, headers: all });
}

function fetchSetCookies(res: { headers: Headers }): string[] {
  return res.headers.getSetCookie();
}

/** Spieler direkt aus der Datenbank (wie die CLI). */
function storedUser(service: TestService, uuid: string) {
  const store = new Store(service.dataDir);
  try {
    return store.getUser(uuid.replace(/-/g, ''));
  } finally {
    store.close();
  }
}

const plainUuid = (account: FakeAccount) => account.uuid.replace(/-/g, '');
const SESSION_RE = new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict$`);

describe('Anmeldung mit dem Minecraft-Konto: Einrichtung', () => {
  test('nicht eingerichtet: microsoftLogin false, Start und Rückkehr 503 (deutsche Seite, Link zur Webseite)', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const config = await api(service.url, 'GET', '/v1/web/config');
      assert.equal(config.status, 200);
      assert.deepEqual(config.body, { microsoftLogin: false });
      for (const route of ['/v1/web/auth/microsoft', '/v1/web/auth/microsoft/callback?code=x&state=y']) {
        const res = await rawRequest(service.url, 'GET', route);
        assert.equal(res.status, 503, route);
        assert.match(String(res.headers['content-type']), /^text\/html/);
        assert.match(String(res.headers['content-security-policy']), /default-src 'none'/);
        const html = res.body.toString('utf8');
        assert.match(html, /<html lang="de">/);
        assert.match(html, /Anmeldung mit dem Minecraft-Konto nicht verfügbar/);
        assert.match(html, /href="https:\/\/heldix\.example\/konto"/);
        assert.equal(res.headers['set-cookie'], undefined);
      }
    } finally {
      await service.close();
    }
  });

  test('App-ID allein reicht nicht: ohne API-Adresse oder ohne Webseite bleibt es aus; mit beidem an', async () => {
    for (const [options, expected] of [
      [{ website: WEBSITE }, false],
      [{ apiUrl: API }, false],
      [{ website: WEBSITE, apiUrl: API, microsoft: { clientId: '' } }, false],
      [{ website: WEBSITE, apiUrl: API }, true],
    ] as const) {
      const service = await startService({ microsoft: { clientId: CLIENT_ID }, ...options });
      try {
        const config = await api(service.url, 'GET', '/v1/web/config');
        assert.deepEqual(config.body, { microsoftLogin: expected }, JSON.stringify(options));
        if (!expected) assert.equal((await rawRequest(service.url, 'GET', '/v1/web/auth/microsoft')).status, 503);
      } finally {
        await service.close();
      }
    }
  });

  test('andere Adressen für Microsoft, Xbox und Minecraft nur im Entwicklungsmodus', async () => {
    await assert.rejects(
      startService({ dev: false, website: WEBSITE, apiUrl: API, microsoft: { clientId: CLIENT_ID }, microsoftEndpoints: { login: 'http://127.0.0.1:9' } }),
      /nur im Entwicklungsmodus/,
    );
  });
});

describe('Anmeldung mit dem Minecraft-Konto: Ablauf', () => {
  test('Start: Weiterleitung zu Microsoft (PKCE S256, state, prompt=select_account), Bindungs-Cookie, noch keine Anfrage nach außen', async () => {
    const { service, fake, close } = await setup();
    try {
      const started = await begin(service);
      assert.equal(started.location.origin + started.location.pathname, `${fake.url}/consumers/oauth2/v2.0/authorize`);
      const params = Object.fromEntries(started.location.searchParams);
      assert.deepEqual(Object.keys(params).sort(), [
        'client_id',
        'code_challenge',
        'code_challenge_method',
        'prompt',
        'redirect_uri',
        'response_mode',
        'response_type',
        'scope',
        'state',
      ]);
      assert.equal(params.client_id, CLIENT_ID);
      assert.equal(params.redirect_uri, REDIRECT);
      assert.equal(params.response_type, 'code');
      assert.equal(params.response_mode, 'query');
      assert.equal(params.scope, 'XboxLive.signin');
      assert.equal(params.code_challenge_method, 'S256');
      assert.equal(params.prompt, 'select_account');
      assert.match(params.code_challenge!, /^[A-Za-z0-9_-]{43}$/);
      assert.match(params.state!, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(started.res.headers['cache-control'], 'no-store');
      assert.equal(started.res.headers['referrer-policy'], 'no-referrer');
      assert.match(started.cookie, new RegExp(`^${BINDING_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=600; HttpOnly; SameSite=Strict$`));
      assert.equal(fake.requests.length, 0);

      // Zweiter Start im selben Browser (zweiter Tab): dasselbe Bindungs-Cookie, neuer state und neue Challenge.
      const again = await begin(service, { binding: started.binding });
      assert.equal(again.binding, started.binding);
      assert.notEqual(again.state, started.state);
      assert.notEqual(again.challenge, started.challenge);
      // Ungültiges Cookie: ein neues.
      const replaced = await begin(service, { binding: 'kaputt' });
      assert.match(replaced.binding, /^[A-Za-z0-9_-]{43}$/);
      assert.notEqual(replaced.binding, started.binding);
      // Hinter dem Proxy (wie hinter Caddy) mit Secure.
      assert.match((await begin(service, { headers: PROXY })).cookie, /; Secure$/);
    } finally {
      await close();
    }
  });

  test('ganzer Ablauf (öffentlicher Client): Code → Xbox Live → XSTS → Minecraft → Profil, Spieler angelegt, Sitzung per gebundenem Code', async () => {
    const { service, fake, close } = await setup();
    try {
      const anna = fake.account({ name: 'Anna' });
      const { back, binding } = await signIn(service, anna);
      assert.equal(back.status, 303);
      assert.equal(back.res.headers['cache-control'], 'no-store');
      assert.equal(back.res.headers['referrer-policy'], 'no-referrer');
      assert.equal(back.location!.origin + back.location!.pathname, `${WEBSITE}/konto`);
      assert.match(back.location!.hash, /^#code=[A-Za-z0-9_-]{43}$/);
      assert.equal(back.res.headers['set-cookie'], undefined);

      // Was der Dienst draußen gefragt hat, in dieser Reihenfolge
      assert.deepEqual(
        fake.requests.map((r) => r.path),
        ['/consumers/oauth2/v2.0/token', '/user/authenticate', '/xsts/authorize', '/authentication/login_with_xbox', '/minecraft/profile'],
      );
      const form = new URLSearchParams(fake.requests[0]!.body);
      assert.equal(form.get('client_secret'), null, 'öffentlicher Client: kein Geheimnis');
      assert.match(form.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{43}$/);
      assert.equal(JSON.parse(fake.requests[1]!.body).Properties.RpsTicket, `d=${anna.msToken}`);
      assert.equal(JSON.parse(fake.requests[2]!.body).RelyingParty, 'rp://api.minecraftservices.com/');
      assert.equal(JSON.parse(fake.requests[3]!.body).identityToken, `XBL3.0 x=${anna.uhs};${anna.xstsToken}`);
      assert.equal(fake.requests[4]!.headers.authorization, `Bearer ${anna.mcToken}`);

      // Angelegt wie bei der Anmeldung im Launcher (UUID ohne Bindestriche, Name von Mojang)
      const user = storedUser(service, anna.uuid);
      assert.equal(user?.name, 'Anna');

      const code = new URLSearchParams(back.location!.hash.slice(1)).get('code')!;
      const session = await exchange(service, code, binding, { 'User-Agent': FIREFOX });
      assert.equal(session.status, 200, JSON.stringify(session.body));
      assert.equal(session.body.uuid, plainUuid(anna));
      assert.equal(session.body.name, 'Anna');
      assert.equal(session.body.role, null);
      const [sessionCookie, clearBinding, ...rest] = fetchSetCookies(session);
      assert.match(sessionCookie!, SESSION_RE);
      assert.equal(clearBinding, `${BINDING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
      assert.deepEqual(rest, []);

      const cookie = cookieFrom(session)!;
      const me = await webApi(service, 'GET', '/v1/web/me', { cookie });
      assert.equal(me.status, 200);
      assert.equal(me.body.uuid, plainUuid(anna));
      const sessions = await webApi(service, 'GET', '/v1/web/sessions', { cookie });
      assert.equal(sessions.body.sessions.length, 1);
      assert.equal(sessions.body.sessions[0].device, 'Firefox · Windows');
      assert.equal(sessions.body.sessions[0].current, true);

      // Der Code gilt nur einmal.
      const again = await exchange(service, code, binding);
      assert.equal(again.status, 401);
      assert.equal(again.body.error, LINK_EXPIRED);
    } finally {
      await close();
    }
  });

  test('vertraulicher Client: Client-Geheimnis im Token-Tausch; fehlt es, lehnt Microsoft ab (Log ohne Beschreibung)', async () => {
    const geheim = `geheim-${randomBytes(12).toString('hex')}`;
    {
      const { service, fake, close } = await setup({}, geheim);
      try {
        const ben = fake.account({ name: 'Ben' });
        const { back } = await signIn(service, ben);
        assert.match(back.location!.hash, /^#code=/);
        assert.equal(new URLSearchParams(fake.requests[0]!.body).get('client_secret'), geheim);
        assert.ok(!service.logs.join('\n').includes(geheim), 'Geheimnis im Log');
      } finally {
        await close();
      }
    }
    {
      // Plattform „Web“ ohne Geheimnis im Dienst: Microsoft antwortet invalid_client (AADSTS7000218).
      const { service, fake, close } = await setup({}, undefined, geheim);
      try {
        const ben = fake.account({ name: 'Ben' });
        const { back } = await signIn(service, ben);
        assert.equal(back.hash.get('fehler'), 'microsoft');
        const line = service.logs.find((l) => l.includes('Microsoft lehnt den Code ab'));
        assert.ok(line, service.logs.join('\n'));
        assert.match(line!, /HTTP 401, invalid_client, AADSTS7000218/);
        assert.ok(!line!.includes('secret missing'), 'Beschreibung von Microsoft gehört nicht ins Log');
        assert.equal(storedUser(service, ben.uuid), undefined);
      } finally {
        await close();
      }
    }
  });

  test('gleiche Sitzung wie beim Einmal-Link: Cookie-Regeln (auch hinter dem Proxy), WebMe-Felder, Name aktualisiert, Sicherheit listet beide', async () => {
    const { service, fake, close } = await setup();
    try {
      const ben = await devPlayer(service.url, 'Ben');
      for (const headers of [{}, PROXY]) {
        const viaLink = await webLogin(service, ben, headers);
        const account = fake.account({ name: 'Benjamin', uuid: ben.uuid });
        const { back, binding } = await signIn(service, account, { headers });
        const viaMicrosoft = await exchange(service, back.hash.get('code')!, binding, headers);
        assert.equal(viaMicrosoft.status, 200);
        const normalize = (header: string) => header.replace(/=[A-Za-z0-9_-]{43};/, '=…;');
        assert.equal(normalize(fetchSetCookies(viaMicrosoft)[0]!), normalize(fetchSetCookies(viaLink.response)[0]!));
        assert.deepEqual(Object.keys(viaMicrosoft.body).sort(), Object.keys(viaLink.me).sort());
        // Wie bei der Anmeldung im Launcher übernimmt der Dienst den Namen von Mojang.
        assert.equal(viaMicrosoft.body.name, 'Benjamin');
        assert.equal(viaMicrosoft.body.uuid, ben.uuid);
      }
      const { cookie } = await webLogin(service, ben);
      const sessions = await webApi(service, 'GET', '/v1/web/sessions', { cookie });
      assert.equal(sessions.body.sessions.length, 5);
      // Der Launcher-Weg geht weiter: Bearer-Token des Spielers gilt.
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: ben.token })).status, 200);
    } finally {
      await close();
    }
  });

  test('Ziel nur aus der Liste: support, team, sicherheit bleiben; alles andere fällt weg (auch bei Fehlern)', async () => {
    const { service, fake, close } = await setup();
    try {
      for (const [ziel, expected] of [
        ['support', 'support'],
        ['team', 'team'],
        ['sicherheit', 'sicherheit'],
        ['addons', 'addons'],
        ['evil', null],
        ['https://evil.example/', null],
        ['team&code=x', null],
        ['', null],
      ] as const) {
        const account = fake.account({ name: 'Cora' });
        const { back } = await signIn(service, account, { ziel });
        assert.equal(back.location!.origin + back.location!.pathname, `${WEBSITE}/konto`, ziel);
        assert.match(back.location!.hash, expected === null ? /^#code=[A-Za-z0-9_-]{43}$/ : new RegExp(`^#code=[A-Za-z0-9_-]{43}&ziel=${expected}$`), ziel);
      }
      const started = await begin(service, { ziel: 'support' });
      const cancelled = await callback(service, { error: 'access_denied', error_description: 'The user has denied access', state: started.state });
      assert.equal(cancelled.location!.hash, '#fehler=abgebrochen&ziel=support');
      const evil = await begin(service, { ziel: '//evil.example' });
      const failed = await callback(service, { error: 'access_denied', state: evil.state });
      assert.equal(failed.location!.href, `${WEBSITE}/konto#fehler=abgebrochen`);
    } finally {
      await close();
    }
  });

  test('state: nur einmal, höchstens 10 Minuten (hier 150 ms); unbekannt, fehlend oder falsch → abgelaufen, ohne Microsoft zu fragen', async () => {
    const { service, fake, close } = await setup({ microsoftStateTtlMs: 150 });
    try {
      const dora = fake.account({ name: 'Dora' });
      const first = await signIn(service, dora);
      assert.match(first.back.location!.hash, /^#code=/);
      const asked = fake.requests.length;
      // Dieselbe Rückkehr noch einmal (z. B. Zurück-Taste): state ist verbraucht.
      const reused = await callback(service, { code: dora.code, state: first.state });
      assert.equal(reused.location!.href, `${WEBSITE}/konto#fehler=abgelaufen`);
      const queries: Record<string, string>[] = [{ code: 'x', state: randomBytes(32).toString('base64url') }, { code: 'x' }, { code: 'x', state: 'zu-kurz' }, {}];
      for (const query of queries) {
        const res = await callback(service, query);
        assert.equal(res.status, 303);
        assert.equal(res.hash.get('fehler'), 'abgelaufen', JSON.stringify(query));
      }
      // Abgelaufen (Uhr: 150 ms)
      const late = await begin(service);
      await sleep(200);
      const expired = await callback(service, { code: fake.account({ name: 'Emil' }).code, state: late.state });
      assert.equal(expired.hash.get('fehler'), 'abgelaufen');
      assert.equal(fake.requests.length, asked, 'Microsoft wurde gefragt');
    } finally {
      await close();
    }
  });

  test('abgebrochen (access_denied) und andere Fehler von Microsoft; fehlender Code', async () => {
    const { service, fake, close } = await setup();
    try {
      const started = await begin(service);
      const cancelled = await callback(service, { error: 'access_denied', state: started.state });
      assert.equal(cancelled.hash.get('fehler'), 'abgebrochen');
      // Auch nach dem Abbrechen ist der state verbraucht.
      assert.equal((await callback(service, { code: 'x', state: started.state })).hash.get('fehler'), 'abgelaufen');

      const other = await begin(service);
      const failed = await callback(service, { error: 'server_error', state: other.state });
      assert.equal(failed.hash.get('fehler'), 'microsoft');
      assert.ok(service.logs.some((l) => l.includes('Microsoft meldet „server_error“')));
      const odd = await begin(service);
      await callback(service, { error: '<script>alert(1)</script>', state: odd.state });
      assert.ok(service.logs.some((l) => l.includes('Microsoft meldet „unbekannt“')));
      assert.ok(!service.logs.join('\n').includes('<script>'));

      const noCode = await begin(service);
      assert.equal((await callback(service, { state: noCode.state })).hash.get('fehler'), 'microsoft');
      assert.equal(fake.requests.length, 0);
    } finally {
      await close();
    }
  });

  test('Fehler von Xbox Live (XSTS-Codes) als eigene Fehlercodes; kein Spieler angelegt', async () => {
    const { service, fake, close } = await setup();
    try {
      for (const [xerr, expected] of [
        [2148916233, 'kein-xbox'],
        [2148916235, 'xbox-land'],
        [2148916236, 'xbox-alter'],
        [2148916237, 'xbox-alter'],
        [2148916238, 'kinderkonto'],
        [2148916227, 'xbox-gesperrt'],
        [2148916229, 'xbox-eltern'],
        [2148916234, 'xbox-bedingungen'],
        [2148916999, 'xbox'],
      ] as const) {
        const account = fake.account({
          name: 'Finn',
          xsts: { status: 401, body: { Identity: '0', XErr: xerr, Message: '', Redirect: 'https://start.ui.xboxlive.com/AddChildToFamily' } },
        });
        const { back } = await signIn(service, account, { ziel: 'support' });
        assert.equal(back.location!.hash, `#fehler=${expected}&ziel=support`, String(xerr));
        assert.equal(storedUser(service, account.uuid), undefined);
      }
      const brokenXbl = fake.account({ name: 'Finn', xbl: { status: 400 } });
      assert.equal((await signIn(service, brokenXbl)).back.hash.get('fehler'), 'xbox');
      const noClaims = fake.account({ name: 'Finn', xsts: { status: 200, body: { Token: 'x', DisplayClaims: { xui: [] } } } });
      assert.equal((await signIn(service, noClaims)).back.hash.get('fehler'), 'xbox');
    } finally {
      await close();
    }
  });

  test('kein Minecraft: Java Edition (Profil 404) → kein-minecraft; „Invalid app registration“ → minecraft mit Hinweis im Log (einmal)', async () => {
    const { service, fake, close } = await setup();
    try {
      const noJava = fake.account({ name: 'Gabi', profile: { status: 404, body: { path: '/minecraft/profile', errorType: 'NOT_FOUND', error: 'NOT_FOUND' } } });
      assert.equal((await signIn(service, noJava)).back.hash.get('fehler'), 'kein-minecraft');
      assert.equal(storedUser(service, noJava.uuid), undefined);

      const badProfile = fake.account({ name: 'Gabi', profile: { status: 200, body: { id: 'keine-uuid', name: 'Gabi' } } });
      assert.equal((await signIn(service, badProfile)).back.hash.get('fehler'), 'minecraft');

      for (let i = 0; i < 2; i++) {
        const blocked = fake.account({
          name: 'Gabi',
          mc: { status: 403, body: { path: '/authentication/login_with_xbox', errorMessage: 'Invalid app registration, see https://aka.ms/AppRegInfo for more information' } },
        });
        assert.equal((await signIn(service, blocked)).back.hash.get('fehler'), 'minecraft');
      }
      assert.equal(service.logs.filter((l) => l.includes('Invalid app registration')).length, 1, service.logs.join('\n'));
      assert.ok(service.logs.some((l) => l.includes('HELDIX_DIENST_MS_CLIENT_ID muss die von Mojang freigegebene App-ID')));
    } finally {
      await close();
    }
  });

  test('Microsoft lehnt den Code ab (invalid_grant) → microsoft', async () => {
    const { service, fake, close } = await setup();
    try {
      const hana = fake.account({ name: 'Hana' });
      const started = await begin(service);
      // Falscher Code (z. B. schon benutzt)
      const back = await callback(service, { code: 'MSCODE-falsch', state: started.state });
      assert.equal(back.hash.get('fehler'), 'microsoft');
      assert.ok(service.logs.some((l) => /Microsoft lehnt den Code ab \(HTTP 400, invalid_grant, AADSTS70008\)/.test(l)), service.logs.join('\n'));
      // Verifier passt nicht zur Challenge (Code aus einem anderen Start): Microsoft lehnt ab.
      const a = await begin(service);
      const b = await begin(service);
      hana.challenge = b.challenge;
      const wrong = await callback(service, { code: hana.code, state: a.state });
      assert.equal(wrong.hash.get('fehler'), 'microsoft');
      assert.ok(service.logs.some((l) => l.includes('AADSTS501481')));
    } finally {
      await close();
    }
  });

  test('Gegenseite überlastet oder nicht erreichbar: 429 → zu-viele, 5xx und Zeitüberschreitung → nicht-erreichbar', async () => {
    const { service, fake, close } = await setup({ mojangTimeoutMs: 300 });
    try {
      const busy = fake.account({ name: 'Ida', mc: { status: 429, body: {} } });
      assert.equal((await signIn(service, busy)).back.hash.get('fehler'), 'zu-viele');
      const down = fake.account({ name: 'Ida', profile: { status: 503, body: 'Service Unavailable' } });
      assert.equal((await signIn(service, down)).back.hash.get('fehler'), 'nicht-erreichbar');
      const tokenDown = fake.account({ name: 'Ida', token: { status: 500, body: '<html>' } });
      assert.equal((await signIn(service, tokenDown)).back.hash.get('fehler'), 'nicht-erreichbar');
      fake.delayMs = 600;
      const slow = fake.account({ name: 'Ida' });
      assert.equal((await signIn(service, slow)).back.hash.get('fehler'), 'nicht-erreichbar');
      fake.delayMs = 0;
      assert.ok(service.logs.some((l) => l.includes('Minecraft antwortet mit HTTP 503')));
      assert.ok(service.logs.some((l) => l.includes('Microsoft nicht erreichbar')));
    } finally {
      await close();
    }
    const nowhere = 'http://127.0.0.1:9';
    const unreachable = await setup({ microsoftEndpoints: { login: nowhere, xboxUser: nowhere, xsts: nowhere, minecraft: nowhere } });
    try {
      const account = unreachable.fake.account({ name: 'Ida' });
      assert.equal((await signIn(unreachable.service, account)).back.hash.get('fehler'), 'nicht-erreichbar');
    } finally {
      await unreachable.close();
    }
  });

  test('gesperrter Spieler: gesperrt, kein Konto und keine Sitzung; Sperre zwischen Rückkehr und Einlösen → 401', async () => {
    const { service, fake, close } = await setup();
    try {
      const jan = fake.account({ name: 'Jan' });
      const store = new Store(service.dataDir);
      try {
        store.ban(plainUuid(jan), 'Jan', 'Test', Date.now());
      } finally {
        store.close();
      }
      const { back } = await signIn(service, jan, { ziel: 'team' });
      assert.equal(back.location!.hash, '#fehler=gesperrt&ziel=team');
      assert.equal(storedUser(service, jan.uuid), undefined);

      const kim = fake.account({ name: 'Kim' });
      const later = await signIn(service, kim);
      const store2 = new Store(service.dataDir);
      try {
        store2.ban(plainUuid(kim), 'Kim', 'Test', Date.now());
      } finally {
        store2.close();
      }
      const res = await exchange(service, later.back.hash.get('code')!, later.binding);
      assert.equal(res.status, 401);
      assert.equal(res.headers.getSetCookie().length, 0);
    } finally {
      await close();
    }
  });

  test('Bindung an den Browser: ohne oder mit fremdem Bindungs-Cookie kein Einlösen (Code danach verbraucht); abgelaufen nach 120 s (hier 100 ms)', async () => {
    const { service, fake, close } = await setup({ webCodeTtlMs: 100 });
    try {
      const lea = fake.account({ name: 'Lea' });
      const first = await signIn(service, lea);
      const code = first.back.hash.get('code')!;
      // Link in einem anderen Browser geöffnet (kein Cookie): abgelehnt, und der Code ist weg.
      const foreign = await exchange(service, code);
      assert.equal(foreign.status, 401);
      assert.equal(foreign.body.error, MICROSOFT_EXPIRED);
      assert.equal((await exchange(service, code, first.binding)).status, 401);

      const second = await signIn(service, fake.account({ name: 'Lea' }));
      const wrong = await exchange(service, second.back.hash.get('code')!, randomBytes(32).toString('base64url'));
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.error, MICROSOFT_EXPIRED);

      const third = await signIn(service, fake.account({ name: 'Lea' }));
      await sleep(150);
      const late = await exchange(service, third.back.hash.get('code')!, third.binding);
      assert.equal(late.status, 401);
      assert.equal(late.body.error, MICROSOFT_EXPIRED);
    } finally {
      await close();
    }
  });

  test('Grenze pro IP (hier 3): Start und Rückkehr zählen, danach zu-viele mit Retry-After; andere IP hinter dem Proxy zählt eigens', async () => {
    const { service, fake, close } = await setup({ webMicrosoftRateLimit: 3, trustProxy: true });
    try {
      const max = fake.account({ name: 'Max' });
      const { back } = await signIn(service, max); // 2 Anfragen
      assert.match(back.location!.hash, /^#code=/);
      await begin(service); // 3
      const limited = await rawRequest(service.url, 'GET', '/v1/web/auth/microsoft?ziel=support');
      assert.equal(limited.status, 303);
      assert.equal(limited.headers.location, `${WEBSITE}/konto#fehler=zu-viele&ziel=support`);
      assert.ok(Number(limited.headers['retry-after']) >= 1);
      assert.equal(limited.headers['set-cookie'], undefined);
      assert.equal((await callback(service, { code: 'x', state: 'y' })).hash.get('fehler'), 'zu-viele');
      // Andere IP (letzter Eintrag von X-Forwarded-For, vom eigenen Proxy gesetzt)
      const other = await rawRequest(service.url, 'GET', '/v1/web/auth/microsoft', { 'X-Forwarded-For': '198.51.100.7' });
      assert.match(String(other.headers.location), /\/consumers\/oauth2\/v2\.0\/authorize\?/);
    } finally {
      await close();
    }
  });

  test('keine Tokens, Codes, Verifier oder Geheimnisse im Log (Erfolg und Fehler)', async () => {
    const geheim = `geheim-${randomBytes(12).toString('hex')}`;
    const { service, fake, close } = await setup({}, geheim);
    const states: string[] = [];
    try {
      const nora = fake.account({ name: 'Nora' });
      const ok = await signIn(service, nora);
      states.push(ok.state, ok.binding);
      const session = await exchange(service, ok.back.hash.get('code')!, ok.binding);
      assert.equal(session.status, 200);
      states.push(cookieFrom(session)!, ok.back.hash.get('code')!);
      for (const fields of [
        { xsts: { status: 401, body: { XErr: 2148916238 } } },
        { profile: { status: 404 } },
        { mc: { status: 403, body: { errorMessage: 'Invalid app registration' } } },
        { profile: { status: 503 } },
      ]) {
        // Bei den Fehlern nach dem Token-Tausch hatte der Dienst die Tokens schon in der Hand.
        const run = await signIn(service, fake.account({ name: 'Nora', ...fields }));
        states.push(run.state);
      }
    } finally {
      await close();
    }
    const verifiers = fake.requests.map((r) => new URLSearchParams(r.body).get('code_verifier') ?? '').filter(Boolean);
    assert.equal(verifiers.length, 5);
    const forbidden = [...fake.secrets(), geheim, ...states, ...verifiers];
    assert.ok(service.logs.length > 0);
    const logs = service.logs.join('\n');
    for (const value of forbidden) assert.ok(!logs.includes(value), `im Log: ${value.slice(0, 12)}…`);
  });

  test('Datenbank (samt WAL) enthält nach der Anmeldung keine Tokens, Codes oder Verifier', async () => {
    const geheim = `geheim-${randomBytes(12).toString('hex')}`;
    const { service, fake, close } = await setup({}, geheim);
    try {
      const otto = fake.account({ name: 'Otto' });
      const ok = await signIn(service, otto);
      const code = ok.back.hash.get('code')!;
      const session = await exchange(service, code, ok.binding);
      assert.equal(session.status, 200);
      await signIn(service, fake.account({ name: 'Otto', profile: { status: 404 } }));
      const forbidden = [
        ...fake.secrets(),
        geheim,
        ok.state,
        ok.binding,
        code,
        cookieFrom(session)!,
        ...fake.requests.map((r) => new URLSearchParams(r.body).get('code_verifier') ?? '').filter(Boolean),
      ];
      const files = fs.readdirSync(service.dataDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
      assert.ok(files.some((e) => e.name.endsWith('.db')));
      for (const entry of files) {
        const content = fs.readFileSync(path.join(entry.parentPath, entry.name)).toString('latin1');
        for (const value of forbidden) assert.ok(!content.includes(value), `${entry.name} enthält ${value.slice(0, 12)}…`);
      }
      // Gespeichert sind nur UUID und Name (und die Sitzung als Hash): Der Hash des Cookies steht drin, das Cookie nicht.
      assert.equal(storedUser(service, otto.uuid)?.name, 'Otto');
      const hash = createHash('sha256').update(cookieFrom(session)!, 'utf8').digest('hex');
      const all = files.map((e) => fs.readFileSync(path.join(e.parentPath, e.name)).toString('latin1')).join('');
      assert.ok(all.includes(hash), 'Sitzung als Hash gespeichert');
    } finally {
      await close();
    }
  });
});
