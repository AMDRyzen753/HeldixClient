// Öffentliche Teamseite mit Teamprofilen, Skins über den Dienst, Neuigkeiten-Archiv und das Ziel im Einmal-Link.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runAdmin } from '../src/admin';
import { Skins } from '../src/skins';
import { api, devPlayer, rawRequest, sleep, startService, type Player, type TestService } from './helpers';
import { PNG, startFakeSkins, type FakeSkins } from './fake-skins';
import { addToTeam, Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

describe('Teamprofil und öffentliche Teamseite', () => {
  const clock = new Clock();
  let service: TestService;
  let admin: Player;
  let mod: Player;
  let adminCookie: string;
  let modCookie: string;

  before(async () => {
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    admin = await devPlayer(service.url, 'Zora');
    mod = await devPlayer(service.url, 'Anton');
    adminCookie = (await teamLogin(service, admin, 'admin', clock)).cookie;
    modCookie = (await teamLogin(service, mod, 'moderator', clock)).cookie;
  });
  after(() => service.close());

  test('Profil nur mit Team-Zugang; Standard: nicht öffentlich', async () => {
    const player = await devPlayer(service.url, 'Spieler');
    const { cookie } = await webLogin(service, player);
    let res = await webApi(service, 'GET', '/v1/team/me/profile', { cookie });
    assert.deepEqual([res.status, res.body.code], [403, 'forbidden']);
    addToTeam(service, player, 'moderator');
    res = await webApi(service, 'PUT', '/v1/team/me/profile', { cookie, body: { public: true } });
    assert.deepEqual([res.status, res.body.code], [403, '2fa_setup_required']);
    assert.equal((await api(service.url, 'GET', '/v1/team/me/profile', { token: player.token })).status, 401);

    res = await webApi(service, 'GET', '/v1/team/me/profile', { cookie: modCookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { public: false, title: '', about: '' });
    const pub = await api(service.url, 'GET', '/v1/public/team');
    assert.deepEqual(pub.body, { members: [] }, 'niemand ohne Zustimmung');
  });

  test('ändern, prüfen, öffentliche Liste (Admins zuerst, dann Name), Protokoll nur „öffentlich an/aus“', async () => {
    for (const body of [{ public: 'ja' }, { title: 'x'.repeat(41) }, { about: 'x'.repeat(201) }, { title: 'a\nb' }, { about: 42 }]) {
      assert.equal((await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: modCookie, body })).status, 400, JSON.stringify(body));
    }
    let res = await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: modCookie, body: { public: true, title: ' Moderation ', about: 'Ich helfe gern.' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { public: true, title: 'Moderation', about: 'Ich helfe gern.' });
    res = await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: modCookie, body: { about: '' } });
    assert.deepEqual(res.body, { public: true, title: 'Moderation', about: '' }, 'nur das Angegebene ändert sich');
    await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: adminCookie, body: { public: true, title: 'Entwicklung' } });

    const pub = await api(service.url, 'GET', '/v1/public/team');
    assert.equal(pub.status, 200);
    assert.equal(pub.headers.get('cache-control'), 'max-age=60');
    assert.equal(pub.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(
      pub.body.members.map((m: { name: string; role: string; title: string }) => [m.name, m.role, m.title]),
      [
        ['Zora', 'admin', 'Entwicklung'],
        ['Anton', 'moderator', 'Moderation'],
      ],
    );
    assert.deepEqual(Object.keys(pub.body.members[0]).sort(), ['about', 'name', 'role', 'since', 'title', 'uuid']);
    assert.equal(typeof pub.body.members[0].since, 'number');

    // Zustimmung zurücknehmen
    await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: modCookie, body: { public: false } });
    assert.deepEqual((await api(service.url, 'GET', '/v1/public/team')).body.members.map((m: { name: string }) => m.name), ['Zora']);
    const audit = (await webApi(service, 'GET', '/v1/team/audit', { cookie: adminCookie })).body.entries.filter(
      (e: { action: string }) => e.action === 'team.profile',
    );
    assert.deepEqual(audit.map((e: { detail: string; actor: { name: string } }) => [e.actor.name, e.detail]), [
      ['Anton', 'öffentlich aus'],
      ['Zora', 'öffentlich an'],
      ['Anton', 'öffentlich an'],
    ]);

    // Wer das Team verlässt, verliert das Profil; bei neuer Aufnahme ist es wieder privat.
    await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: modCookie, body: { public: true } });
    runAdmin(['team-entfernen', 'Anton'], service.dataDir, { out: () => {}, err: () => {} });
    assert.deepEqual((await api(service.url, 'GET', '/v1/public/team')).body.members.map((m: { name: string }) => m.name), ['Zora']);
    runAdmin(['team', 'Anton', 'moderator'], service.dataDir, { out: () => {}, err: () => {} });
    assert.deepEqual((await api(service.url, 'GET', '/v1/public/team')).body.members.length, 1);
  });
});

describe('Skins über den Dienst', () => {
  const clock = new Clock();
  let fake: FakeSkins;
  let service: TestService;
  let cookie: string;
  let member: Player;

  before(async () => {
    fake = await startFakeSkins();
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read, sessionServer: fake.url, skinHosts: ['127.0.0.1'] });
    member = await devPlayer(service.url, 'Skinny');
    cookie = (await teamLogin(service, member, 'moderator', clock)).cookie;
    await webApi(service, 'PUT', '/v1/team/me/profile', { cookie, body: { public: true } });
  });
  after(async () => {
    await service.close();
    await fake.close();
  });

  /** Neues öffentliches Team-Mitglied mit eigener Skin-Adresse (so greift der Zwischenspeicher nicht). */
  async function publicMember(name: string, skinUrl: string | undefined): Promise<Player> {
    const player = await devPlayer(service.url, name);
    const login = await teamLogin(service, player, 'moderator', clock);
    assert.equal((await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: login.cookie, body: { public: true } })).status, 200);
    if (skinUrl !== undefined) fake.skinUrls.set(player.uuid, skinUrl);
    return player;
  }

  const skin = (uuid: string) => rawRequest(service.url, 'GET', `/v1/public/skins/${uuid}`);

  test('öffentliches Mitglied: PNG mit Cache-Control und CORS; danach aus dem Zwischenspeicher', async () => {
    fake.skinUrls.set(member.uuid, `${fake.url}/texture/gut`);
    fake.files.set('/texture/gut', { body: PNG });
    const res = await skin(member.uuid);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['cache-control'], 'max-age=3600');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.deepEqual(res.body, PNG);
    const asked = fake.requests.length;
    assert.deepEqual((await skin(member.uuid)).body, PNG);
    assert.equal(fake.requests.length, asked, 'kein zweites Mal bei Mojang');
  });

  test('nicht öffentlich, kein Team, ungültige UUID, kein Skin: 404, ohne Mojang zu fragen', async () => {
    const privateMember = await devPlayer(service.url, 'Privat');
    addToTeam(service, privateMember, 'moderator');
    fake.skinUrls.set(privateMember.uuid, `${fake.url}/texture/gut`);
    const stranger = await devPlayer(service.url, 'Fremd');
    fake.skinUrls.set(stranger.uuid, `${fake.url}/texture/gut`);
    const asked = fake.requests.length;
    for (const uuid of [privateMember.uuid, stranger.uuid, 'NICHT-HEX', 'f'.repeat(32)]) {
      const res = await skin(uuid);
      assert.equal(res.status, 404, uuid);
      assert.equal(res.headers['access-control-allow-origin'], '*');
    }
    assert.equal(fake.requests.length, asked);
    // Öffentlich, aber Mojang kennt keinen Skin: 404.
    const noSkin = await publicMember('OhneSkin', undefined);
    assert.equal((await skin(noSkin.uuid)).status, 404);
  });

  test('Host nicht erlaubt, zu groß (mit und ohne Content-Length), kein PNG: 404', async () => {
    const elsewhere = await publicMember('Fremdhost', 'http://textures.boese.example/texture/x');
    const before = fake.requests.length;
    assert.equal((await skin(elsewhere.uuid)).status, 404);
    assert.deepEqual(fake.requests.slice(before), [`/session/minecraft/profile/${elsewhere.uuid}`], 'nur das Profil, kein Download');

    fake.files.set('/texture/gross', { body: Buffer.concat([PNG, Buffer.alloc(256 * 1024)]) });
    fake.files.set('/texture/gross-ohne-laenge', { body: Buffer.concat([PNG, Buffer.alloc(256 * 1024)]), chunked: true });
    fake.files.set('/texture/gif', { body: Buffer.from('GIF89a' + 'x'.repeat(100)) });
    for (const [name, path] of [
      ['Gross', '/texture/gross'],
      ['GrossOhne', '/texture/gross-ohne-laenge'],
      ['KeinPng', '/texture/gif'],
    ]) {
      const player = await publicMember(name!, `${fake.url}${path}`);
      assert.equal((await skin(player.uuid)).status, 404, name);
    }
    // Genau 256 KB gehen noch.
    fake.files.set('/texture/grenze', { body: Buffer.concat([PNG, Buffer.alloc(256 * 1024 - PNG.length)]) });
    const limit = await publicMember('Grenze', `${fake.url}/texture/grenze`);
    assert.equal((await skin(limit.uuid)).status, 200);
  });

  test('Skin-Adressen: nur erlaubte Hosts, sonst immer HTTPS auf dem Standard-Port', () => {
    const skins = new Skins({ sessionServer: 'https://sessionserver.mojang.com', hosts: ['textures.minecraft.net', '127.0.0.1'], timeoutMs: 1000 });
    assert.equal(skins.skinUrl('http://textures.minecraft.net/texture/abc'), 'https://textures.minecraft.net/texture/abc');
    assert.equal(skins.skinUrl('https://TEXTURES.minecraft.net/texture/abc'), 'https://textures.minecraft.net/texture/abc');
    assert.equal(skins.skinUrl('http://textures.minecraft.net:80/texture/abc'), 'https://textures.minecraft.net/texture/abc');
    assert.equal(skins.skinUrl('http://127.0.0.1:1234/texture/abc'), 'http://127.0.0.1:1234/texture/abc');
    for (const bad of [
      'http://textures.minecraft.net:8080/texture/abc',
      'http://evil.example/texture/abc',
      'http://textures.minecraft.net.evil.example/x',
      'http://user:pw@textures.minecraft.net/x',
      'ftp://textures.minecraft.net/x',
      'file:///etc/passwd',
      'kaputt',
      42,
    ]) {
      assert.equal(skins.skinUrl(bad), null, String(bad));
    }
  });
});

describe('Neuigkeiten-Archiv', () => {
  test('limit (1–50), before, more; ein später veröffentlichter Entwurf steht vorn', async () => {
    const clock = new Clock();
    const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    try {
      const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
      const draft = await webApi(service, 'POST', '/v1/team/news', { cookie, body: { title: 'Entwurf', text: 'x', published: false } });
      for (let i = 1; i <= 5; i++) {
        await webApi(service, 'POST', '/v1/team/news', { cookie, body: { title: `N${i}`, text: 'x', published: true } });
        await sleep(3);
      }
      await webApi(service, 'PUT', `/v1/team/news/${draft.body.news.id}`, { cookie, body: { published: true } });

      let res = await api(service.url, 'GET', '/v1/news?limit=2');
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual([res.body.news.map((n: { title: string }) => n.title), res.body.more], [['Entwurf', 'N5'], true]);
      res = await api(service.url, 'GET', `/v1/news?limit=2&before=${res.body.news[1].id}`);
      assert.deepEqual([res.body.news.map((n: { title: string }) => n.title), res.body.more], [['N4', 'N3'], true]);
      res = await api(service.url, 'GET', `/v1/news?limit=2&before=${res.body.news[1].id}`);
      assert.deepEqual([res.body.news.map((n: { title: string }) => n.title), res.body.more], [['N2', 'N1'], false]);
      res = await api(service.url, 'GET', '/v1/news');
      assert.deepEqual([res.body.news.length, res.body.more], [6, false]);
      assert.equal((await api(service.url, 'GET', '/v1/news?limit=50')).status, 200);
      for (const q of ['?limit=51', '?before=0', '?before=x']) assert.equal((await api(service.url, 'GET', `/v1/news${q}`)).status, 400, q);
    } finally {
      await service.close();
    }
  });
});

describe('Einmal-Link mit Ziel', () => {
  test('target: erlaubte Werte hängen &ziel= an, andere 400; ohne Körper wie bisher', async () => {
    const service = await startService({ dev: true, website: WEBSITE });
    try {
      const player = await devPlayer(service.url, 'Anna');
      for (const target of ['profil', 'freunde', 'nachrichten', 'privatsphaere', 'daten', 'support', 'team']) {
        const res = await api(service.url, 'POST', '/v1/web/link', { token: player.token, body: { target } });
        assert.equal(res.status, 200, target);
        assert.match(res.body.url, new RegExp(`^https://heldix\\.example/konto#code=[A-Za-z0-9_-]{43}&ziel=${target}$`));
      }
      for (const target of ['admin', 'Profil', '', 42, ['team']]) {
        const res = await api(service.url, 'POST', '/v1/web/link', { token: player.token, body: { target } });
        assert.equal(res.status, 400, JSON.stringify(target));
        assert.equal(typeof res.body.error, 'string');
      }
      // Wie der Launcher: Content-Type JSON ohne Körper; und mit target: null.
      const bare = await api(service.url, 'POST', '/v1/web/link', { token: player.token, headers: { 'Content-Type': 'application/json' } });
      assert.match(bare.body.url, /#code=[A-Za-z0-9_-]{43}$/);
      assert.match((await api(service.url, 'POST', '/v1/web/link', { token: player.token, body: { target: null } })).body.url, /#code=[^&]+$/);
      // Der Code aus dem Link mit Ziel funktioniert wie jeder andere.
      const linked = await api(service.url, 'POST', '/v1/web/link', { token: player.token, body: { target: 'support' } });
      const code = /#code=([^&]+)&/.exec(linked.body.url)![1];
      assert.equal((await api(service.url, 'POST', '/v1/web/session', { body: { code } })).status, 200);
    } finally {
      await service.close();
    }
  });
});
