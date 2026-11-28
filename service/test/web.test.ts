// Anmeldung auf der Webseite: Einmal-Link, Cookie-Sitzung, Abmelden, Sitzungen, CSRF, Cookie auf den Spieler-Routen,
// Datenexport, eigene Meldungen, Konto löschen und Sperren.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runAdmin } from '../src/admin';
import { LINK_EXPIRED, SESSION_COOKIE } from '../src/web';
import { api, befriend, connect, devPlayer, sleep, startService, upgradeStatus, ME_DEFAULTS } from './helpers';
import { Clock, cookieFrom, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function setCookies(res: { headers: Headers }): string[] {
  return res.headers.getSetCookie();
}

describe('Einmal-Link (POST /v1/web/link)', () => {
  test('ohne HELDIX_DIENST_WEBSITE: 503', async () => {
    const service = await startService({ dev: true });
    try {
      const player = await devPlayer(service.url, 'Anna');
      const res = await api(service.url, 'POST', '/v1/web/link', { token: player.token });
      assert.equal(res.status, 503);
      assert.equal(res.body.error, 'Die Anmeldung auf der Webseite ist auf diesem Server nicht eingerichtet.');
    } finally {
      await service.close();
    }
  });

  test('Adresse mit Code im Fragment, 120 Sekunden gültig; nur mit Bearer-Token; höchstens N pro Minute (hier 2)', async () => {
    const service = await startService({ dev: true, website: `${WEBSITE}/`, webLinkRateLimit: 2 });
    try {
      const player = await devPlayer(service.url, 'Anna');
      const started = Date.now();
      const res = await api(service.url, 'POST', '/v1/web/link', { token: player.token });
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.body).sort(), ['expiresAt', 'url']);
      assert.match(res.body.url, /^https:\/\/heldix\.example\/konto#code=[A-Za-z0-9_-]{43}$/);
      assert.ok(res.body.expiresAt >= started + 119_000 && res.body.expiresAt <= Date.now() + 120_000);

      assert.equal((await api(service.url, 'POST', '/v1/web/link')).status, 401);
      assert.equal((await api(service.url, 'POST', '/v1/web/link', { token: player.token })).status, 200);
      const limited = await api(service.url, 'POST', '/v1/web/link', { token: player.token });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    } finally {
      await service.close();
    }
  });

  test('Link nur per Bearer, nicht per Cookie', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const player = await devPlayer(service.url, 'Anna');
      const { cookie } = await webLogin(service, player);
      assert.equal((await webApi(service, 'POST', '/v1/web/link', { cookie })).status, 401);
    } finally {
      await service.close();
    }
  });
});

describe('Web-Sitzung', () => {
  test('Code einmal einlösen: WebMe und Cookie (HttpOnly, SameSite=Strict, Path=/, Secure außer direkt über HTTP von 127.0.0.1)', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const player = await devPlayer(service.url, 'Anna');
      const link = await api(service.url, 'POST', '/v1/web/link', { token: player.token });
      const code = new URL(link.body.url).hash.slice('#code='.length);
      const started = Date.now();
      const res = await api(service.url, 'POST', '/v1/web/session', { body: { code } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { expiresAt, ...rest } = res.body;
      assert.deepEqual(rest, {
        uuid: player.uuid,
        name: 'Anna',
        cape: '',
        visible: true,
        presence: true,
        showServer: true,
        messages: true,
        ...ME_DEFAULTS,
        role: null,
        permissions: [],
        communityBadge: null,
        twoFactor: { enabled: false, verified: false },
      });
      // 30 Tage ab Anmeldung, aber höchstens 7 Tage ohne Nutzung: also jetzt + 7 Tage.
      assert.ok(Math.abs(expiresAt - (started + 7 * 24 * 3600 * 1000)) < 5000);
      const [header] = setCookies(res);
      assert.match(header!, new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict$`));

      // Derselbe Code noch einmal: 401 mit dem Text für den Spieler.
      const again = await api(service.url, 'POST', '/v1/web/session', { body: { code } });
      assert.equal(again.status, 401);
      assert.equal(again.body.error, LINK_EXPIRED);
      for (const body of [{}, { code: 'kurz' }, { code: 'x'.repeat(43) }, { code: 42 }]) {
        const res401 = await api(service.url, 'POST', '/v1/web/session', { body });
        assert.equal(res401.status, 401, JSON.stringify(body));
        assert.equal(res401.body.error, LINK_EXPIRED);
      }

      // Über einen Proxy (wie hinter Caddy) immer mit Secure.
      const proxied = await webLogin(service, player, { 'X-Forwarded-For': '203.0.113.5', 'X-Forwarded-Proto': 'https' });
      assert.match(setCookies(proxied.response)[0]!, /; Secure$/);
    } finally {
      await service.close();
    }
  });

  test('abgelaufener Code (hier nach 100 ms): 401', async () => {
    const service = await startService({ dev: true, website: WEBSITE, webCodeTtlMs: 100 });
    try {
      const player = await devPlayer(service.url, 'Anna');
      const link = await api(service.url, 'POST', '/v1/web/link', { token: player.token });
      await sleep(150);
      const res = await api(service.url, 'POST', '/v1/web/session', { body: { code: new URL(link.body.url).hash.slice(6) } });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, LINK_EXPIRED);
    } finally {
      await service.close();
    }
  });

  test('me, Sitzungen mit Gerät, eine Sitzung beenden, abmelden', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const player = await devPlayer(service.url, 'Anna');
      const pc = await webLogin(service, player, { 'User-Agent': FIREFOX });
      await sleep(5);
      const phone = await webLogin(service, player, { 'User-Agent': CHROME_ANDROID });

      const me = await webApi(service, 'GET', '/v1/web/me', { cookie: pc.cookie });
      assert.equal(me.status, 200);
      assert.equal(me.body.uuid, player.uuid);
      assert.equal((await webApi(service, 'GET', '/v1/web/me')).status, 401);
      // Nur mit Cookie: Ein Bearer-Token gilt hier nicht.
      assert.equal((await api(service.url, 'GET', '/v1/web/me', { token: player.token })).status, 401);
      // Ungültiges Cookie: 401 und das Cookie wird gelöscht.
      const bad = await webApi(service, 'GET', '/v1/web/me', { cookie: 'A'.repeat(43) });
      assert.equal(bad.status, 401);
      assert.match(setCookies(bad)[0]!, new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0;`));

      const list = await webApi(service, 'GET', '/v1/web/sessions', { cookie: pc.cookie });
      assert.equal(list.status, 200);
      assert.equal(list.body.sessions.length, 2);
      for (const s of list.body.sessions) assert.deepEqual(Object.keys(s).sort(), ['createdAt', 'current', 'device', 'id', 'lastUsedAt']);
      const byDevice = Object.fromEntries(list.body.sessions.map((s: { device: string; current: boolean }) => [s.device, s.current]));
      assert.deepEqual(byDevice, { 'Firefox · Windows': true, 'Chrome · Android': false });
      const phoneId = list.body.sessions.find((s: { current: boolean }) => !s.current).id;

      // Andere Sitzung beenden: Das Handy ist abgemeldet.
      const removed = await webApi(service, 'DELETE', `/v1/web/sessions/${phoneId}`, { cookie: pc.cookie });
      assert.equal(removed.status, 200);
      assert.equal(removed.body.sessions.length, 1);
      assert.deepEqual(setCookies(removed), [], 'die eigene bleibt');
      assert.equal((await webApi(service, 'GET', '/v1/web/me', { cookie: phone.cookie })).status, 401);
      // Unbekannte ID: nichts passiert.
      assert.equal((await webApi(service, 'DELETE', '/v1/web/sessions/gibtsnicht', { cookie: pc.cookie })).body.sessions.length, 1);

      // Eigene Sitzung beenden = abmelden.
      const self = await webApi(service, 'DELETE', `/v1/web/sessions/${removed.body.sessions[0].id}`, { cookie: pc.cookie });
      assert.equal(self.status, 200);
      assert.match(setCookies(self)[0]!, /Max-Age=0/);
      assert.equal((await webApi(service, 'GET', '/v1/web/me', { cookie: pc.cookie })).status, 401);

      // Abmelden
      const third = await webLogin(service, player);
      const logout = await webApi(service, 'POST', '/v1/web/logout', { cookie: third.cookie });
      assert.equal(logout.status, 200);
      assert.deepEqual(logout.body, { ok: true });
      assert.equal(cookieFrom(logout), '');
      assert.equal((await webApi(service, 'GET', '/v1/web/me', { cookie: third.cookie })).status, 401);
    } finally {
      await service.close();
    }
  });

  test('Ablauf: ohne Nutzung (hier 200 ms) und insgesamt (hier 400 ms)', async () => {
    const idle = await startService({ dev: true, website: WEBSITE, webSessionIdleMs: 200 });
    try {
      const player = await devPlayer(idle.url, 'Anna');
      const { cookie } = await webLogin(idle, player);
      assert.equal((await webApi(idle, 'GET', '/v1/web/me', { cookie })).status, 200);
      await sleep(260);
      assert.equal((await webApi(idle, 'GET', '/v1/web/me', { cookie })).status, 401);
    } finally {
      await idle.close();
    }
    const total = await startService({ dev: true, website: WEBSITE, webSessionTtlMs: 400 });
    try {
      const player = await devPlayer(total.url, 'Ben');
      const { cookie } = await webLogin(total, player);
      for (let i = 0; i < 3; i++) {
        assert.equal((await webApi(total, 'GET', '/v1/web/me', { cookie })).status, 200);
        await sleep(100);
      }
      await sleep(200);
      assert.equal((await webApi(total, 'GET', '/v1/web/me', { cookie })).status, 401);
    } finally {
      await total.close();
    }
  });
});

describe('CSRF und Cookie auf den Spieler-Routen', () => {
  test('mit Cookie: alles außer GET braucht X-Heldix-Web: 1, und Origin muss die Webseite sein', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const player = await devPlayer(service.url, 'Anna');
      const { cookie } = await webLogin(service, player);
      const put = (headers: Record<string, string>, csrf: boolean) =>
        webApi(service, 'PUT', '/v1/me', { cookie, body: { cape: 'glut' }, headers, csrf });
      for (const [headers, csrf] of [
        [{}, false],
        [{ 'X-Heldix-Web': '0' }, false],
        [{ Origin: 'https://boese.example' }, true],
        [{ Origin: 'https://heldix.example.boese.example' }, true],
        [{ Origin: 'null' }, true],
      ] as [Record<string, string>, boolean][]) {
        const res = await put(headers, csrf);
        assert.equal(res.status, 403, JSON.stringify(headers));
        assert.equal(typeof res.body.error, 'string');
      }
      assert.equal((await webApi(service, 'GET', '/v1/me', { cookie })).body.cape, '', 'nichts geändert');
      assert.equal((await put({ Origin: WEBSITE }, true)).status, 200);
      assert.equal((await put({}, true)).status, 200, 'ohne Origin geht es auch');
      // Abmelden ist auch geschützt.
      assert.equal((await webApi(service, 'POST', '/v1/web/logout', { cookie, csrf: false })).status, 403);
      // Mit Bearer-Token gilt die Regel nicht.
      assert.equal((await api(service.url, 'PUT', '/v1/me', { token: player.token, body: { cape: 'neon' } })).status, 200);
    } finally {
      await service.close();
    }
  });

  test('Freunde, Nachrichten, Meldungen, Nachschlagen mit Cookie; die Web-Sitzung macht nicht online; WebSocket mit Cookie nur mit Origin', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      await befriend(service.url, anna, ben);
      const { cookie } = await webLogin(service, anna);
      const benWs = await connect(service.wsUrl, ben.token);
      try {
        assert.equal(benWs.friends.friends[0].online, false);
        const friends = await webApi(service, 'GET', '/v1/friends', { cookie });
        assert.equal(friends.status, 200);
        assert.equal(friends.body.friends[0].name, 'Ben');
        const sent = await webApi(service, 'POST', `/v1/messages/${ben.uuid}`, { cookie, body: { text: 'Hallo von der Webseite' } });
        assert.equal(sent.status, 200);
        assert.equal((await benWs.client.next('message')).message.text, 'Hallo von der Webseite');
        assert.equal((await webApi(service, 'GET', '/v1/messages', { cookie })).body.conversations.length, 1);
        assert.equal((await webApi(service, 'POST', '/v1/reports', { cookie, body: { uuid: ben.uuid, reason: 'other' } })).status, 200);
        assert.equal((await webApi(service, 'GET', '/v1/blocks', { cookie })).status, 200);
        // Anna ist nicht online: kein Status für Ben, kein Eintrag beim Nachschlagen.
        await benWs.client.sync();
        assert.deepEqual(
          benWs.client.drain().filter((m) => m.type === 'friend'),
          [],
        );
        const lookup = await webApi(service, 'POST', '/v1/players/lookup', { cookie, body: { uuids: [anna.uuid] } });
        assert.deepEqual(lookup.body, { players: {} });
        assert.equal((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.friends[0].online, false);
        // WebSocket mit Cookie nur mit dem Origin der Webseite (ab 1.12.0 als Begleiter, siehe web-realtime.test.ts).
        assert.equal((await upgradeStatus(service.wsUrl, { Cookie: `${SESSION_COOKIE}=${cookie}` })).status, 403);
        assert.equal((await upgradeStatus(service.wsUrl, { Cookie: `${SESSION_COOKIE}=${cookie}`, Origin: 'https://boese.example' })).status, 403);
      } finally {
        await benWs.client.close();
      }
    } finally {
      await service.close();
    }
  });
});

describe('Spieler-Bereich', () => {
  test('Datenexport: Datei mit allen Daten, ohne Hashes; höchstens N pro Stunde (hier 2)', async () => {
    const service = await startService({ dev: true, website: WEBSITE, exportRateLimit: 2 });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      const carla = await devPlayer(service.url, 'Carla');
      await befriend(service.url, anna, ben);
      await api(service.url, 'POST', '/v1/friends/requests', { token: carla.token, body: { name: 'Anna' } });
      await api(service.url, 'POST', `/v1/messages/${ben.uuid}`, { token: anna.token, body: { text: 'an Ben' } });
      await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: ben.token, body: { text: 'an Anna' } });
      await api(service.url, 'POST', '/v1/blocks', { token: anna.token, body: { name: 'Carla' } });
      await api(service.url, 'POST', '/v1/reports', { token: anna.token, body: { uuid: carla.uuid, reason: 'spam', note: 'nervt' } });
      const { cookie } = await webLogin(service, anna, { 'User-Agent': FIREFOX });

      const res = await webApi(service, 'GET', '/v1/me/export', { cookie });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-disposition'), 'attachment; filename="heldix-daten-Anna.json"');
      assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
      const data = res.body;
      for (const key of ['exportedAt', 'profile', 'friends', 'requests', 'messages', 'blocked', 'reports', 'logins', 'webSessions', 'team']) {
        assert.ok(Object.hasOwn(data, key), key);
      }
      assert.equal(data.profile.uuid, anna.uuid);
      assert.equal(typeof data.profile.createdAt, 'number');
      assert.deepEqual(data.friends.map((f: { name: string }) => f.name), ['Ben']);
      assert.equal(data.requests.incoming.length, 0, 'Carla ist blockiert: Anfrage weg');
      assert.deepEqual(data.messages.map((m: { text: string }) => m.text), ['an Ben', 'an Anna']);
      assert.deepEqual(data.blocked.map((b: { name: string }) => b.name), ['Carla']);
      assert.equal(data.reports[0].note, 'nervt');
      assert.equal(data.webSessions[0].device, 'Firefox · Windows');
      assert.equal(data.team, null);
      // Weder Token noch Cookie noch Hashes stehen drin.
      const text = JSON.stringify(data);
      assert.equal(text.includes(anna.token), false);
      assert.equal(text.includes(cookie), false);
      assert.equal(/[0-9a-f]{64}/.test(text), false, 'kein SHA-256-Hash');

      // Mit Bearer-Token geht es auch; die Grenze zählt pro Spieler.
      assert.equal((await api(service.url, 'GET', '/v1/me/export', { token: anna.token })).status, 200);
      assert.equal((await webApi(service, 'GET', '/v1/me/export', { cookie })).status, 429);
    } finally {
      await service.close();
    }
  });

  test('eigene Meldungen mit Status', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      const carla = await devPlayer(service.url, 'Carla');
      await api(service.url, 'POST', '/v1/reports', { token: anna.token, body: { uuid: ben.uuid, reason: 'spam' } });
      await sleep(5);
      await api(service.url, 'POST', '/v1/reports', { token: anna.token, body: { uuid: carla.uuid, reason: 'harassment', note: 'gemein' } });
      await api(service.url, 'POST', '/v1/reports', { token: ben.token, body: { uuid: anna.uuid, reason: 'other' } });
      const { cookie } = await webLogin(service, anna);
      let mine = await webApi(service, 'GET', '/v1/reports/mine', { cookie });
      assert.equal(mine.status, 200);
      assert.equal(mine.body.reports.length, 2);
      const [newest, older] = mine.body.reports;
      assert.deepEqual(Object.keys(newest).sort(), ['at', 'id', 'kind', 'note', 'reason', 'reported', 'status']);
      assert.deepEqual(newest.reported, { uuid: carla.uuid, name: 'Carla' });
      assert.deepEqual([newest.reason, newest.note, newest.status], ['harassment', 'gemein', 'open']);
      assert.equal(older.reported.name, 'Ben');

      assert.equal(runAdmin(['meldung-erledigt', String(older.id)], service.dataDir, { out: () => {}, err: () => {} }), 0);
      mine = await api(service.url, 'GET', '/v1/reports/mine', { token: anna.token });
      assert.deepEqual(mine.body.reports.map((r: { status: string }) => r.status), ['open', 'done']);
    } finally {
      await service.close();
    }
  });

  test('Konto löschen per Cookie: alle Web-Sitzungen und die Team-Mitgliedschaft sind weg', async () => {
    const clock = new Clock();
    const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    try {
      const admin = await devPlayer(service.url, 'Chefin');
      await teamLogin(service, admin, 'admin', clock);
      const anna = await devPlayer(service.url, 'Anna');
      const a = await teamLogin(service, anna, 'moderator', clock);
      const b = await webLogin(service, anna);
      const res = await webApi(service, 'DELETE', '/v1/me', { cookie: a.cookie });
      assert.equal(res.status, 200);
      assert.match(setCookies(res)[0]!, /Max-Age=0/);
      assert.equal((await webApi(service, 'GET', '/v1/web/me', { cookie: b.cookie })).status, 401);
      // Neu angemeldet ist Anna nicht mehr im Team.
      const fresh = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Anna', uuid: anna.uuid } });
      const again = await webLogin(service, { ...anna, token: fresh.body.token });
      assert.equal(again.me.role, null);
    } finally {
      await service.close();
    }
  });

  test('Sperre beendet Web-Sitzungen; per Team sofort mit 4003, per CLI beim nächsten Lebenszeichen', async () => {
    const clock = new Clock();
    const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    try {
      const mod = await devPlayer(service.url, 'Moderatorin');
      const team = await teamLogin(service, mod, 'moderator', clock);
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      const annaWeb = await webLogin(service, anna);
      const annaWs = await connect(service.wsUrl, anna.token);
      const banned = await webApi(service, 'POST', '/v1/team/bans', { cookie: team.cookie, body: { name: 'Anna', reason: 'Spam im Chat' } });
      assert.equal(banned.status, 200, JSON.stringify(banned.body));
      const closed = await annaWs.client.closed;
      assert.deepEqual(closed, { code: 4003, reason: 'Gesperrt' });
      assert.equal((await webApi(service, 'GET', '/v1/web/me', { cookie: annaWeb.cookie })).status, 401);
      assert.equal((await api(service.url, 'POST', '/v1/web/link', { token: anna.token })).status, 401);

      // Über die CLI: Die Verbindung erfährt es beim nächsten Ping.
      const benWs = await connect(service.wsUrl, ben.token);
      const benWeb = await webLogin(service, ben);
      assert.equal(runAdmin(['sperren', 'Ben', 'Test'], service.dataDir, { out: () => {}, err: () => {} }), 0);
      assert.equal((await webApi(service, 'GET', '/v1/web/me', { cookie: benWeb.cookie })).status, 401);
      benWs.client.send({ type: 'ping' });
      assert.deepEqual(await benWs.client.closed, { code: 4003, reason: 'Gesperrt' });
    } finally {
      await service.close();
    }
  });
});

test('Anmelden nur von der eigenen Webseite: fremder Origin ergibt 403, der Code bleibt gültig', async () => {
  const service = await startService({ dev: true, website: WEBSITE });
  try {
    const player = await devPlayer(service.url, 'Anna');
    const link = await api(service.url, 'POST', '/v1/web/link', { token: player.token });
    const code = new URL(link.body.url).hash.slice('#code='.length);
    const foreign = await api(service.url, 'POST', '/v1/web/session', { body: { code }, headers: { Origin: 'https://boese.example' } });
    assert.equal(foreign.status, 403);
    assert.deepEqual(setCookies(foreign), []);
    const own = await api(service.url, 'POST', '/v1/web/session', { body: { code }, headers: { Origin: WEBSITE } });
    assert.equal(own.status, 200);
  } finally {
    await service.close();
  }
});
