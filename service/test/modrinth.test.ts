// Plugins aus dem Modrinth-Katalog (1.13.0): Proxy gegen eine nachgebaute Modrinth-API (nie das echte Modrinth): Suche mit
// den richtigen Facets und User-Agent, Cache, Auswahl der passenden Version (Paper-Loader, Minecraft-Version, Release
// vor Beta, nur cdn.modrinth.com mit SHA-512), Dateinamen, Fehler und die Routen mit eigener Grenze.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HttpError } from '../src/http';
import { Modrinth, pluginFileName } from '../src/hosting/modrinth';
import { api, devPlayer } from './helpers';
import { grantBeta, startFakeApis, startHosting } from './hosting-helpers';

describe('Modrinth-Proxy', () => {
  test('Suche: Facets project_type:plugin, categories paper|bukkit|spigot, versions:<mc>; User-Agent; Cache; nur saubere Treffer', async () => {
    const apis = await startFakeApis();
    try {
      const modrinth = new Modrinth({ api: `${apis.url}/modrinth`, userAgent: 'heldix-dienst/1.13.0 (heldixclient.com)' });
      const result = await modrinth.search('perms', '26.3', 0, 10);
      const request = apis.requests.find((r) => r.path.startsWith('/modrinth/v2/search'))!;
      const params = new URL(request.path, 'http://x').searchParams;
      assert.deepEqual(JSON.parse(params.get('facets')!), [['project_type:plugin'], ['categories:paper', 'categories:bukkit', 'categories:spigot'], ['versions:26.3']]);
      assert.deepEqual([params.get('query'), params.get('limit'), params.get('offset')], ['perms', '10', '0']);
      assert.equal(request.userAgent, 'heldix-dienst/1.13.0 (heldixclient.com)');
      // Treffer mit ungültiger ID fallen weg, fremde Symbole werden null
      assert.deepEqual(result.hits.map((h) => [h.project, h.slug, h.url]), [
        ['AbCdEf12', 'luckperms', 'https://modrinth.com/plugin/luckperms'],
        ['Other123', 'other', 'https://modrinth.com/plugin/other'],
      ]);
      assert.equal(result.hits[1]!.icon, null);
      assert.equal(result.total, 2);
      // Cache: dieselbe Suche fragt Modrinth nicht noch einmal
      const before = apis.requests.length;
      await modrinth.search('perms', '26.3', 0, 10);
      assert.equal(apis.requests.length, before);
      await modrinth.search('perms', null, 0, 10);
      const withoutVersion = apis.requests.at(-1)!;
      assert.deepEqual(JSON.parse(new URL(withoutVersion.path, 'http://x').searchParams.get('facets')!).length, 2);
    } finally {
      await apis.close();
    }
  });

  test('Auswahl: neueste Release für Paper und die Version; Beta nur ohne Release; feste Version; Fehlerfälle', async () => {
    const apis = await startFakeApis();
    try {
      const modrinth = new Modrinth({ api: `${apis.url}/modrinth`, userAgent: 'test' });
      const chosen = await modrinth.choose('luckperms', '26.3');
      assert.deepEqual([chosen.project, chosen.versionId, chosen.versionNumber, chosen.file.name], ['AbCdEf12', 'Ver00002', '5.5.0', 'LuckPerms-Bukkit-5.5.0.jar']);
      assert.ok(chosen.file.url.startsWith('https://cdn.modrinth.com/'));
      assert.match(chosen.file.sha512, /^[0-9a-f]{128}$/);
      assert.equal((await modrinth.choose('luckperms', '1.21.4')).versionId, 'VerOld01');
      assert.equal((await modrinth.choose('luckperms', '26.3', 'Ver00001')).versionId, 'Ver00001');
      await assert.rejects(modrinth.choose('luckperms', '26.3', 'VerOld01'), (err: unknown) => err instanceof HttpError && err.status === 409);
      await assert.rejects(modrinth.choose('luckperms', '9.9'), (err: unknown) => err instanceof HttpError && err.status === 409 && /keine passende Version/.test(err.message));
      await assert.rejects(modrinth.choose('sodium', '26.3'), (err: unknown) => err instanceof HttpError && err.status === 409 && /kein Plugin für Paper/.test(err.message));
      // Datei außerhalb von cdn.modrinth.com wird nie gewählt
      await assert.rejects(modrinth.choose('evil', '26.3'), (err: unknown) => err instanceof HttpError && err.status === 409);
      await assert.rejects(modrinth.project('gibtsnicht'), (err: unknown) => err instanceof HttpError && err.status === 404);
      await assert.rejects(modrinth.project('../etc'), (err: unknown) => err instanceof HttpError && err.status === 400);
      // nur Beta vorhanden: Beta
      apis.versions.get('AbCdEf12')!.splice(0, 2);
      const fresh = new Modrinth({ api: `${apis.url}/modrinth`, userAgent: 'test' });
      assert.equal((await fresh.choose('luckperms', '26.3')).versionId, 'Ver00003');
      const versions = await fresh.versions('AbCdEf12', '26.3');
      assert.ok(versions.every((v) => v.loaders.some((l) => ['paper', 'bukkit', 'spigot', 'purpur'].includes(l))));
    } finally {
      await apis.close();
    }
  });

  test('Dateinamen für plugins/: unerlaubte Zeichen werden zu „-“, immer .jar', () => {
    assert.equal(pluginFileName('LuckPerms Bukkit 5.5.0.jar', 'luckperms'), 'LuckPerms-Bukkit-5.5.0.jar');
    assert.equal(pluginFileName('../../evil.jar', 'evil'), 'evil.jar');
    assert.equal(pluginFileName('..jar', 'mein-plugin'), 'mein-plugin.jar');
    assert.equal(pluginFileName(`${'a'.repeat(200)}.jar`, 'x').length, 94);
  });

  test('nicht erreichbar: 502 mit verständlicher Meldung', async () => {
    const modrinth = new Modrinth({ api: 'http://127.0.0.1:9', userAgent: 'test', timeoutMs: 2000 });
    await assert.rejects(modrinth.search('x', null, 0, 10), (err: unknown) => err instanceof HttpError && err.status === 502 && /Modrinth/.test(err.message));
  });

  test('Routen: Suche, Projekt, Versionen; eigene Grenze je Spieler; nur angemeldet', async () => {
    const t = await startHosting({ pluginSearchRateLimit: 2 });
    try {
      const anna = await devPlayer(t.service.url, 'Anna');
      grantBeta(t.service, anna.uuid);
      let res = await api(t.service.url, 'GET', '/v1/hosting/plugins/search?q=perms&version=26.3', { token: anna.token });
      assert.deepEqual([res.status, res.body.hits[0].slug], [200, 'luckperms']);
      assert.equal((await api(t.service.url, 'GET', '/v1/hosting/plugins/search?version=../x', { token: anna.token })).status, 400);
      res = await api(t.service.url, 'GET', '/v1/hosting/plugins/search?q=x', { token: anna.token });
      assert.equal(res.status, 429);
      assert.equal((await api(t.service.url, 'GET', '/v1/hosting/plugins/search?q=x')).status, 401);
      res = await api(t.service.url, 'GET', '/v1/hosting/plugins/luckperms', { token: anna.token });
      assert.deepEqual([res.body.project, res.body.serverPlugin, res.body.license, res.body.url], ['AbCdEf12', true, 'MIT', 'https://modrinth.com/plugin/luckperms']);
      res = await api(t.service.url, 'GET', '/v1/hosting/plugins/luckperms/versions?version=26.3', { token: anna.token });
      assert.deepEqual(res.body.versions.map((v: { id: string }) => v.id), ['Ver00003', 'Ver00002', 'Ver00001']);
      assert.equal((await api(t.service.url, 'GET', '/v1/hosting/plugins/gibtsnicht', { token: anna.token })).status, 404);
    } finally {
      await t.close();
    }
  });
});
