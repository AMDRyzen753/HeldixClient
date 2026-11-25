// Team-Bereich: Zugang (Rolle, 2FA), Meldungen, Sperren, Spieler, Neuigkeiten, Mitglieder, Protokoll.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runAdmin } from '../src/admin';
import { api, befriend, connect, devPlayer, randomUuid, sleep, startService, waitFor, type Player, type TestService } from './helpers';
import { addToTeam, Clock, codeFor, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

const quiet = { out: () => {}, err: () => {} };

describe('Zugang zum Team-Bereich', () => {
  test('forbidden, 2fa_setup_required, Einrichtung, 2fa_required, Bestätigen; Bearer zählt nicht', async () => {
    const clock = new Clock();
    const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    try {
      const player = await devPlayer(service.url, 'Mod_1');
      const { cookie } = await webLogin(service, player);
      // Ohne Rolle
      let res = await webApi(service, 'GET', '/v1/team/reports', { cookie });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'forbidden');
      res = await webApi(service, 'POST', '/v1/web/2fa/setup', { cookie });
      assert.deepEqual([res.status, res.body.code], [403, 'forbidden']);
      // Ohne Anmeldung auf der Webseite: 401 (auch mit Bearer-Token)
      assert.equal((await api(service.url, 'GET', '/v1/team/reports', { token: player.token })).status, 401);

      addToTeam(service, player, 'moderator');
      res = await webApi(service, 'GET', '/v1/team/reports', { cookie });
      assert.deepEqual([res.status, res.body.code], [403, '2fa_setup_required']);
      assert.equal(typeof res.body.error, 'string');
      res = await webApi(service, 'POST', '/v1/web/2fa/verify', { cookie, body: { code: '123456' } });
      assert.deepEqual([res.status, res.body.code], [403, '2fa_setup_required']);
      res = await webApi(service, 'POST', '/v1/web/2fa/enable', { cookie, body: { code: '123456' } });
      assert.equal(res.status, 409, 'erst einrichten');
      const me = await webApi(service, 'GET', '/v1/web/me', { cookie });
      assert.deepEqual([me.body.role, me.body.twoFactor], ['moderator', { enabled: false, verified: false }]);

      const first = await webApi(service, 'POST', '/v1/web/2fa/setup', { cookie });
      assert.equal(first.status, 200);
      assert.match(first.body.secret, /^[A-Z2-7]{32}$/);
      assert.equal(
        first.body.uri,
        `otpauth://totp/HeldixClient:Mod_1?secret=${first.body.secret}&issuer=HeldixClient&algorithm=SHA1&digits=6&period=30`,
      );
      // Ein neuer Aufruf ersetzt das vorläufige Geheimnis.
      const setup = await webApi(service, 'POST', '/v1/web/2fa/setup', { cookie });
      assert.notEqual(setup.body.secret, first.body.secret);
      res = await webApi(service, 'POST', '/v1/web/2fa/enable', { cookie, body: { code: codeFor(first.body.secret, clock) } });
      assert.deepEqual([res.status, res.body.error], [401, 'Der Code stimmt nicht.']);
      for (const code of ['12345', 'abcdef', 123456, null]) {
        assert.equal((await webApi(service, 'POST', '/v1/web/2fa/enable', { cookie, body: { code } })).status, 400, String(code));
      }
      const code = codeFor(setup.body.secret, clock);
      res = await webApi(service, 'POST', '/v1/web/2fa/enable', { cookie, body: { code: `${code.slice(0, 3)} ${code.slice(3)}` } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.role, res.body.twoFactor], ['moderator', { enabled: true, verified: true }]);
      assert.equal((await webApi(service, 'GET', '/v1/team/reports', { cookie })).status, 200);
      res = await webApi(service, 'POST', '/v1/web/2fa/setup', { cookie });
      assert.equal(res.status, 409, 'schon eingerichtet');

      // Neue Sitzung: erst den Code eingeben. Derselbe Code (Zeitschritt) gilt nicht noch einmal.
      const second = await webLogin(service, player);
      assert.deepEqual(second.me.twoFactor, { enabled: true, verified: false });
      res = await webApi(service, 'GET', '/v1/team/reports', { cookie: second.cookie });
      assert.deepEqual([res.status, res.body.code], [403, '2fa_required']);
      res = await webApi(service, 'POST', '/v1/web/2fa/verify', { cookie: second.cookie, body: { code } });
      assert.deepEqual([res.status, res.body.error], [401, 'Der Code stimmt nicht.'], 'Wiederholung');
      clock.step();
      res = await webApi(service, 'POST', '/v1/web/2fa/verify', { cookie: second.cookie, body: { code: codeFor(setup.body.secret, clock) } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.twoFactor, { enabled: true, verified: true });
      assert.equal((await webApi(service, 'GET', '/v1/team/reports', { cookie: second.cookie })).status, 200);
      // Ein Code von vor zwei Schritten gilt nicht mehr.
      const third = await webLogin(service, player);
      clock.step();
      clock.step();
      res = await webApi(service, 'POST', '/v1/web/2fa/verify', { cookie: third.cookie, body: { code: totpAt(setup.body.secret, clock.now - 60_000) } });
      assert.equal(res.status, 401);
    } finally {
      await service.close();
    }
  });

  test('höchstens 5 Versuche pro 10 Minuten; Bestätigung gilt nur begrenzt (hier 300 ms)', async () => {
    const clock = new Clock();
    const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, totpRateLimit: undefined, teamVerifyTtlMs: 300 });
    try {
      const player = await devPlayer(service.url, 'Mod_2');
      const { cookie, secret } = await teamLogin(service, player, 'moderator', clock);
      assert.equal((await webApi(service, 'GET', '/v1/team/bans', { cookie })).status, 200);
      await sleep(350);
      const expired = await webApi(service, 'GET', '/v1/team/bans', { cookie });
      assert.deepEqual([expired.status, expired.body.code], [403, '2fa_required']);
      // Der eine Versuch beim Einrichten zählt mit: noch 4 falsche, dann ist Schluss, auch mit richtigem Code.
      for (let i = 0; i < 4; i++) {
        assert.equal((await webApi(service, 'POST', '/v1/web/2fa/verify', { cookie, body: { code: '000000' } })).status, 401, `Versuch ${i + 2}`);
      }
      const limited = await webApi(service, 'POST', '/v1/web/2fa/verify', { cookie, body: { code: codeFor(secret, clock) } });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) > 60);
    } finally {
      await service.close();
    }
  });
});

describe('Team-Bereich', () => {
  const clock = new Clock();
  let service: TestService;
  let admin: Player;
  let mod: Player;
  let adminCookie: string;
  let modCookie: string;
  let anna: Player;
  let ben: Player;

  before(async () => {
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    admin = await devPlayer(service.url, 'Chefin');
    mod = await devPlayer(service.url, 'Moderator');
    adminCookie = (await teamLogin(service, admin, 'admin', clock)).cookie;
    modCookie = (await teamLogin(service, mod, 'moderator', clock)).cookie;
    anna = await devPlayer(service.url, 'Anna_X');
    ben = await devPlayer(service.url, 'Ben');
    await befriend(service.url, anna, ben);
  });
  after(() => service.close());

  const asAdmin = (method: string, path: string, body?: unknown) => webApi(service, method, path, { cookie: adminCookie, body });
  const asMod = (method: string, path: string, body?: unknown) => webApi(service, method, path, { cookie: modCookie, body });

  test('Moderatoren: keine Admin-Routen (forbidden)', async () => {
    for (const [method, path] of [
      ['GET', '/v1/team/members'],
      ['POST', '/v1/team/members'],
      ['GET', '/v1/team/audit'],
      ['GET', '/v1/team/updates'],
      ['PUT', '/v1/team/updates/manifest'],
      ['PUT', '/v1/team/updates/files/HeldixClient-Setup-1.0.0.exe'],
      ['DELETE', '/v1/team/updates/files/HeldixClient-Setup-1.0.0.exe'],
      ['POST', `/v1/team/players/${anna.uuid}/reset-cape`],
      ['DELETE', `/v1/team/players/${anna.uuid}`],
      ['PUT', `/v1/team/members/${anna.uuid}`],
      ['DELETE', `/v1/team/members/${anna.uuid}`],
      ['POST', `/v1/team/members/${anna.uuid}/reset-2fa`],
    ]) {
      const res = await asMod(method!, path!, {});
      assert.deepEqual([res.status, res.body.code], [403, 'forbidden'], `${method} ${path}`);
    }
    for (const path of ['/v1/team/reports', '/v1/team/bans', '/v1/team/players?q=a', '/v1/team/news', `/v1/team/players/${anna.uuid}`]) {
      assert.equal((await asMod('GET', path)).status, 200, path);
    }
    // Ohne CSRF-Header: 403 (ohne code).
    const csrf = await webApi(service, 'POST', '/v1/team/news', { cookie: modCookie, body: { title: 'x', text: 'y' }, csrf: false });
    assert.equal(csrf.status, 403);
    assert.equal(csrf.body.code, undefined);
  });

  test('Meldungen: Liste mit Beleg, Filter, erledigen', async () => {
    await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: ben.token, body: { text: 'Du nervst' } });
    await api(service.url, 'POST', '/v1/reports', { token: anna.token, body: { uuid: ben.uuid, reason: 'harassment', note: 'seit gestern' } });
    await sleep(5);
    await api(service.url, 'POST', '/v1/reports', { token: ben.token, body: { uuid: anna.uuid, reason: 'spam' } });
    let res = await asMod('GET', '/v1/team/reports');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.reports.map((r: { reason: string }) => r.reason), ['spam', 'harassment'], 'neueste zuerst, nur offene');
    const report = res.body.reports[1];
    assert.deepEqual(Object.keys(report).sort(), ['at', 'doneAt', 'doneBy', 'id', 'messages', 'note', 'reason', 'reported', 'reporter', 'status']);
    assert.deepEqual(report.reporter, { uuid: anna.uuid, name: 'Anna_X' });
    assert.deepEqual(report.reported, { uuid: ben.uuid, name: 'Ben', banned: false });
    assert.deepEqual(report.messages.map((m: { from: string; fromName: string; text: string }) => [m.from, m.fromName, m.text]), [[ben.uuid, 'Ben', 'Du nervst']]);
    assert.equal(typeof report.messages[0].at, 'number');
    assert.deepEqual([report.status, report.doneAt, report.doneBy, report.note], ['open', null, null, 'seit gestern']);

    const done = await asMod('POST', `/v1/team/reports/${report.id}/done`);
    assert.equal(done.status, 200);
    assert.equal(done.body.report.status, 'done');
    assert.equal(done.body.report.doneBy, 'Moderator');
    assert.equal(typeof done.body.report.doneAt, 'number');
    // Noch einmal: bleibt, wie es war.
    assert.deepEqual((await asMod('POST', `/v1/team/reports/${report.id}/done`)).body, done.body);
    assert.equal((await asMod('POST', '/v1/team/reports/999999/done')).status, 404);
    assert.equal((await asMod('POST', '/v1/team/reports/abc/done')).status, 404);

    assert.equal((await asMod('GET', '/v1/team/reports?status=open')).body.reports.length, 1);
    assert.deepEqual((await asMod('GET', '/v1/team/reports?status=done')).body.reports.map((r: { id: number }) => r.id), [report.id]);
    assert.equal((await asMod('GET', '/v1/team/reports?status=all')).body.reports.length, 2);
    assert.equal((await asMod('GET', '/v1/team/reports?status=kaputt')).status, 400);
  });

  test('Sperren: Liste, Gründe, Schutz für Team-Mitglieder, entsperren', async () => {
    const victim = await devPlayer(service.url, 'Stoerer');
    const ws = await connect(service.wsUrl, victim.token);
    for (const body of [{ name: 'Stoerer' }, { name: 'Stoerer', reason: '' }, { name: 'Stoerer', reason: 'x'.repeat(301) }, { name: 'Stoerer', reason: 'a\nb' }]) {
      assert.equal((await asMod('POST', '/v1/team/bans', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await asMod('POST', '/v1/team/bans', { name: 'GibtEsNicht', reason: 'x' })).status, 404);
    assert.equal((await asMod('POST', '/v1/team/bans', { uuid: mod.uuid, reason: 'x' })).status, 400, 'sich selbst');
    assert.equal((await asMod('POST', '/v1/team/bans', { name: 'Chefin', reason: 'Putsch' })).status, 409, 'Team-Mitglied');

    const res = await asMod('POST', '/v1/team/bans', { name: 'stoerer', reason: 'Spam im Chat' });
    assert.equal(res.status, 200);
    const entry = res.body.bans.find((b: { uuid: string }) => b.uuid === victim.uuid);
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'by', 'name', 'reason', 'uuid']);
    assert.deepEqual([entry.name, entry.reason, entry.by], ['Stoerer', 'Spam im Chat', 'Moderator']);
    assert.equal((await ws.client.closed).code, 4003);
    // Nie gesehene UUID geht auch; CLI-Sperren haben by: null.
    const unknown = randomUuid();
    assert.equal((await asMod('POST', '/v1/team/bans', { uuid: unknown, reason: 'Vorbeugend' })).status, 200);
    runAdmin(['sperren', randomUuid()], service.dataDir, quiet);
    const list = await asMod('GET', '/v1/team/bans');
    assert.equal(list.body.bans.length, 3);
    assert.equal(list.body.bans[0].by, null, 'neueste zuerst; über die CLI');

    const unbanned = await asMod('DELETE', `/v1/team/bans/${unknown}`);
    assert.equal(unbanned.status, 200);
    assert.equal(unbanned.body.bans.some((b: { uuid: string }) => b.uuid === unknown), false);
    assert.equal((await asMod('DELETE', '/v1/team/bans/kaputt')).status, 400);
  });

  test('Spieler: suchen (Name, UUID, Gesperrte), ansehen ohne Nachrichten, Cape zurücksetzen, löschen', async () => {
    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { cape: 'glut' } });
    await api(service.url, 'POST', `/v1/messages/${ben.uuid}`, { token: anna.token, body: { text: 'Geheimer-Text-42' } });
    const annaWs = await connect(service.wsUrl, anna.token);

    let res = await asMod('GET', '/v1/team/players?q=ANNA');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.players, [{ uuid: anna.uuid, name: 'Anna_X', lastSeen: res.body.players[0].lastSeen, online: true, banned: false, role: null }]);
    // _ ist kein Platzhalter.
    assert.deepEqual((await asMod('GET', '/v1/team/players?q=Anna_')).body.players.length, 1);
    assert.deepEqual((await asMod('GET', '/v1/team/players?q=Ann_X')).body.players, []);
    const dashed = `${anna.uuid.slice(0, 8)}-${anna.uuid.slice(8, 12)}-${anna.uuid.slice(12, 16)}-${anna.uuid.slice(16, 20)}-${anna.uuid.slice(20)}`;
    assert.equal((await asMod('GET', `/v1/team/players?q=${dashed}`)).body.players[0].uuid, anna.uuid);
    assert.equal((await asMod('GET', '/v1/team/players?q=Chef')).body.players[0].role, 'admin');
    const banned = (await asMod('GET', '/v1/team/players?q=Stoer')).body.players;
    assert.deepEqual(banned.map((p: { name: string; banned: boolean; lastSeen: unknown }) => [p.name, p.banned, p.lastSeen]), [['Stoerer', true, null]]);
    assert.ok((await asMod('GET', '/v1/team/players')).body.players.length >= 4, 'ohne q: zuletzt gesehen');
    assert.equal((await asMod('GET', '/v1/team/players?q=kein%20name')).status, 400);

    res = await asMod('GET', `/v1/team/players/${anna.uuid}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), [
      'ban', 'blocks', 'cape', 'createdAt', 'friends', 'lastSeen', 'messages', 'name', 'online', 'presence', 'reportsAbout', 'reportsBy', 'role', 'showServer', 'uuid', 'visible',
    ]);
    assert.deepEqual([res.body.cape, res.body.friends, res.body.online, res.body.ban, res.body.role], ['glut', 1, true, null, null]);
    assert.equal(res.body.reportsBy.length, 1);
    assert.equal(res.body.reportsAbout.length, 1);
    assert.equal(JSON.stringify(res.body).includes('Geheimer-Text-42'), false, 'keine Nachrichteninhalte');
    const stoerer = (await asMod('GET', `/v1/team/players/${banned[0].uuid}`)).body;
    assert.deepEqual([stoerer.name, stoerer.ban.reason, stoerer.lastSeen], ['Stoerer', 'Spam im Chat', null]);
    assert.equal((await asMod('GET', `/v1/team/players/${randomUuid()}`)).status, 404);

    res = await asAdmin('POST', `/v1/team/players/${anna.uuid}/reset-cape`);
    assert.equal(res.status, 200);
    assert.equal(res.body.cape, '');
    assert.equal((await api(service.url, 'GET', '/v1/me', { token: anna.token })).body.cape, '');

    // Löschen wie DELETE /v1/me: Verbindung zu (4001), keine Sperre.
    res = await asAdmin('DELETE', `/v1/team/players/${anna.uuid}`);
    assert.deepEqual([res.status, res.body], [200, { deleted: true }]);
    assert.equal((await annaWs.client.closed).code, 4001);
    assert.equal((await asMod('GET', `/v1/team/players/${anna.uuid}`)).status, 404);
    assert.equal((await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Anna_X', uuid: anna.uuid } })).status, 200);
    // Der letzte Admin lässt sich nicht löschen.
    assert.deepEqual([(await asAdmin('DELETE', `/v1/team/players/${admin.uuid}`)).status], [409]);
  });

  test('Neuigkeiten: Entwürfe nur im Team, öffentlich nur veröffentlichte', async () => {
    const draft = await asMod('POST', '/v1/team/news', { title: '  Version 0.13  ', text: 'Neu:\r\n\r\n- Nachrichten\n- Melden', published: false });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.deepEqual(Object.keys(draft.body.news).sort(), ['at', 'author', 'id', 'published', 'text', 'title', 'updatedAt']);
    assert.deepEqual([draft.body.news.title, draft.body.news.text, draft.body.news.author, draft.body.news.published], [
      'Version 0.13',
      'Neu:\n\n- Nachrichten\n- Melden',
      'Moderator',
      false,
    ]);
    await sleep(5);
    const live = await asAdmin('POST', '/v1/team/news', { title: 'Wartung', text: 'Heute Abend kurz offline.', published: true });
    assert.equal(live.status, 200);
    for (const body of [
      { title: '', text: 'x' },
      { title: 'a\nb', text: 'x' },
      { title: 'x'.repeat(121), text: 'x' },
      { title: 'x', text: '' },
      { title: 'x', text: 'x'.repeat(5001) },
      { title: 'x', text: 'mit\tTab' },
      { title: 'x', text: 'x', published: 'ja' },
      { text: 'ohne Titel' },
    ]) {
      assert.equal((await asMod('POST', '/v1/team/news', body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await asMod('POST', '/v1/team/news', { title: 'x', text: 'y'.repeat(5000) })).status, 200);

    let pub = await api(service.url, 'GET', '/v1/news');
    assert.equal(pub.status, 200);
    assert.equal(pub.headers.get('cache-control'), 'max-age=60');
    assert.deepEqual(pub.body.news.map((n: { title: string }) => n.title), ['Wartung']);
    assert.deepEqual(Object.keys(pub.body.news[0]).sort(), ['at', 'author', 'id', 'text', 'title']);
    assert.equal(pub.body.news[0].author, 'Chefin');
    assert.equal((await asMod('GET', '/v1/team/news')).body.news.length, 3);

    // Veröffentlichen: Ab jetzt zählt dieses Datum, die Neuigkeit steht oben.
    await sleep(5);
    const published = await asMod('PUT', `/v1/team/news/${draft.body.news.id}`, { published: true });
    assert.equal(published.status, 200);
    assert.ok(published.body.news.at > live.body.news.at);
    assert.equal(published.body.news.title, 'Version 0.13', 'Rest bleibt');
    pub = await api(service.url, 'GET', '/v1/news?limit=1');
    assert.deepEqual(pub.body.news.map((n: { title: string }) => n.title), ['Version 0.13']);
    for (const q of ['?limit=0', '?limit=51', '?limit=x']) assert.equal((await api(service.url, 'GET', `/v1/news${q}`)).status, 400, q);
    assert.equal((await asMod('PUT', `/v1/team/news/${draft.body.news.id}`, { title: '' })).status, 400);
    assert.equal((await asMod('PUT', '/v1/team/news/999999', { published: true })).status, 404);

    const removed = await asMod('DELETE', `/v1/team/news/${live.body.news.id}`);
    assert.deepEqual([removed.status, removed.body], [200, { deleted: true }]);
    assert.equal((await asMod('DELETE', `/v1/team/news/${live.body.news.id}`)).status, 404);
    assert.deepEqual((await api(service.url, 'GET', '/v1/news')).body.news.map((n: { title: string }) => n.title), ['Version 0.13']);
  });

  test('Mitglieder: aufnehmen, Rolle, entfernen, 2FA zurücksetzen, letzter Admin bleibt', async () => {
    let res = await asAdmin('GET', '/v1/team/members');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.members.map((m: { name: string; role: string; twoFactor: boolean; addedBy: unknown }) => [m.name, m.role, m.twoFactor, m.addedBy]), [
      ['Chefin', 'admin', true, null],
      ['Moderator', 'moderator', true, null],
    ]);
    const carla = await devPlayer(service.url, 'Carla');
    assert.equal((await asAdmin('POST', '/v1/team/members', { name: 'GibtEsNicht', role: 'moderator' })).status, 404);
    assert.equal((await asAdmin('POST', '/v1/team/members', { name: 'Carla', role: 'chef' })).status, 400);
    res = await asAdmin('POST', '/v1/team/members', { name: 'carla', role: 'moderator' });
    assert.equal(res.status, 200);
    const added = res.body.members.find((m: { uuid: string }) => m.uuid === carla.uuid);
    assert.deepEqual(Object.keys(added).sort(), ['addedAt', 'addedBy', 'name', 'role', 'twoFactor', 'uuid']);
    assert.deepEqual([added.role, added.addedBy, added.twoFactor], ['moderator', 'Chefin', false]);
    res = await asAdmin('PUT', `/v1/team/members/${carla.uuid}`, { role: 'admin' });
    assert.equal(res.body.members.find((m: { uuid: string }) => m.uuid === carla.uuid).role, 'admin');
    assert.equal((await asAdmin('PUT', `/v1/team/members/${randomUuid()}`, { role: 'admin' })).status, 404);

    // 2FA zurücksetzen: Der Moderator muss neu einrichten.
    res = await asAdmin('POST', `/v1/team/members/${mod.uuid}/reset-2fa`);
    assert.equal(res.body.members.find((m: { uuid: string }) => m.uuid === mod.uuid).twoFactor, false);
    const gate = await asMod('GET', '/v1/team/news');
    assert.deepEqual([gate.status, gate.body.code], [403, '2fa_setup_required']);
    const setup = await asMod('POST', '/v1/web/2fa/setup');
    assert.equal((await asMod('POST', '/v1/web/2fa/enable', { code: codeFor(setup.body.secret, clock) })).status, 200);
    clock.step();

    // Letzter Admin: Chefin und Carla sind Admins. Carla entfernen geht, danach darf Chefin weder gehen noch absteigen.
    res = await asAdmin('DELETE', `/v1/team/members/${carla.uuid}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.members.some((m: { uuid: string }) => m.uuid === carla.uuid), false);
    assert.equal((await asAdmin('DELETE', `/v1/team/members/${carla.uuid}`)).status, 404);
    for (const [method, path, body] of [
      ['PUT', `/v1/team/members/${admin.uuid}`, { role: 'moderator' }],
      ['DELETE', `/v1/team/members/${admin.uuid}`, undefined],
      ['POST', '/v1/team/members', { uuid: admin.uuid, role: 'moderator' }],
    ] as const) {
      const guard = await asAdmin(method, path, body);
      assert.deepEqual([guard.status, guard.body.error], [409, 'Es muss mindestens ein Admin bleiben.'], `${method} ${path}`);
    }
  });

  test('Protokoll: jede Aktion, neueste zuerst, mit Handelndem; CLI als „CLI“', async () => {
    runAdmin(['team', 'Ben', 'moderator'], service.dataDir, quiet);
    runAdmin(['team-entfernen', 'Ben'], service.dataDir, quiet);
    const res = await asAdmin('GET', '/v1/team/audit?limit=500');
    assert.equal(res.status, 200);
    const entries = res.body.entries;
    assert.deepEqual(Object.keys(entries[0]).sort(), ['action', 'actor', 'at', 'detail', 'id', 'target']);
    assert.deepEqual([entries[0].action, entries[0].actor], ['team.remove', { uuid: null, name: 'CLI' }]);
    assert.ok(entries[0].id > entries[1].id, 'neueste zuerst');
    const actions = new Set(entries.map((e: { action: string }) => e.action));
    for (const action of [
      '2fa.enable',
      'report.done',
      'ban',
      'unban',
      'player.reset-cape',
      'player.delete',
      'news.create',
      'news.update',
      'news.delete',
      'team.add',
      'team.role',
      'team.remove',
      'team.reset-2fa',
    ]) {
      assert.ok(actions.has(action), `fehlt: ${action}`);
    }
    const ban = entries.find((e: { action: string; detail: string }) => e.action === 'ban' && e.detail === 'Spam im Chat');
    assert.deepEqual(ban.actor, { uuid: mod.uuid, name: 'Moderator' });
    assert.match(ban.target, /^Stoerer \([0-9a-f]{32}\)$/);
    assert.equal((await asAdmin('GET', '/v1/team/audit?limit=2')).body.entries.length, 2);
    for (const q of ['?limit=0', '?limit=501']) assert.equal((await asAdmin('GET', `/v1/team/audit${q}`)).status, 400);
  });
});

test('Protokoll: Einträge verfallen (im Test nach 150 ms)', async () => {
  const clock = new Clock();
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, auditTtlMs: 150, sweepIntervalMs: 40 });
  try {
    const admin = await devPlayer(service.url, 'Chefin');
    const { cookie } = await teamLogin(service, admin, 'admin', clock);
    assert.ok((await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries.length > 0);
    await waitFor(async () => (await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries.length === 0);
  } finally {
    await service.close();
  }
});

function totpAt(secret: string, timeMs: number): string {
  return codeFor(secret, new Clock(timeMs));
}
