// Dauerhafte Welten (1.13.0): Zugang und Grenzen, Anlegen (neu und per Upload), Lebenszyklus mit dem FakeRunner,
// server.properties, Konsole, Plugins (Modrinth über Fake-API), Plugin-Dateien, Sicherungen, Download, Team-Bereich,
// Freischaltungen, Echtzeit (hosting-state, hosting-log, hosting-granted), Freunde und Mitglieder (GET /v1/worlds),
// Entwicklungs-Route zum Freischalten, Datenauskunft und Löschen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { Store } from '../src/db';
import { FakeRunner } from './fake-runner';
import { api, befriend, connect, devPlayer, startService, type Player } from './helpers';
import { grantBeta, hostedWorld, modrinthVersion, PAPER_SHA, putRaw, setTeam, startHosting, uploadZip, waitFor, waitState, type HostingTest } from './hosting-helpers';
import { teamLogin, webApi } from './web-helpers';
import { buildZip, entry } from './zip-builder';
import { createWorld, DOMAIN, hostConnect, PROTOCOL } from './world-helpers';

async function withHosting(fn: (t: HostingTest) => Promise<void>, options = {}, runner?: FakeRunner): Promise<void> {
  const t = await startHosting(options, runner);
  try {
    await fn(t);
  } finally {
    await t.close();
  }
}

function worldZip(root = 'Insel/'): Buffer {
  return buildZip([entry(`${root}level.dat`, 'LEVEL'), entry(`${root}region/r.0.0.mca`, Buffer.alloc(5000, 7), 0), entry(`${root}data/raids.dat`, 'R')]);
}

describe('Dauerhafte Welten: Zugang und Grenzen', () => {
  test('ohne Runner: GET /v1/hosting sagt „aus“, alles andere 503', async () => {
    const service = await startService({ dev: true, weltDomain: DOMAIN });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const res = await api(service.url, 'GET', '/v1/hosting', { token: anna.token });
      assert.deepEqual(res.body, { allowed: false, reason: 'off', team: false, limits: null, worlds: [], operated: [] });
      const create = await api(service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: null, name: 'X' } });
      assert.equal(create.status, 503);
      assert.match(create.body.error, /nicht eingerichtet/);
      assert.equal((await api(service.url, 'GET', '/v1/hosting/plugins/search?q=x', { token: anna.token })).status, 503);
      assert.equal((await api(service.url, 'GET', '/v1/status')).body.hosted, null);
    } finally {
      await service.close();
    }
  });

  test('ohne Welt teilen bleibt Hosting aus (Warnung), auch mit Runner', async () => {
    const service = await startService({ dev: true, hostingRunner: new FakeRunner() });
    try {
      assert.ok(service.logs.some((l) => l.includes('Dauerhafte Welten brauchen Welt teilen')));
      const anna = await devPlayer(service.url, 'Anna');
      assert.equal((await api(service.url, 'GET', '/v1/hosting', { token: anna.token })).body.reason, 'off');
    } finally {
      await service.close();
    }
  });

  test('ohne Freischaltung: Hinweis auf die Beta; mit Freischaltung 1 Welt, Team (jede Rolle) 2 Welten', async () => {
    await withHosting(async (t) => {
      const anna = await devPlayer(t.service.url, 'Anna');
      let res = await api(t.service.url, 'GET', '/v1/hosting', { token: anna.token });
      assert.deepEqual([res.body.allowed, res.body.reason, res.body.team, res.body.limits.worlds], [false, 'beta', false, 1]);
      res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: null, name: 'Insel' } });
      assert.deepEqual([res.status, res.body.code], [403, 'beta']);
      assert.match(res.body.error, /Beta – bald mit Heldix\+/);

      grantBeta(t.service, anna.uuid);
      res = await api(t.service.url, 'GET', '/v1/hosting', { token: anna.token });
      assert.deepEqual([res.body.allowed, res.body.reason, res.body.limits.worlds, res.body.limits.diskMb, res.body.limits.memoryMb, res.body.limits.maxPlugins], [true, null, 1, 6144, 3072, 30]);
      assert.deepEqual(res.body.limits.sleepAfterMin, { min: 5, max: 60, default: 10 });
      assert.deepEqual(res.body.limits.upload, { chunkBytes: 8 * 1024 * 1024, maxBytes: 2 * 1024 ** 3 });
      assert.equal(res.body.limits.eula, 'https://www.minecraft.net/eula');
      res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: null, name: 'Insel' } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: null, name: 'Zweite' } });
      assert.deepEqual([res.status, res.body.code], [409, 'limit']);

      const tom = await devPlayer(t.service.url, 'Tom');
      setTeam(t.service, tom.uuid, 'tester');
      res = await api(t.service.url, 'GET', '/v1/hosting', { token: tom.token });
      assert.deepEqual([res.body.allowed, res.body.team, res.body.limits.worlds], [true, true, 2]);
      for (const name of ['Eins', 'Zwei']) assert.equal((await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: tom.token, body: { world: null, name } })).status, 200);
      res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: tom.token, body: { world: null, name: 'Drei' } });
      assert.deepEqual([res.status, res.body.code], [409, 'limit']);
    });
  });

  test('Eingaben beim Anlegen: Name, Seed, Typ, Spielmodus, Schwierigkeit, Version; fremde Welt 404', async () => {
    await withHosting(async (t) => {
      const anna = await devPlayer(t.service.url, 'Anna');
      grantBeta(t.service, anna.uuid);
      const post = (body: unknown) => api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body });
      assert.equal((await post({ world: null, name: '' })).status, 400);
      assert.equal((await post({ world: null, type: 'amplified' })).status, 400);
      assert.equal((await post({ world: null, gameMode: 'god' })).status, 400);
      assert.equal((await post({ world: null, difficulty: 'extreme' })).status, 400);
      assert.equal((await post({ world: null, seed: 'x'.repeat(65) })).status, 400);
      assert.equal((await post({ world: null, version: '../26.3' })).status, 400);
      const nobody = await post({ world: null, version: '0.1' });
      assert.deepEqual([nobody.status, nobody.body.error], [400, 'Für Minecraft 0.1 gibt es keinen Server (weder Paper noch Vanilla).']);
      const ben = await devPlayer(t.service.url, 'Ben');
      const foreign = await createWorld(t.service, ben, { name: 'Bens Welt' });
      assert.equal((await post({ world: foreign.id })).status, 404);
      const res = await post({ world: null, name: 'Flachland', seed: 1234, type: 'flat', gameMode: 'creative', difficulty: 'peaceful' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.state, res.body.software, res.body.version, res.body.paperBuild, res.body.awaitingUpload], ['creating', 'paper', '26.3', 263, false]);
      const world = await waitState(t.service, anna, res.body.id, 'sleeping');
      assert.deepEqual([world.name, world.address, world.role, world.owner.name], ['Flachland', `${world.code}.${DOMAIN}`, 'owner', 'Anna']);
      const prepared = t.runner.get(world.id).prepared!;
      assert.equal(prepared.jar.url, `https://fill-data.papermc.io/v1/objects/${PAPER_SHA}/paper-26.3-263.jar`);
      assert.equal(prepared.jar.sha256, PAPER_SHA);
      assert.equal(prepared.memoryMb, 3072);
      assert.deepEqual(
        [prepared.properties['level-seed'], prepared.properties['level-type'], prepared.properties.gamemode, prepared.properties.difficulty, prepared.properties['max-players']],
        ['1234', 'minecraft:flat', 'creative', 'peaceful', '8'],
      );
      // Werbe-MOTD wie bei Welt teilen
      assert.equal(prepared.motd, '§7Flachland\n§3Geteilt mit §bHeldixClient §8· §7heldix.example');
      assert.ok(prepared.iconPng && prepared.iconPng.subarray(1, 4).toString() === 'PNG');
      // Die neue Welt ist auch eine geteilte Welt mit derselben ID
      const shared = await api(t.service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token });
      assert.deepEqual([shared.body.name, shared.body.hosted, shared.body.online], ['Flachland', { state: 'sleeping' }, false]);
      // User-Agent an die Fill-API
      assert.ok(t.apis.requests.some((r) => r.path.startsWith('/v3/projects/paper') && /^heldix-dienst\/1\.14\.0 \(heldix\.example\)$/.test(r.userAgent)));
    });
  });

  test('Paper-Auswahl: nur STABLE (neuester stabiler Build), sonst Vanilla von Mojang (ohne Plugins)', async () => {
    await withHosting(async (t) => {
      const tom = await devPlayer(t.service.url, 'Tom');
      setTeam(t.service, tom.uuid, 'admin');
      let res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: tom.token, body: { world: null, name: 'Alt', version: '1.21.4' } });
      assert.deepEqual([res.body.software, res.body.paperBuild], ['paper', 120]);
      res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: tom.token, body: { world: null, name: 'Fremd', version: '9.9' } });
      assert.deepEqual([res.status, res.body.software, res.body.paperBuild], [200, 'vanilla', null]);
      assert.match(res.body.notice, /Vanilla/);
      const jar = t.runner.ops('prepare').map((o) => (o as { jar: { software: string; url: string; sha1?: string } }).jar).find((j) => j.software === 'vanilla');
      assert.ok(jar?.url.startsWith('https://piston-data.mojang.com/'));
      await waitState(t.service, tom, res.body.id, 'sleeping');
      const plugin = await api(t.service.url, 'POST', `/v1/hosting/worlds/${res.body.id}/plugins`, { token: tom.token, body: { project: 'luckperms' } });
      assert.deepEqual([plugin.status, plugin.body.code], [409, 'vanilla']);
    });
  });

  test('gleichzeitige Welten: Grenze (FIFO, „alle Plätze belegt“), Status zählt laufende', async () => {
    await withHosting(
      async (t) => {
        const tom = await devPlayer(t.service.url, 'Tom');
        setTeam(t.service, tom.uuid, 'admin');
        const ids: string[] = [];
        for (const name of ['Eins', 'Zwei']) {
          const res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: tom.token, body: { world: null, name } });
          ids.push(res.body.id);
          await waitState(t.service, tom, res.body.id, 'sleeping');
        }
        let res = await api(t.service.url, 'POST', `/v1/hosting/worlds/${ids[0]}/start`, { token: tom.token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        await waitState(t.service, tom, ids[0]!, 'running');
        res = await api(t.service.url, 'POST', `/v1/hosting/worlds/${ids[1]}/start`, { token: tom.token });
        assert.deepEqual([res.status, res.body.error], [503, 'Gerade sind alle Plätze belegt – versuch es in ein paar Minuten noch einmal.']);
        const overview = await api(t.service.url, 'GET', '/v1/hosting', { token: tom.token });
        assert.deepEqual(overview.body.limits.slots, { max: 1, used: 1 });
        assert.equal((await api(t.service.url, 'GET', '/v1/status')).body.hosted, 1);
        assert.equal((await api(t.service.url, 'POST', `/v1/hosting/worlds/${ids[0]}/stop`, { token: tom.token })).status, 200);
        await waitState(t.service, tom, ids[0]!, 'sleeping');
        assert.equal((await api(t.service.url, 'GET', '/v1/status')).body.hosted, 0);
        assert.equal((await api(t.service.url, 'POST', `/v1/hosting/worlds/${ids[1]}/start`, { token: tom.token })).status, 200);
        await waitState(t.service, tom, ids[1]!, 'running');
      },
      { hostingMax: 1 },
    );
  });
});

describe('Dauerhafte Welten: Lebenszyklus, Konsole, Einstellungen', () => {
  test('Start, Neustart, Absturz (schläft mit Hinweis), dreimal Absturz → error; Fehler beim Start → error', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      const post = (op: string) => api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/${op}`, { token: player.token });
      assert.equal((await post('start')).body.state, 'starting');
      const running = await waitState(t.service, player, world.id, 'running');
      assert.ok(running.lastStartedAt > 0);
      assert.deepEqual(running.ram, { used: 1500, limit: 3072 });
      // Neustart: anhalten und wieder starten
      const starts = t.runner.ops('start', world.id).length;
      await post('restart');
      await waitFor(() => t.runner.ops('start', world.id).length > starts, 'zweiter Start');
      await waitState(t.service, player, world.id, 'running');
      // Absturz
      t.runner.crash(world.id);
      const crashed = await waitState(t.service, player, world.id, 'sleeping');
      assert.match(crashed.error, /unerwartet beendet/);
      for (let i = 0; i < 2; i++) {
        await post('start');
        await waitState(t.service, player, world.id, 'running');
        t.runner.crash(world.id);
        await waitFor(async () => (await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}`, { token: player.token })).body.state !== 'running', 'Absturz erkannt');
      }
      const failed = await waitState(t.service, player, world.id, 'error');
      assert.match(failed.error, /mehrmals hintereinander abgestürzt/);
      // „stop“ in der Konsole ist kein Absturz
      await post('start');
      await waitState(t.service, player, world.id, 'running');
      assert.equal((await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/command`, { token: player.token, body: { command: '/stop' } })).status, 200);
      const slept = await waitState(t.service, player, world.id, 'sleeping');
      assert.equal(slept.error, null);
      t.runner.failStart = 'Kein Speicher';
      await post('start');
      const error = await waitState(t.service, player, world.id, 'error');
      assert.match(error.error, /Start fehlgeschlagen: Kein Speicher/);
    });
  });

  test('Konsole: letzte Zeilen, Befehle nur wenn sie läuft, geprüft; fremde 404, Operator ja', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      const command = (body: unknown, token = player.token) => api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/command`, { token, body });
      assert.equal((await command({ command: 'say Hallo' })).status, 409);
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      assert.equal((await command({ command: 'say Hallo' })).status, 200);
      assert.equal((await command({ command: 'say eins\nop Böse' })).status, 400);
      assert.equal((await command({ command: 'x'.repeat(257) })).status, 400);
      assert.equal((await command({ command: '' })).status, 400);
      assert.equal((await command({ command: 42 })).status, 400);
      assert.ok(t.runner.get(world.id).commands.includes('say Hallo'));
      const consoleRes = await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}/console?lines=2`, { token: player.token });
      assert.deepEqual([consoleRes.status, consoleRes.body.state, consoleRes.body.lines.length], [200, 'running', 2]);
      assert.equal((await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}/console?lines=999`, { token: player.token })).status, 400);
      const ben = await devPlayer(t.service.url, 'Ben');
      assert.equal((await command({ command: 'say x' }, ben.token)).status, 404);
      // Als Operator Mitglied der Welt: Konsole ja, Besitzer-Dinge nein
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: player.token, body: { role: 'operator' } });
      assert.equal((await command({ command: 'say von Ben' }, ben.token)).status, 200);
      const asOperator = await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}`, { token: ben.token });
      assert.deepEqual([asOperator.status, asOperator.body.role], [200, 'operator']);
      const operated = await api(t.service.url, 'GET', '/v1/hosting', { token: ben.token });
      assert.deepEqual(operated.body.operated.map((w: { id: string }) => w.id), [world.id]);
      const patch = await api(t.service.url, 'PATCH', `/v1/hosting/worlds/${world.id}`, { token: ben.token, body: { sleepAfterMin: 30 } });
      assert.equal(patch.status, 403);
      assert.equal((await api(t.service.url, 'DELETE', `/v1/hosting/worlds/${world.id}`, { token: ben.token })).status, 403);
      // Rolle weg: wieder 404
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: player.token, body: { role: 'player' } });
      assert.equal((await command({ command: 'say x' }, ben.token)).status, 404);
    });
  });

  test('server.properties: Auswahl prüfen, Höchstzahl = Welt, MOTD fest, Seed nur beim Anlegen; Neustart nötig', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      const url = `/v1/hosting/worlds/${world.id}/properties`;
      let res = await api(t.service.url, 'GET', url, { token: player.token });
      assert.deepEqual(
        [res.body.properties.difficulty, res.body.properties.pvp, res.body.properties['max-players'], res.body.properties['view-distance']],
        ['normal', true, 8, 10],
      );
      assert.match(res.body.motd, /Geteilt mit §bHeldixClient/);
      const patch = (body: unknown) => api(t.service.url, 'PATCH', url, { token: player.token, body });
      for (const bad of [{ 'view-distance': 3 }, { 'view-distance': 17 }, { 'max-players': 21 }, { pvp: 'ja' }, { difficulty: 'extrem' }, { 'level-seed': '1' }, { motd: 'Meins' }, { 'enable-rcon': true }]) {
        assert.equal((await patch(bad)).status, 400, JSON.stringify(bad));
      }
      res = await patch({ difficulty: 'hard', 'max-players': 12, pvp: false, 'simulation-distance': 6 });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.properties.difficulty, res.body.properties['max-players'], res.body.properties.pvp, res.body.restartNeeded], ['hard', 12, false, false]);
      assert.equal((await api(t.service.url, 'GET', `/v1/worlds/${world.id}`, { token: player.token })).body.maxPlayers, 12);
      const props = t.runner.get(world.id).properties;
      assert.deepEqual([props.difficulty, props['max-players'], props.pvp], ['hard', '12', 'false']);
      // Läuft sie, wirkt es erst nach einem Neustart
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      res = await patch({ 'allow-flight': true });
      assert.equal(res.body.restartNeeded, true);
      // Name der Welt ändern ändert die Beschreibung
      await api(t.service.url, 'PATCH', `/v1/hosting/worlds/${world.id}`, { token: player.token, body: { name: 'Burg', sleepAfterMin: 20 } });
      await waitFor(() => t.runner.get(world.id).motd.startsWith('§7Burg\n'), 'neue MOTD');
      const detail = await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}`, { token: player.token });
      assert.deepEqual([detail.body.name, detail.body.sleepAfterMin], ['Burg', 20]);
      for (const bad of [{ sleepAfterMin: 4 }, { sleepAfterMin: 61 }, { sleepAfterMin: 0 }, { name: '' }]) {
        assert.equal((await api(t.service.url, 'PATCH', `/v1/hosting/worlds/${world.id}`, { token: player.token, body: bad })).status, 400, JSON.stringify(bad));
      }
      // Version nur, wenn sie schläft
      assert.equal((await api(t.service.url, 'PATCH', `/v1/hosting/worlds/${world.id}`, { token: player.token, body: { version: '1.21.4' } })).status, 409);
    });
  });

  test('Versionswechsel: Sicherung „vor-version“, neues Jar', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      const res = await api(t.service.url, 'PATCH', `/v1/hosting/worlds/${world.id}`, { token: player.token, body: { version: '1.21.4' } });
      assert.deepEqual([res.status, res.body.version, res.body.paperBuild], [200, '1.21.4', 120]);
      assert.ok((t.runner.ops('backup', world.id) as string[]).some((n) => n.startsWith('vor-version-')));
      assert.equal(t.runner.get(world.id).prepared!.jar.version, '1.21.4');
    });
  });

  test('„Welt teilen“ derselben Welt geht nicht mehr, sobald sie dauerhaft ist (Tunnel wird geschlossen)', async () => {
    await withHosting(async (t) => {
      const anna = await devPlayer(t.service.url, 'Anna');
      grantBeta(t.service, anna.uuid);
      const shared = await createWorld(t.service, anna, { name: 'Höhle', access: 'open' });
      const host = await hostConnect(t.service, anna.token);
      host.send({ type: 'open', world: shared.id, version: '26.3', protocol: PROTOCOL });
      await host.next('ready');
      const res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: shared.id } });
      assert.deepEqual([res.status, res.body.awaitingUpload, res.body.state], [200, true, 'creating']);
      const error = await host.next('error');
      assert.deepEqual([error.code, error.message], ['hosted', 'Diese Welt läuft dauerhaft auf dem Heldix-Server. Tritt ihr über die Adresse bei, statt sie selbst zu teilen.']);
      await host.close();
      const again = await hostConnect(t.service, anna.token);
      again.send({ type: 'open', world: shared.id, version: '26.3', protocol: PROTOCOL });
      const refused = await again.next('error');
      assert.equal(refused.code, 'hosted');
      const closed = await again.closed;
      assert.equal(closed.code, 4011);
      assert.equal((await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: shared.id } })).status, 409);
    });
  });
});

describe('Dauerhafte Welten: Upload und Download', () => {
  test('Upload in Teilen (beliebige Reihenfolge), SHA-256 beim Abschluss, Import, Symbol; danach schläft sie', async () => {
    await withHosting(
      async (t) => {
        const anna = await devPlayer(t.service.url, 'Anna');
        grantBeta(t.service, anna.uuid);
        const shared = await createWorld(t.service, anna, { name: 'Höhle' });
        const created = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: shared.id, version: '26.3' } });
        const id = created.body.id;
        assert.equal(id, shared.id);
        await waitFor(() => t.runner.get(id).prepared !== null, 'vorbereitet');
        assert.equal((await api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/start`, { token: anna.token })).status, 409);
        const zip = worldZip();
        // falsche Größe und Teile
        assert.equal((await api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/upload`, { token: anna.token, body: { size: 2 * 1024 ** 3 + 1 } })).status, 400);
        const start = await api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/upload`, { token: anna.token, body: { size: zip.length } });
        assert.deepEqual([start.body.chunkSize, start.body.chunks, start.body.received], [4096, Math.ceil(zip.length / 4096), []]);
        assert.equal((await putRaw(t.service.url, `/v1/hosting/worlds/${id}/upload/0`, anna.token, zip.subarray(0, 100))).status, 400);
        assert.equal((await putRaw(t.service.url, `/v1/hosting/worlds/${id}/upload/99`, anna.token, zip.subarray(0, 100))).status, 400);
        const ben = await devPlayer(t.service.url, 'Ben');
        assert.equal((await putRaw(t.service.url, `/v1/hosting/worlds/${id}/upload/0`, ben.token, zip.subarray(0, 4096))).status, 404);
        // fehlende Teile
        const missing = await api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/upload/finish`, { token: anna.token, body: { sha256: 'a'.repeat(64) } });
        assert.deepEqual([missing.status, missing.body.code, missing.body.missing.length > 0], [409, 'missing-chunks', true]);
        // falsche Prüfsumme
        const wrong = await uploadZip(t, anna, id, zip, 'f'.repeat(64));
        assert.deepEqual([wrong.status, wrong.body.code], [400, 'checksum']);
        // nochmal (der Upload bleibt nach falscher Summe bestehen): richtig
        const ok = await uploadZip(t, anna, id, zip);
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.deepEqual([ok.body.state, ok.body.awaitingUpload, ok.body.upload], ['sleeping', false, null]);
        assert.deepEqual(t.runner.get(id).imported, [createHash('sha256').update(zip).digest('hex')]);
        const importPath = t.runner.ops('importWorld', id)[0] as string;
        assert.ok(importPath.includes('hosting-uploads'), importPath);
        // Staging ist danach weg
        assert.equal(fs.existsSync(importPath), false);
        // Zweiter Upload ersetzt die Welt: vorher Sicherung „vor-import“
        const again = await uploadZip(t, anna, id, worldZip(''));
        assert.equal(again.status, 200, JSON.stringify(again.body));
        assert.ok((t.runner.ops('backup', id) as string[]).some((n) => n.startsWith('vor-import-')));
        // Läuft sie, geht kein Upload
        await api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/start`, { token: anna.token });
        await waitState(t.service, anna, id, 'running');
        const busy = await api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/upload`, { token: anna.token, body: { size: zip.length } });
        assert.deepEqual([busy.status, busy.body.code], [409, 'not-sleeping']);
      },
      { hostingUploadChunkBytes: 4096 },
    );
  });

  test('Upload: bösartige ZIP wird abgelehnt (400 zip-rejected), die Welt bleibt beim Warten auf den Upload', async () => {
    await withHosting(
      async (t) => {
        const anna = await devPlayer(t.service.url, 'Anna');
        grantBeta(t.service, anna.uuid);
        const shared = await createWorld(t.service, anna, { name: 'Höhle' });
        const { body } = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: shared.id } });
        await waitFor(() => t.runner.worlds.get(body.id)?.prepared, 'vorbereitet');
        for (const [zip, pattern] of [
          [buildZip([entry('Insel/level.dat', 'L'), entry('Insel/../../etc/passwd', 'x')]), /ungültigen Pfad/],
          [buildZip([entry('region/r.0.0.mca', 'x')]), /level\.dat fehlt/],
          [buildZip([entry('A/level.dat', 'L'), entry('B/level.dat', 'L')]), /mehrere Welten/],
          [Buffer.from('keine zip datei, nur text '.repeat(10)), /keine ZIP-Datei/],
        ] as const) {
          const res = await uploadZip(t, anna, body.id, zip);
          assert.deepEqual([res.status, res.body.code], [400, 'zip-rejected'], JSON.stringify(res.body));
          assert.match(res.body.error, pattern);
        }
        assert.deepEqual(t.runner.get(body.id).imported, []);
        const view = await api(t.service.url, 'GET', `/v1/hosting/worlds/${body.id}`, { token: anna.token });
        assert.deepEqual([view.body.state, view.body.awaitingUpload], ['creating', true]);
      },
      { hostingUploadChunkBytes: 64 },
    );
  });

  test('Download der Welt und einer Sicherung als ZIP (nur Besitzer, eigene Grenze)', async () => {
    await withHosting(
      async (t) => {
        const { player, world } = await hostedWorld(t);
        const res = await fetch(`${t.service.url}/v1/hosting/worlds/${world.id}/download`, { headers: { Authorization: `Bearer ${player.token}` } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'application/zip');
        assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="Insel\.zip"/);
        const zip = Buffer.from(await res.arrayBuffer());
        assert.equal(zip.readUInt32LE(0), 0x04034b50);
        const backup = await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/backups`, { token: player.token });
        assert.equal(backup.status, 200);
        const name = backup.body.backup.name;
        assert.match(name, /^hand-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
        const file = await fetch(`${t.service.url}/v1/hosting/worlds/${world.id}/backups/${name}/download`, { headers: { Authorization: `Bearer ${player.token}` } });
        assert.equal(file.status, 200);
        await file.arrayBuffer();
        // dritter Download in der Stunde: 429
        const third = await fetch(`${t.service.url}/v1/hosting/worlds/${world.id}/download`, { headers: { Authorization: `Bearer ${player.token}` } });
        assert.equal(third.status, 429);
        await third.text();
      },
      { hostingDownloadRateLimit: 2 },
    );
  });
});

describe('Dauerhafte Welten: Sicherungen', () => {
  test('von Hand (höchstens 5), Liste, Wiederherstellen nur schlafend (mit Plugins von damals), Löschen, tägliche (letzte 7)', async () => {
    await withHosting(
      async (t) => {
        const { player, world } = await hostedWorld(t);
        const base = `/v1/hosting/worlds/${world.id}/backups`;
        const install = await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/plugins`, { token: player.token, body: { project: 'luckperms' } });
        assert.equal(install.status, 200, JSON.stringify(install.body));
        const names: string[] = [];
        for (let i = 0; i < 5; i++) names.push((await api(t.service.url, 'POST', base, { token: player.token })).body.backup.name);
        assert.equal(new Set(names).size, 5);
        const sixth = await api(t.service.url, 'POST', base, { token: player.token });
        assert.deepEqual([sixth.status, sixth.body.code], [409, 'backup-limit']);
        const list = await api(t.service.url, 'GET', base, { token: player.token });
        assert.deepEqual(list.body.backups.filter((b: { kind: string }) => b.kind === 'manual').length, 5);
        assert.ok(list.body.backups.some((b: { kind: string }) => b.kind === 'before-plugin'));
        // Plugin entfernen, dann Sicherung von vorher zurück: Liste der Plugins kommt mit
        await api(t.service.url, 'DELETE', `/v1/hosting/worlds/${world.id}/plugins/AbCdEf12`, { token: player.token });
        assert.equal((await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}/plugins`, { token: player.token })).body.plugins.length, 0);
        assert.equal((await api(t.service.url, 'POST', `${base}/${names[0]}/restore`, { token: player.token })).status, 200);
        assert.equal((await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}/plugins`, { token: player.token })).body.plugins.length, 1);
        assert.ok((t.runner.ops('backup', world.id) as string[]).some((n) => n.startsWith('vor-wiederherstellen-')));
        assert.deepEqual(t.runner.ops('restoreBackup', world.id), [names[0]]);
        assert.equal((await api(t.service.url, 'POST', `${base}/2020-01-01_00-00-00/restore`, { token: player.token })).status, 404);
        assert.equal((await api(t.service.url, 'POST', `${base}/..%2Fx/restore`, { token: player.token })).status, 404);
        // läuft: kein Wiederherstellen
        await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
        await waitState(t.service, player, world.id, 'running');
        const running = await api(t.service.url, 'POST', `${base}/${names[1]}/restore`, { token: player.token });
        assert.deepEqual([running.status, running.body.code], [409, 'not-sleeping']);
        // Sicherung einer laufenden Welt: vorher speichern
        assert.equal((await api(t.service.url, 'DELETE', `${base}/${names[1]}`, { token: player.token })).status, 200);
        assert.equal((await api(t.service.url, 'POST', base, { token: player.token })).status, 200);
        const commands = t.runner.get(world.id).commands;
        assert.deepEqual(commands.slice(-3), ['save-off', 'save-all flush', 'save-on']);
        // Tägliche Sicherung (Zeitraum im Test kurz): höchstens 7 bleiben
        await waitFor(async () => (await api(t.service.url, 'GET', base, { token: player.token })).body.backups.filter((b: { kind: string }) => b.kind === 'daily').length >= 7, 'tägliche Sicherungen', 6000);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const daily = (await api(t.service.url, 'GET', base, { token: player.token })).body.backups.filter((b: { kind: string }) => b.kind === 'daily');
        assert.equal(daily.length, 7);
        // Nur der Besitzer
        const ben = await devPlayer(t.service.url, 'Ben');
        await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: player.token, body: { role: 'operator' } });
        assert.equal((await api(t.service.url, 'GET', base, { token: ben.token })).status, 403);
      },
      { hostingDailyBackupMs: 20, hostingBackupCheckMs: 20 },
    );
  });
});

describe('Dauerhafte Welten: Plugins und Plugin-Konfiguration', () => {
  test('Installieren wählt neueste Release für Paper und die Version, SHA-512, Datei nur von cdn.modrinth.com; Grenzen', async () => {
    await withHosting(
      async (t) => {
        const { player, world } = await hostedWorld(t);
        const url = `/v1/hosting/worlds/${world.id}/plugins`;
        const res = await api(t.service.url, 'POST', url, { token: player.token, body: { project: 'luckperms' } });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.deepEqual([res.body.plugin.project, res.body.plugin.version, res.body.plugin.versionId, res.body.plugin.file], ['AbCdEf12', '5.5.0', 'Ver00002', 'LuckPerms-Bukkit-5.5.0.jar']);
        assert.equal(res.body.plugin.url, 'https://modrinth.com/plugin/luckperms');
        assert.match(res.body.notice, /eigene Daten speichern und ins Internet verbinden/);
        const file = t.runner.ops('installPlugin', world.id)[0] as { url: string; sha512: string; name: string };
        assert.ok(file.url.startsWith('https://cdn.modrinth.com/'));
        assert.equal(file.sha512, createHash('sha512').update('Ver00002').digest('hex'));
        assert.ok((t.runner.ops('backup', world.id) as string[]).some((n) => n.startsWith('vor-plugin-')));
        // doppelt, Fabric-Mod, fremde Adresse, unbekannt, ungültig
        assert.equal((await api(t.service.url, 'POST', url, { token: player.token, body: { project: 'AbCdEf12' } })).status, 409);
        assert.equal((await api(t.service.url, 'POST', url, { token: player.token, body: { project: 'FabricOn' } })).status, 409);
        assert.equal((await api(t.service.url, 'POST', url, { token: player.token, body: { project: 'EvilCdn1' } })).status, 409);
        assert.equal((await api(t.service.url, 'POST', url, { token: player.token, body: { project: 'unbekannt' } })).status, 404);
        assert.equal((await api(t.service.url, 'POST', url, { token: player.token, body: { project: '../x' } })).status, 400);
        assert.equal((await api(t.service.url, 'POST', url, { token: player.token, body: { file: 'eigenes.jar' } })).status, 400);
        // Grenze von 1 Plugin (Test)
        t.apis.projects.set('Second12', { id: 'Second12', slug: 'second', title: 'Second', loaders: ['paper'], game_versions: ['26.3'] });
        t.apis.versions.set('Second12', [modrinthVersion('Second12', 'SecVer01', '1.0')]);
        const limit = await api(t.service.url, 'POST', url, { token: player.token, body: { project: 'Second12' } });
        assert.deepEqual([limit.status, limit.body.code], [409, 'plugin-limit']);
        // Update: neue Version erscheint (nach Ablauf des Caches gibt es sie; hier ein neues Projekt-Abbild)
        const list = await api(t.service.url, 'GET', `${url}?updates=1`, { token: player.token });
        assert.deepEqual([list.body.plugins.length, list.body.plugins[0].update, list.body.max], [1, null, 1]);
        // Entfernen
        assert.equal((await api(t.service.url, 'DELETE', `${url}/AbCdEf12`, { token: player.token })).status, 200);
        assert.deepEqual(t.runner.ops('removePlugin', world.id), ['LuckPerms-Bukkit-5.5.0.jar']);
        assert.equal((await api(t.service.url, 'DELETE', `${url}/AbCdEf12`, { token: player.token })).status, 404);
        // Speicher voll: kein Installieren
        t.runner.get(world.id).diskMb = 7000;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const full = await api(t.service.url, 'POST', url, { token: player.token, body: { project: 'luckperms' } });
        assert.deepEqual([full.status, full.body.code], [409, 'disk-full']);
      },
      { hostingMaxPlugins: 1 },
    );
  });

  test('Plugin-Konfiguration: nur Textdateien unter plugins/, ≤ 256 KB; Operator liest, nur Besitzer schreibt', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      t.runner.get(world.id).files.set('plugins/LuckPerms/config.yml', 'server: global\n');
      const base = `/v1/hosting/worlds/${world.id}/files`;
      assert.deepEqual((await api(t.service.url, 'GET', base, { token: player.token })).body, { files: ['plugins/LuckPerms/config.yml'] });
      const read = await api(t.service.url, 'GET', `${base}?path=plugins/LuckPerms/config.yml`, { token: player.token });
      assert.deepEqual(read.body, { path: 'plugins/LuckPerms/config.yml', content: 'server: global\n' });
      for (const bad of ['plugins/../server.properties', 'server.properties', 'plugins/x.jar', '/etc/passwd', 'plugins//a.yml', 'plugins/a/./b.yml', 'world/level.dat']) {
        assert.equal((await api(t.service.url, 'GET', `${base}?path=${encodeURIComponent(bad)}`, { token: player.token })).status, 400, bad);
        assert.equal((await api(t.service.url, 'PUT', `${base}?path=${encodeURIComponent(bad)}`, { token: player.token, body: { content: 'x' } })).status, 400, bad);
      }
      assert.equal((await api(t.service.url, 'GET', `${base}?path=plugins/fehlt.yml`, { token: player.token })).status, 404);
      const write = await api(t.service.url, 'PUT', `${base}?path=plugins/LuckPerms/config.yml`, { token: player.token, body: { content: 'server: welt\n' } });
      assert.deepEqual([write.status, write.body.ok], [200, true]);
      assert.equal(t.runner.get(world.id).files.get('plugins/LuckPerms/config.yml'), 'server: welt\n');
      const big = await api(t.service.url, 'PUT', `${base}?path=plugins/a.yml`, { token: player.token, body: { content: 'x'.repeat(256 * 1024 + 1) } });
      assert.equal(big.status, 413);
      const ben = await devPlayer(t.service.url, 'Ben');
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: player.token, body: { role: 'operator' } });
      assert.equal((await api(t.service.url, 'GET', `${base}?path=plugins/LuckPerms/config.yml`, { token: ben.token })).status, 200);
      assert.equal((await api(t.service.url, 'PUT', `${base}?path=plugins/LuckPerms/config.yml`, { token: ben.token, body: { content: 'x' } })).status, 403);
    });
  });
});

describe('Dauerhafte Welten: Team-Bereich und Freischaltungen', () => {
  test('Übersicht, Anhalten und Grenzen (hosting:manage); Freischaltungen (hosting:grant, nur Admin); Protokoll', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      const admin = await devPlayer(t.service.url, 'Chefin');
      const dev = await devPlayer(t.service.url, 'Entwickler');
      const mod = await devPlayer(t.service.url, 'Moderator');
      const a = await teamLogin(t.service, admin, 'admin', t.clock);
      const d = await teamLogin(t.service, dev, 'developer-team', t.clock);
      const m = await teamLogin(t.service, mod, 'moderator', t.clock);
      let res = await webApi(t.service, 'GET', '/v1/team/hosting', { cookie: d.cookie });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.slots.max, res.body.slots.used, res.body.worlds.length, res.body.worlds[0].owner.name, res.body.worlds[0].cpuPercent], [4, 1, 1, player.name, 12]);
      assert.ok(res.body.memory.totalMb > 0);
      assert.equal((await webApi(t.service, 'GET', '/v1/team/hosting', { cookie: m.cookie })).status, 403);
      res = await webApi(t.service, 'PATCH', `/v1/team/hosting/worlds/${world.id}`, { cookie: d.cookie, body: { sleepAfterMin: 0, maxPlugins: 50, diskMb: 10_240 } });
      assert.deepEqual([res.status, res.body.sleepAfterMin, res.body.maxPlugins, res.body.disk.limit], [200, 0, 50, 10_240]);
      assert.equal((await webApi(t.service, 'PATCH', `/v1/team/hosting/worlds/${world.id}`, { cookie: d.cookie, body: { memoryMb: 100 } })).status, 400);
      assert.equal((await webApi(t.service, 'POST', `/v1/team/hosting/worlds/${world.id}/stop`, { cookie: d.cookie })).status, 200);
      await waitState(t.service, player, world.id, 'sleeping');
      // Freischaltungen: Entwickler darf nicht, Admin schon
      const ben = await devPlayer(t.service.url, 'Ben');
      assert.equal((await webApi(t.service, 'PUT', `/v1/team/hosting/grants/${ben.uuid}`, { cookie: d.cookie })).status, 403);
      const { client } = await connect(t.service.wsUrl, ben.token);
      res = await webApi(t.service, 'PUT', `/v1/team/hosting/grants/${ben.uuid}`, { cookie: a.cookie });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.added, res.body.grant.label, res.body.grant.grantedBy], [true, 'Beta: Dauerhafte Welten', 'Chefin']);
      const granted = await client.next('hosting-granted');
      assert.deepEqual([granted.source, granted.pending, granted.label], ['beta', false, 'Beta: Dauerhafte Welten']);
      assert.equal((await webApi(t.service, 'PUT', `/v1/team/hosting/grants/${ben.uuid}`, { cookie: a.cookie })).body.added, false);
      assert.equal((await api(t.service.url, 'GET', '/v1/hosting', { token: ben.token })).body.allowed, true);
      res = await webApi(t.service, 'GET', `/v1/team/hosting/grants/${ben.uuid}`, { cookie: a.cookie });
      assert.deepEqual([res.body.allowed, res.body.team, res.body.grants.length], [true, false, 1]);
      assert.ok((await webApi(t.service, 'GET', '/v1/team/hosting/grants', { cookie: a.cookie })).body.grants.some((g: { uuid: string }) => g.uuid === ben.uuid));
      res = await webApi(t.service, 'DELETE', `/v1/team/hosting/grants/${ben.uuid}`, { cookie: a.cookie });
      assert.deepEqual([res.body.removed, res.body.grants], [true, []]);
      assert.equal((await api(t.service.url, 'GET', '/v1/hosting', { token: ben.token })).body.allowed, false);
      assert.equal((await webApi(t.service, 'PUT', '/v1/team/hosting/grants/ffffffffffffffffffffffffffffffff', { cookie: a.cookie })).status, 404);
      const audit = await webApi(t.service, 'GET', '/v1/team/audit', { cookie: a.cookie });
      const actions = audit.body.entries.map((e: { action: string }) => e.action);
      for (const action of ['hosting.grant', 'hosting.revoke', 'hosting.stop', 'hosting.limits']) assert.ok(actions.includes(action), action);
      // Rechte in WebMe
      const me = await webApi(t.service, 'GET', '/v1/web/me', { cookie: d.cookie });
      assert.ok(me.body.permissions.includes('hosting:manage') && !me.body.permissions.includes('hosting:grant'));
      await client.close();
    });
  });

  test('Freischaltung ohne Verbindung: Hinweis bei der nächsten Verbindung, bis „gesehen“; Entzug hält laufende Welten an', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      let first = await connect(t.service.wsUrl, player.token);
      const pending = await first.client.next('hosting-granted');
      assert.equal(pending.pending, true);
      await first.client.close();
      assert.equal((await api(t.service.url, 'POST', '/v1/plus/seen', { token: player.token })).body.unseen, false);
      first = await connect(t.service.wsUrl, player.token);
      await first.client.sync();
      assert.equal(first.client.messages.some((m) => m.type === 'hosting-granted'), false);
      await first.client.close();
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      const admin = await devPlayer(t.service.url, 'Chefin');
      const a = await teamLogin(t.service, admin, 'admin', t.clock);
      await webApi(t.service, 'DELETE', `/v1/team/hosting/grants/${player.uuid}`, { cookie: a.cookie });
      await waitState(t.service, player, world.id, 'sleeping');
      const start = await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      assert.deepEqual([start.status, start.body.code], [403, 'paused']);
    });
  });
});

describe('Dauerhafte Welten: Echtzeit', () => {
  test('hosting-state an Besitzer und Operatoren; hosting-log nur für Abonnenten mit Rolle', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      const ben = await devPlayer(t.service.url, 'Ben');
      const eve = await devPlayer(t.service.url, 'Eve');
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: player.token, body: { role: 'operator' } });
      const owner = (await connect(t.service.wsUrl, player.token)).client;
      const op = (await connect(t.service.wsUrl, ben.token)).client;
      const stranger = (await connect(t.service.wsUrl, eve.token)).client;
      owner.drain();
      op.drain();
      owner.send({ type: 'hosting-subscribe', world: world.id });
      assert.deepEqual(await owner.next('hosting-subscribed'), { type: 'hosting-subscribed', world: world.id, state: 'sleeping' });
      stranger.send({ type: 'hosting-subscribe', world: world.id });
      assert.equal((await stranger.next('hosting-error')).world, world.id);
      stranger.send({ type: 'hosting-subscribe', world: '../x' });
      assert.equal((await stranger.next('hosting-error')).world, null);
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      const starting = await owner.next((m) => m.type === 'hosting-state' && m.world.state === 'starting');
      assert.equal(starting.world.role, 'owner');
      const opState = await op.next((m) => m.type === 'hosting-state' && m.world.state === 'running');
      assert.equal(opState.world.role, 'operator');
      t.runner.emit(world.id, '<Ben> geheimer Chat');
      const log = await owner.next((m) => m.type === 'hosting-log' && m.lines.some((l: string) => l.includes('geheimer Chat')));
      assert.equal(log.world, world.id);
      await stranger.sync();
      assert.equal(stranger.messages.some((m) => m.type === 'hosting-log' || m.type === 'hosting-state'), false);
      // Abmelden: keine Logs mehr
      owner.send({ type: 'hosting-unsubscribe', world: world.id });
      await owner.sync();
      owner.drain();
      t.runner.emit(world.id, 'nach dem Abmelden');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(owner.messages.some((m) => m.type === 'hosting-log'), false);
      for (const client of [owner, op, stranger]) await client.close();
    });
  });
});

describe('Dauerhafte Welten: Freunde und Mitglieder (GET /v1/worlds → friends)', () => {
  test('auch schlafend, mit Zustand; Zugang Freunde/offen und Präsenz bzw. Mitgliedschaft; nie Blockierte, nie beim Einrichten oder Fehler', async () => {
    await withHosting(async (t) => {
      // Anna ist nie verbunden: dauerhafte Welten sehen Freunde auch, wenn der Besitzer offline ist
      const { player: anna, world } = await hostedWorld(t, 'Anna');
      const ben = await devPlayer(t.service.url, 'Ben');
      const carl = await devPlayer(t.service.url, 'Carl');
      const dora = await devPlayer(t.service.url, 'Dora');
      await befriend(t.service.url, anna, ben);
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Dora`, { token: anna.token, body: {} });
      const friendsOf = async (p: Player) => {
        const res = await api(t.service.url, 'GET', '/v1/worlds', { token: p.token });
        assert.equal(res.status, 200);
        return res.body.friends as any[];
      };
      const ids = async (p: Player) => (await friendsOf(p)).map((w) => w.id);

      // Zugang „Nur Eingeladene“ (Standard): nur das Mitglied sieht sie
      assert.equal(world.access, 'invited');
      assert.deepEqual(await ids(ben), []);
      const [seen] = await friendsOf(dora);
      assert.deepEqual(seen, {
        id: world.id,
        name: 'Insel',
        address: `${world.code}.${DOMAIN}`,
        host: { uuid: anna.uuid, name: 'Anna' },
        players: 0,
        maxPlayers: world.maxPlayers,
        version: '26.3',
        online: false,
        hosted: { state: 'sleeping' },
      });

      // Zugang „Freunde“: Ben (Freund) ja, Carl (kein Freund) nein; die eigene Welt nie unter friends
      await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { access: 'friends' } });
      assert.deepEqual(await ids(ben), [world.id]);
      assert.deepEqual(await ids(carl), []);
      assert.deepEqual(await ids(anna), []);
      const mine = (await api(t.service.url, 'GET', '/v1/worlds', { token: anna.token })).body.mine;
      assert.deepEqual(mine.map((w: any) => [w.id, w.hosted]), [[world.id, { state: 'sleeping' }]]);

      // Präsenz aus: Freunde sehen sie nicht mehr, Mitglieder schon
      await api(t.service.url, 'PUT', '/v1/me', { token: anna.token, body: { presence: false } });
      assert.deepEqual(await ids(ben), []);
      assert.deepEqual(await ids(dora), [world.id]);
      await api(t.service.url, 'PUT', '/v1/me', { token: anna.token, body: { presence: true } });

      // Läuft: online und Zustand vom Server
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: anna.token });
      await waitState(t.service, anna, world.id, 'running');
      t.runner.join(world.id, 'Ben');
      await waitFor(async () => (await friendsOf(ben))[0]?.players === 1, 'ein Spieler');
      const running = (await friendsOf(ben))[0];
      assert.deepEqual([running.online, running.hosted, running.version], [true, { state: 'running' }, '26.3']);
      t.runner.leave(world.id, 'Ben');
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/stop`, { token: anna.token });
      await waitState(t.service, anna, world.id, 'sleeping');
      assert.deepEqual((await friendsOf(ben)).map((w) => [w.online, w.hosted]), [[false, { state: 'sleeping' }]]);

      // Zugang „offen“ gilt für Freunde genauso (Fremde sehen sie nicht unter friends)
      await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { access: 'open' } });
      assert.deepEqual([await ids(ben), await ids(carl)], [[world.id], []]);

      // Blockierung in beide Richtungen: weg (auch für das Mitglied)
      assert.equal((await api(t.service.url, 'POST', '/v1/blocks', { token: dora.token, body: { uuid: anna.uuid } })).status, 200);
      assert.deepEqual(await ids(dora), []);
      assert.equal((await api(t.service.url, 'POST', '/v1/blocks', { token: anna.token, body: { uuid: ben.uuid } })).status, 200);
      assert.deepEqual(await ids(ben), []);

      // Wird eingerichtet (wartet auf den Upload) bzw. Fehler: nicht dabei
      const fritz = await devPlayer(t.service.url, 'Fritz');
      grantBeta(t.service, fritz.uuid);
      await befriend(t.service.url, fritz, carl);
      const shared = (await api(t.service.url, 'POST', '/v1/worlds', { token: fritz.token, body: { name: 'Höhle', access: 'friends' } })).body;
      const created = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: fritz.token, body: { world: shared.id } });
      assert.deepEqual([created.status, created.body.state, created.body.awaitingUpload], [200, 'creating', true]);
      assert.deepEqual(await ids(carl), []);
      await befriend(t.service.url, anna, carl);
      assert.deepEqual(await ids(carl), [world.id]);
      t.runner.failStart = 'Kein Speicher';
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: anna.token });
      await waitState(t.service, anna, world.id, 'error');
      assert.deepEqual(await ids(carl), []);
    });
  });

  test('ohne dauerhafte Welten (kein Runner) wie bisher: nur geöffnete Welten', async () => {
    const service = await startService({ dev: true, weltDomain: DOMAIN });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      await befriend(service.url, anna, ben);
      await createWorld(service, anna, { name: 'Insel', access: 'friends' });
      const res = await api(service.url, 'GET', '/v1/worlds', { token: ben.token });
      assert.deepEqual([res.status, res.body.friends], [200, []]);
    } finally {
      await service.close();
    }
  });
});

describe('Dauerhafte Welten: Entwicklungs-Route für den Autotest', () => {
  test('POST/DELETE /v1/dev/hosting/grant mit uuid oder name (Körper oder Abfrage); nur im Entwicklungsmodus und nur lokal', async () => {
    await withHosting(async (t) => {
      const anna = await devPlayer(t.service.url, 'Anna');
      const live = (await connect(t.service.wsUrl, anna.token)).client;
      const before = await api(t.service.url, 'GET', '/v1/hosting', { token: anna.token });
      assert.deepEqual([before.body.allowed, before.body.reason], [false, 'beta']);
      // Freischalten per uuid: wie im Team-Bereich (hosting-granted, Protokoll als „Autotest“)
      let res = await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: { uuid: anna.uuid } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual([res.body.uuid, res.body.name, res.body.added, res.body.allowed], [anna.uuid, 'Anna', true, true]);
      assert.deepEqual(res.body.grants.map((g: any) => [g.source, g.label, g.grantedBy]), [['beta', 'Beta: Dauerhafte Welten', 'Autotest']]);
      const granted = await live.next('hosting-granted');
      assert.deepEqual([granted.source, granted.pending], ['beta', false]);
      assert.equal((await api(t.service.url, 'GET', '/v1/hosting', { token: anna.token })).body.allowed, true);
      // noch einmal (per Name, andere Schreibweise): nichts Neues
      res = await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: { name: 'anna' } });
      assert.deepEqual([res.status, res.body.uuid, res.body.added], [200, anna.uuid, false]);
      // Entfernen per Name im Körper, dann per Abfrage (schon weg)
      res = await api(t.service.url, 'DELETE', '/v1/dev/hosting/grant', { body: { name: 'Anna' } });
      assert.deepEqual([res.status, res.body.removed, res.body.allowed, res.body.grants], [200, true, false, []]);
      res = await api(t.service.url, 'DELETE', `/v1/dev/hosting/grant?uuid=${anna.uuid}`);
      assert.deepEqual([res.status, res.body.removed], [200, false]);
      assert.deepEqual((await api(t.service.url, 'GET', '/v1/hosting', { token: anna.token })).body.reason, 'beta');
      res = await api(t.service.url, 'POST', '/v1/dev/hosting/grant?name=Anna');
      assert.deepEqual([res.status, res.body.added], [200, true]);
      // Eingaben: fehlt, ungültig, unbekannt
      assert.equal((await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: {} })).status, 400);
      assert.equal((await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: { uuid: 'x' } })).status, 400);
      assert.equal((await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: { uuid: 42 } })).status, 400);
      assert.equal((await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: { name: 'a b' } })).status, 400);
      assert.equal((await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: { uuid: 'f'.repeat(32) } })).status, 404);
      assert.equal((await api(t.service.url, 'DELETE', '/v1/dev/hosting/grant', { body: { name: 'Niemand' } })).status, 404);
      // Über einen Proxy auf diesem Rechner: gibt es nicht
      const proxied = await api(t.service.url, 'POST', '/v1/dev/hosting/grant', { body: { uuid: anna.uuid }, headers: { 'X-Forwarded-For': '203.0.113.9' } });
      assert.equal(proxied.status, 404);
      await live.close();
    });
    // Ohne Entwicklungsmodus: 404
    const plain = await startService({});
    try {
      assert.equal((await api(plain.url, 'POST', '/v1/dev/hosting/grant', { body: { name: 'Anna' } })).status, 404);
      assert.equal((await api(plain.url, 'DELETE', '/v1/dev/hosting/grant', { body: { name: 'Anna' } })).status, 404);
    } finally {
      await plain.close();
    }
  });
});

describe('Dauerhafte Welten: Löschen und Datenauskunft', () => {
  test('DELETE …/hosting/worlds/<id> beendet dauerhaft (geteilte Welt bleibt); DELETE /v1/worlds/<id> löscht beim Runner mit', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      const owner = (await connect(t.service.wsUrl, player.token)).client;
      assert.deepEqual((await api(t.service.url, 'DELETE', `/v1/hosting/worlds/${world.id}`, { token: player.token })).body, { ok: true });
      assert.deepEqual((await owner.next((m) => m.type === 'hosting-state' && m.world.state === 'deleted')).world, { id: world.id, state: 'deleted' });
      assert.equal(t.runner.worlds.has(world.id), false);
      const shared = await api(t.service.url, 'GET', `/v1/worlds/${world.id}`, { token: player.token });
      assert.deepEqual([shared.status, shared.body.hosted], [200, undefined]);
      // Neu dauerhaft und dann die geteilte Welt löschen
      const again = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: player.token, body: { world: world.id } });
      assert.equal(again.status, 200, JSON.stringify(again.body));
      await waitFor(() => t.runner.worlds.get(world.id)?.prepared, 'vorbereitet');
      await api(t.service.url, 'DELETE', `/v1/worlds/${world.id}`, { token: player.token });
      await waitFor(() => !t.runner.worlds.has(world.id), 'beim Runner gelöscht');
      await owner.close();
    });
  });

  test('Datenauskunft enthält dauerhafte Welten, Plugins und Freischaltungen; Konto löschen räumt Server und Daten ab', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/plugins`, { token: player.token, body: { project: 'luckperms' } });
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      const res = await fetch(`${t.service.url}/v1/me/export`, { headers: { Authorization: `Bearer ${player.token}` } });
      const data = (await res.json()) as any;
      assert.deepEqual(Object.keys(data.hosting), ['worlds', 'grants']);
      assert.deepEqual([data.hosting.worlds[0].id, data.hosting.worlds[0].software, data.hosting.worlds[0].plugins[0].title], [world.id, 'paper', 'LuckPerms']);
      assert.deepEqual(data.hosting.grants.map((g: { source: string }) => g.source), ['beta']);
      assert.deepEqual(Object.keys(data.discover), ['listings', 'likes', 'reports', 'bannedFromDirectory']);
      assert.deepEqual(data.plus, { waitlist: null });
      assert.deepEqual((await api(t.service.url, 'DELETE', '/v1/me', { token: player.token })).body, { deleted: true });
      await waitFor(() => !t.runner.worlds.has(world.id), 'Server und Daten gelöscht');
      const store = new Store(t.service.dataDir);
      try {
        const count = (sql: string) => Number((store.prepare(sql).get() as { n: number }).n);
        assert.equal(count('SELECT count(*) AS n FROM hosted_worlds'), 0);
        assert.equal(count('SELECT count(*) AS n FROM hosted_plugins'), 0);
        assert.equal(count('SELECT count(*) AS n FROM hosting_grants'), 0);
      } finally {
        store.close();
      }
    });
  });

  test('Sperre durch das Team: laufende Welt hält an, Daten beim Runner und Freischaltung sind weg', async () => {
    await withHosting(async (t) => {
      const { player, world } = await hostedWorld(t);
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      const mod = await teamLogin(t.service, await devPlayer(t.service.url, 'Moderator'), 'moderator', t.clock);
      const ban = await webApi(t.service, 'POST', '/v1/team/bans', { cookie: mod.cookie, body: { uuid: player.uuid, reason: 'Test' } });
      assert.equal(ban.status, 200, JSON.stringify(ban.body));
      await waitFor(() => !t.runner.worlds.has(world.id), 'Server und Daten gelöscht');
      const store = new Store(t.service.dataDir);
      try {
        assert.equal(Number((store.prepare('SELECT count(*) AS n FROM hosting_grants').get() as { n: number }).n), 0);
        assert.equal(Number((store.prepare('SELECT count(*) AS n FROM hosted_worlds').get() as { n: number }).n), 0);
      } finally {
        store.close();
      }
      assert.equal((await api(t.service.url, 'GET', '/v1/status')).body.hosted, 0);
    });
  });

  test('Abgleich: Löschen über heldix-dienst-admin (Grabstein) räumt beim Runner ab; Unbekanntes bleibt (nur Warnung)', async () => {
    const runner = new FakeRunner();
    const t = await startHosting({ hostingReconcileMs: 50 }, runner);
    try {
      const { player, world } = await hostedWorld(t);
      const other = await hostedWorld(t, 'Weg');
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      // Welt beim Runner, die es in der Datenbank nie gab (z. B. falsche Datenbank): bleibt unangetastet
      await runner.prepare('f'.repeat(32), { jar: { software: 'paper', version: '26.3', url: 'x', build: 1 }, memoryMb: 1, properties: {}, motd: '' });
      // Konto direkt in der Datenbank löschen, wie heldix-dienst-admin (anderer Prozess, kein Ereignis im Dienst)
      const store = new Store(t.service.dataDir);
      try {
        store.deleteUser(other.player.uuid);
      } finally {
        store.close();
      }
      await waitFor(() => !runner.worlds.has(other.world.id), 'gelöschte Welt beim Runner abgeräumt');
      await waitFor(() => t.service.logs.some((l) => l.includes('kennt 1 Welt(en), die es in der Datenbank nicht gibt')), 'Warnung');
      assert.equal(runner.worlds.has('f'.repeat(32)), true);
      // die echte Welt bleibt (und läuft weiter)
      assert.equal(runner.get(world.id).state, 'running');
    } finally {
      await t.close();
    }
  });
});
