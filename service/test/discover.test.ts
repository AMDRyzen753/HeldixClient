// Entdecken (1.13.0): Einträge listen (nur offen, Regeln, Wortfilter, Tags, Sprache), öffentliche Liste (geteilte Welten
// nur geöffnet, dauerhafte immer), Sortierung, Filter, Suche, Gefällt mir, Melden, Team (ausblenden, sperren, Meldungen),
// Symbol, Datenauskunft und Löschen; dazu der Wortfilter.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkWords } from '../src/wordfilter';
import { api, connect, devPlayer, type Player } from './helpers';
import { hostedWorld, startHosting, uploadZip, waitState, grantBeta, type HostingTest } from './hosting-helpers';
import { teamLogin, webApi } from './web-helpers';
import { createWorld, hostConnect, openWorld as openTunnel } from './world-helpers';
import { buildZip, entry } from './zip-builder';
import { encodePng } from '../src/heads';

async function withDiscover(fn: (t: HostingTest) => Promise<void>, options = {}): Promise<void> {
  const t = await startHosting(options);
  try {
    await fn(t);
  } finally {
    await t.close();
  }
}

const LISTING = { listed: true, description: 'Gemütliche Survival-Welt', tags: ['survival', 'entspannt'], lang: 'de', rulesAccepted: true };

async function list(t: HostingTest, query = ''): Promise<any> {
  const res = await api(t.service.url, 'GET', `/v1/public/discover${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

/** Dauerhafte, offene, gelistete Welt. */
async function listedHosted(t: HostingTest, name: string, worldName: string, listing: Record<string, unknown> = {}): Promise<{ player: Player; world: any }> {
  const { player, world } = await hostedWorld(t, name, { name: worldName });
  await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: player.token, body: { access: 'open' } });
  const res = await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/listing`, { token: player.token, body: { ...LISTING, ...listing } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { player, world };
}

describe('Entdecken: Einträge', () => {
  test('Listen nur mit Zugang „offen“, Regeln bestätigt, Beschreibung ≤ 160, höchstens 3 Tags aus der Liste, Sprache de/en', async () => {
    await withDiscover(async (t) => {
      const anna = await devPlayer(t.service.url, 'Anna');
      const world = await createWorld(t.service, anna, { name: 'Insel' });
      const put = (body: unknown) => api(t.service.url, 'PUT', `/v1/worlds/${world.id}/listing`, { token: anna.token, body });
      let res = await put(LISTING);
      assert.deepEqual([res.status, res.body.code], [409, 'access']);
      await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { access: 'open' } });
      assert.deepEqual((await put({ ...LISTING, rulesAccepted: false })).body.code, 'rules');
      assert.equal((await put({ ...LISTING, description: 'x'.repeat(161) })).status, 400);
      assert.equal((await put({ ...LISTING, description: 'zwei\nZeilen' })).status, 400);
      assert.equal((await put({ ...LISTING, tags: ['survival', 'bauen', 'technik', 'parkour'] })).status, 400);
      assert.equal((await put({ ...LISTING, tags: ['pvp'] })).status, 400);
      assert.equal((await put({ ...LISTING, lang: 'fr' })).status, 400);
      assert.equal((await put({ ...LISTING, description: 'Komm auf unseren Server: mc.beispiel.de' })).body.code, 'words-link');
      assert.equal((await put({ ...LISTING, description: 'Discord: discord.gg/abc' })).body.code, 'words-link');
      assert.equal((await put({ ...LISTING, description: 'nur für H u r e n s o h n e' })).body.code, 'words-word');
      res = await put({ ...LISTING, tags: ['survival', 'survival', 'bauen'] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.listed, res.body.tags, res.body.lang, res.body.problem, res.body.rules.length], [true, ['survival', 'bauen'], 'de', null, 3]);
      const own = await api(t.service.url, 'GET', `/v1/worlds/${world.id}/listing`, { token: anna.token });
      assert.equal(own.body.description, 'Gemütliche Survival-Welt');
      // Fremde Welt: 404
      const ben = await devPlayer(t.service.url, 'Ben');
      assert.equal((await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/listing`, { token: ben.token, body: LISTING })).status, 404);
      // Zugang wieder geschlossen: Problem „access“, nicht mehr im Verzeichnis
      await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { access: 'friends' } });
      assert.equal((await api(t.service.url, 'GET', `/v1/worlds/${world.id}/listing`, { token: anna.token })).body.problem, 'access');
      assert.deepEqual((await api(t.service.url, 'DELETE', `/v1/worlds/${world.id}/listing`, { token: anna.token })).body, { ok: true });
      assert.equal((await api(t.service.url, 'GET', `/v1/worlds/${world.id}/listing`, { token: anna.token })).body.listed, false);
    });
  });

  test('Öffentliche Liste: geteilte Welten nur, solange geöffnet; dauerhafte immer (schlafend); CORS; Meta', async () => {
    await withDiscover(async (t) => {
      const anna = await devPlayer(t.service.url, 'Anna');
      const shared = await createWorld(t.service, anna, { name: 'Tunnelwelt', access: 'open' });
      await api(t.service.url, 'PUT', `/v1/worlds/${shared.id}/listing`, { token: anna.token, body: { ...LISTING, lang: 'en' } });
      assert.equal((await list(t)).total, 0, 'geschlossene geteilte Welt fehlt');
      const host = await hostConnect(t.service, anna.token);
      await openTunnel(host, shared.id);
      let body = await list(t);
      assert.deepEqual(body.entries.map((e: { name: string; state: string; persistent: boolean }) => [e.name, e.state, e.persistent]), [['Tunnelwelt', 'online', false]]);
      const e = body.entries[0];
      assert.deepEqual([e.players, e.maxPlayers, e.version, e.lang, e.host.name, e.host.head, e.address], [1, 8, '26.3', 'en', 'Anna', `/v1/public/heads/${anna.uuid}.png`, shared.address]);
      await host.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal((await list(t)).total, 0);
      // dauerhafte Welt: auch schlafend
      const { world } = await listedHosted(t, 'Bea', 'Dauerwelt');
      body = await list(t);
      assert.deepEqual(body.entries.map((x: { name: string; state: string; persistent: boolean }) => [x.name, x.state, x.persistent]), [['Dauerwelt', 'sleeping', true]]);
      const res = await api(t.service.url, 'GET', `/v1/public/discover/${world.code}`);
      assert.deepEqual([res.status, res.headers.get('access-control-allow-origin'), res.body.name, res.body.likes], [200, '*', 'Dauerwelt', 0]);
      assert.equal((await api(t.service.url, 'GET', '/v1/public/discover/zzzzzz')).status, 404);
      assert.equal((await api(t.service.url, 'GET', '/v1/public/discover/..')).status, 404);
      const meta = await api(t.service.url, 'GET', '/v1/public/discover/meta');
      assert.deepEqual(meta.body.tags.map((tag: { id: string }) => tag.id), ['survival', 'kreativ', 'minispiele', 'rollenspiel', 'bauen', 'parkour', 'technik', 'entspannt', 'hardcore']);
      assert.deepEqual([meta.body.langs, meta.body.sorts, meta.body.descriptionMax], [['de', 'en'], ['popular', 'new', 'active'], 160]);
      for (const bad of ['?sort=best', '?tag=pvp', '?lang=fr', '?page=0', '?version=../x', `?q=${'x'.repeat(65)}`]) {
        assert.equal((await api(t.service.url, 'GET', `/v1/public/discover${bad}`)).status, 400, bad);
      }
    });
  });

  test('Sortierung (beliebt, neu, gerade aktiv), Filter (Tag, Sprache, Version), Suche, Seiten', async () => {
    await withDiscover(async (t) => {
      const a = await listedHosted(t, 'Anna', 'Alpha Burg', { tags: ['bauen'], description: 'Große Burgen' });
      const b = await listedHosted(t, 'Bea', 'Beta Park', { tags: ['parkour'], lang: 'en', description: 'Jump and run' });
      const c = await listedHosted(t, 'Carl', 'Gamma Farm', { tags: ['technik', 'survival'], description: 'Redstone' });
      // Gefällt mir: Beta 2, Gamma 1
      for (const name of ['Fan1', 'Fan2']) {
        const fan = await devPlayer(t.service.url, name);
        assert.equal((await api(t.service.url, 'PUT', `/v1/discover/${b.world.code}/like`, { token: fan.token })).body.likes, name === 'Fan1' ? 1 : 2);
      }
      const fan3 = await devPlayer(t.service.url, 'Fan3');
      await api(t.service.url, 'PUT', `/v1/discover/${c.world.code}/like`, { token: fan3.token });
      const names = (body: any) => body.entries.map((e: { name: string }) => e.name);
      assert.deepEqual(names(await list(t, '?sort=popular')), ['Beta Park', 'Gamma Farm', 'Alpha Burg']);
      assert.deepEqual(names(await list(t, '?sort=new')), ['Gamma Farm', 'Beta Park', 'Alpha Burg']);
      // Spieler online gehen bei „beliebt“ und „aktiv“ vor
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${a.world.id}/start`, { token: a.player.token });
      await waitState(t.service, a.player, a.world.id, 'running');
      t.runner.join(a.world.id, 'Steve');
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(names(await list(t, '?sort=popular')), ['Alpha Burg', 'Beta Park', 'Gamma Farm']);
      assert.equal((await list(t, '?sort=active')).entries[0].name, 'Alpha Burg');
      assert.equal((await list(t, '?sort=active')).entries[0].state, 'running');
      assert.deepEqual(names(await list(t, '?tag=parkour')), ['Beta Park']);
      assert.deepEqual(names(await list(t, '?lang=en')), ['Beta Park']);
      assert.deepEqual(names(await list(t, '?version=26.3')).length, 3);
      assert.deepEqual(names(await list(t, '?version=1.8')), []);
      assert.deepEqual(names(await list(t, '?q=redstone')), ['Gamma Farm']);
      assert.deepEqual(names(await list(t, '?q=BURG')), ['Alpha Burg']);
      const page2 = await list(t, '?page=2');
      assert.deepEqual([page2.page, page2.pages, page2.total, page2.entries], [2, 1, 3, []]);
    });
  });

  test('Gefällt mir: eins je Spieler, nicht die eigene Welt, Zahl öffentlich; Melden mit Grund, einmal je Eintrag', async () => {
    await withDiscover(async (t) => {
      const { player, world } = await listedHosted(t, 'Anna', 'Insel');
      const ben = await devPlayer(t.service.url, 'Ben');
      const url = `/v1/discover/${world.code}/like`;
      assert.deepEqual((await api(t.service.url, 'GET', url, { token: ben.token })).body, { liked: false, likes: 0 });
      assert.deepEqual((await api(t.service.url, 'PUT', url, { token: ben.token })).body, { liked: true, likes: 1 });
      assert.deepEqual((await api(t.service.url, 'PUT', url, { token: ben.token })).body, { liked: true, likes: 1 });
      assert.equal((await api(t.service.url, 'PUT', url, { token: player.token })).status, 409);
      assert.equal((await api(t.service.url, 'PUT', url)).status, 401);
      assert.equal((await list(t)).entries[0].likes, 1);
      assert.deepEqual((await api(t.service.url, 'DELETE', url, { token: ben.token })).body, { liked: false, likes: 0 });
      const report = (body: unknown, token = ben.token) => api(t.service.url, 'POST', `/v1/discover/${world.code}/report`, { token, body });
      assert.equal((await report({ reason: 'langweilig' })).status, 400);
      assert.equal((await report({ reason: 'other', note: 'x'.repeat(301) })).status, 400);
      assert.equal((await report({ reason: 'advertising' }, player.token)).status, 400);
      assert.deepEqual((await report({ reason: 'advertising', note: 'Wirbt für einen anderen Server' })).body, { reported: true });
      assert.equal((await report({ reason: 'spam' })).status, 429);
      assert.ok(t.service.logs.some((l) => /Neue Meldung zu einem Eintrag in Entdecken \(#\d+, Grund: advertising\)/.test(l)));
      assert.ok(!t.service.logs.some((l) => l.includes('Ben') || l.includes('Insel')), 'keine Namen im Log');
    });
  });

  test('Team: Übersicht mit Meldungen (discover:moderate), ausblenden, Besitzer sperren, erledigen; Protokoll', async () => {
    await withDiscover(async (t) => {
      const { player, world } = await listedHosted(t, 'Anna', 'Insel');
      const ben = await devPlayer(t.service.url, 'Ben');
      await api(t.service.url, 'POST', `/v1/discover/${world.code}/report`, { token: ben.token, body: { reason: 'inappropriate' } });
      const sup = await teamLogin(t.service, await devPlayer(t.service.url, 'Supporterin'), 'supporter', t.clock);
      const tester = await teamLogin(t.service, await devPlayer(t.service.url, 'Testerin'), 'tester', t.clock);
      assert.equal((await webApi(t.service, 'GET', '/v1/team/discover', { cookie: tester.cookie })).status, 403);
      let res = await webApi(t.service, 'GET', '/v1/team/discover', { cookie: sup.cookie });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.listings[0].code, res.body.listings[0].openReports, res.body.reports[0].reason, res.body.reports[0].reporter.name], [world.code, 1, 'inappropriate', 'Ben']);
      const reportId = res.body.reports[0].id;
      // ausblenden
      assert.deepEqual((await webApi(t.service, 'PATCH', `/v1/team/discover/${world.code}`, { cookie: sup.cookie, body: { hidden: true } })).body, { ok: true, hidden: true });
      assert.equal((await list(t)).total, 0);
      assert.equal((await api(t.service.url, 'GET', `/v1/worlds/${world.id}/listing`, { token: player.token })).body.problem, 'hidden');
      await webApi(t.service, 'PATCH', `/v1/team/discover/${world.code}`, { cookie: sup.cookie, body: { hidden: false } });
      assert.equal((await list(t)).total, 1);
      // Besitzer sperren: Einträge weg, neu listen geht nicht
      res = await webApi(t.service, 'PUT', `/v1/team/discover/bans/${player.uuid}`, { cookie: sup.cookie, body: { reason: 'Werbung' } });
      assert.deepEqual(res.body.bans.map((b: { name: string; reason: string }) => [b.name, b.reason]), [['Anna', 'Werbung']]);
      assert.equal((await list(t)).total, 0);
      const again = await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/listing`, { token: player.token, body: LISTING });
      assert.deepEqual([again.status, again.body.code], [403, 'banned']);
      await webApi(t.service, 'DELETE', `/v1/team/discover/bans/${player.uuid}`, { cookie: sup.cookie });
      assert.equal((await list(t)).total, 1);
      assert.equal((await webApi(t.service, 'DELETE', `/v1/team/discover/bans/${player.uuid}`, { cookie: sup.cookie })).status, 404);
      // erledigen
      assert.deepEqual((await webApi(t.service, 'POST', `/v1/team/discover/reports/${reportId}/done`, { cookie: sup.cookie })).body, { ok: true });
      res = await webApi(t.service, 'GET', '/v1/team/discover?status=done', { cookie: sup.cookie });
      assert.deepEqual([res.body.reports[0].status, res.body.reports[0].doneBy], ['done', 'Supporterin']);
      assert.equal((await webApi(t.service, 'GET', '/v1/team/discover?status=offen', { cookie: sup.cookie })).status, 400);
      const admin = await teamLogin(t.service, await devPlayer(t.service.url, 'Chefin'), 'admin', t.clock);
      const audit = await webApi(t.service, 'GET', '/v1/team/audit', { cookie: admin.cookie });
      const actions = audit.body.entries.map((e: { action: string }) => e.action);
      for (const action of ['discover.hide', 'discover.show', 'discover.ban', 'discover.unban', 'discover.report-done']) assert.ok(actions.includes(action), action);
    });
  });

  test('Symbol einer dauerhaften Welt (aus icon.png, mit Plakette) und Datenauskunft/Löschen', async () => {
    await withDiscover(
      async (t) => {
        const anna = await devPlayer(t.service.url, 'Anna');
        grantBeta(t.service, anna.uuid);
        const shared = await createWorld(t.service, anna, { name: 'Bildwelt', access: 'open' });
        await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: shared.id } });
        const icon = encodePng({ width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4, 120) });
        const finish = await uploadZip(t, anna, shared.id, buildZip([entry('level.dat', 'L'), entry('icon.png', icon, 0)]));
        assert.equal(finish.status, 200, JSON.stringify(finish.body));
        await api(t.service.url, 'PUT', `/v1/worlds/${shared.id}/listing`, { token: anna.token, body: LISTING });
        const entryView = (await list(t)).entries[0];
        assert.equal(entryView.icon, `/v1/public/discover/${shared.code}/icon.png`);
        const res = await fetch(`${t.service.url}${entryView.icon}`);
        assert.deepEqual([res.status, res.headers.get('content-type')], [200, 'image/png']);
        assert.equal(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
        // Like und Meldung von Ben, dann löscht Ben sein Konto
        const ben = await devPlayer(t.service.url, 'Ben');
        await api(t.service.url, 'PUT', `/v1/discover/${shared.code}/like`, { token: ben.token });
        await api(t.service.url, 'POST', `/v1/discover/${shared.code}/report`, { token: ben.token, body: { reason: 'spam' } });
        const exported = (await (await fetch(`${t.service.url}/v1/me/export`, { headers: { Authorization: `Bearer ${ben.token}` } })).json()) as any;
        assert.deepEqual([exported.discover.likes.length, exported.discover.reports[0].reason, exported.discover.bannedFromDirectory], [1, 'spam', null]);
        const own = (await (await fetch(`${t.service.url}/v1/me/export`, { headers: { Authorization: `Bearer ${anna.token}` } })).json()) as any;
        assert.deepEqual([own.discover.listings[0].code, own.discover.listings[0].likes], [shared.code, 1]);
        await api(t.service.url, 'DELETE', '/v1/me', { token: ben.token });
        assert.equal((await list(t)).entries[0].likes, 0);
        // Besitzer löscht sein Konto: Eintrag weg
        const { client } = await connect(t.service.wsUrl, anna.token);
        await api(t.service.url, 'DELETE', '/v1/me', { token: anna.token });
        await client.closed;
        assert.equal((await list(t)).total, 0);
      },
      { hostingUploadChunkBytes: 1024 },
    );
  });
});

describe('Wortfilter', () => {
  test('grobe Wörter (auch verschleiert), Links; harmlose Wörter bleiben', () => {
    for (const bad of ['Hurensohn', 'h u r e n s o h n', 'HURENSÖHNE', 'Wichser!', 'fuuuuck', 'nur für 5p4st1s', 'Spast', 'Heil Hitler', 'www.server.de', 'https://x.y', 'discord.gg/abc', 'unser-server.net']) {
      assert.notEqual(checkWords(bad), null, bad);
    }
    for (const good of ['Gemütliche Survival-Welt', 'Nutella-Fabrik', 'Mongolei-Abenteuer', 'Fagott-Orchester', 'Schlamperei verboten', 'Version 1.21.4', 'Bauen, Technik und Spaß', 'Hardcore ohne Gnade', 'Klassische Musik']) {
      assert.equal(checkWords(good), null, good);
    }
  });
});
