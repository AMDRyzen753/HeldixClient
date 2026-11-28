// Cosmetics-Katalog über HTTP: veröffentlichen (signierter Umschlag, nur Admin, 503 ohne Schlüssel), Liste und
// Umschlag mit ETag und immutable-Cache, wählen je Slot (Team-only, eingebaute und Katalog-Capes), Nachschlagen
// (sichtbar, ausgeblendet, gelöscht, Team verlassen), Träger zählen und zurücksetzen, Protokoll, Datenauskunft und
// Konto löschen.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ADDON_SIGNATURE_PREFIX } from '../src/addons';
import { Cosmetics } from '../src/cosmetics';
import { COSMETIC_SIGNATURE_PREFIX, encodeUint16LE, type CosmeticSlot } from '../src/cosmetics-format';
import { Store } from '../src/db';
import { DEFAULT_CAPES } from '../src/validate';
import { DATE, dataUrl, makePng, manifestOf, signCosmetic, VALID, valid2 } from './cosmetic-fixtures';
import { api, connect, devPlayer, rawRequest, startService, type Player, type TestService, type WsClient } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

const NO_COSMETIC = 'Dieses Cosmetic gibt es nicht.';
const TEAM_ONLY = 'Dieses Cosmetic gibt es nur für das HeldixClient-Team.';
const WRONG_SIGNATURE = 'Die Signatur stimmt nicht.';
const NONE = { head: null, back: null, aura: null, companion: null };
const NONE_ME = { ...NONE, cape: null, team: false, unlocked: [] };
const SLOTS: CosmeticSlot[] = ['head', 'back', 'aura', 'companion', 'cape'];
const LIST_KEYS = ['access', 'date', 'description', 'format', 'id', 'name', 'sha256', 'size', 'slot', 'version'];
// ab 1.14.0 dazu manifestAccess (Zugang im signierten Manifest; access ist bei Belohnungen von Partnern "partner")
const TEAM_KEYS = ['access', 'createdAt', 'date', 'description', 'format', 'hidden', 'id', 'manifestAccess', 'name', 'publishedAt', 'publishedBy', 'sha256', 'size', 'slot', 'version', 'wearers'];

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

describe('Cosmetics-Katalog', () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  const otherKeys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  let service: TestService;
  let cookie: string;
  let modCookie: string;
  let chefin: Player;
  let mod: Player;
  let anna: Player;
  let ben: Player;
  const clients: WsClient[] = [];
  const published = {} as Record<CosmeticSlot, { manifest: string; signature: string }>;

  const publish = (body: unknown, as = cookie) => webApi(service, 'PUT', '/v1/team/cosmetics', { cookie: as, body });
  const publishSigned = (manifest: Record<string, unknown>) => publish(signCosmetic(keys.privateKey, manifest));
  const overview = async () => (await webApi(service, 'GET', '/v1/team/cosmetics', { cookie })).body;
  const entry = async (id: string) => (await overview()).cosmetics.find((c: { id: string }) => c.id === id);
  const catalog = async () => (await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics as { id: string; version: number; sha256: string; size: number }[];
  const mine = async (player: Player) => (await api(service.url, 'GET', '/v1/me/cosmetics', { token: player.token })).body;
  const me = async (player: Player) => (await api(service.url, 'GET', '/v1/me', { token: player.token })).body;
  const choose = (player: Player, slot: string, id: unknown) => api(service.url, 'PUT', '/v1/me/cosmetics', { token: player.token, body: { slot, id } });
  const hide = (id: string, hidden: unknown) => webApi(service, 'PATCH', `/v1/team/cosmetics/${id}`, { cookie, body: { hidden } });
  const lookup = async (who: Player[]) =>
    (await api(service.url, 'POST', '/v1/players/lookup', { token: ben.token, body: { uuids: who.map((p) => p.uuid) } })).body.players;
  const exported = async (player: Player) =>
    JSON.parse((await rawRequest(service.url, 'GET', '/v1/me/export', { Authorization: `Bearer ${player.token}` })).body.toString('utf8'));
  const audit = async () =>
    ((await webApi(service, 'GET', '/v1/team/audit', { cookie })).body.entries as { action: string; target: string; detail: string | null }[]).map(
      (e) => `${e.action} ${e.target} | ${e.detail}`,
    );
  const status = async () => (await api(service.url, 'GET', '/v1/status')).body.cosmetics as number;

  before(async () => {
    service = await startService({
      dev: true,
      website: WEBSITE,
      totpNow: clock.read,
      updateKey: publicKey,
      capes: [...DEFAULT_CAPES, 'extra'],
    });
    chefin = await devPlayer(service.url, 'Chefin');
    cookie = (await teamLogin(service, chefin, 'admin', clock)).cookie;
    mod = await devPlayer(service.url, 'Moderator');
    modCookie = (await teamLogin(service, mod, 'moderator', clock)).cookie;
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
  });
  after(async () => {
    for (const client of clients) await client.close();
    await service.close();
  });

  test('leerer Katalog: Liste mit ETag, 404 mit CORS, Status, Team-Übersicht, nur Admins', async () => {
    const res = await api(service.url, 'GET', '/v1/cosmetics');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { cosmetics: [] });
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const etag = res.headers.get('etag')!;
    assert.match(etag, /^"[0-9a-f]{32}"$/);
    const cached = await rawRequest(service.url, 'GET', '/v1/cosmetics', { 'If-None-Match': etag });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    assert.equal(cached.headers.etag, etag);
    assert.equal((await rawRequest(service.url, 'GET', '/v1/cosmetics', { 'If-None-Match': `W/${etag}, "anders"` })).status, 304);
    assert.equal((await rawRequest(service.url, 'GET', '/v1/cosmetics', { 'If-None-Match': '"anders"' })).status, 200);

    for (const p of ['/v1/cosmetics/krone', '/v1/cosmetics/KRONE', '/v1/cosmetics/kr%C3%B6ne']) {
      const missing = await rawRequest(service.url, 'GET', p);
      assert.equal(missing.status, 404, p);
      assert.equal(missing.headers['access-control-allow-origin'], '*', p);
    }
    assert.deepEqual((await api(service.url, 'GET', '/v1/cosmetics/krone')).body, { error: NO_COSMETIC });
    assert.equal((await api(service.url, 'POST', '/v1/cosmetics')).status, 405);
    assert.equal(await status(), 0);

    const view = await webApi(service, 'GET', '/v1/team/cosmetics', { cookie });
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.deepEqual(view.body, { cosmetics: [], keyConfigured: true, publicKey });
    // Moderatoren dürfen nichts davon (wie bei Addons), ohne Cookie gar nichts
    for (const [method, p] of [
      ['GET', '/v1/team/cosmetics'],
      ['PUT', '/v1/team/cosmetics'],
      ['GET', '/v1/team/cosmetics/krone'],
      ['PATCH', '/v1/team/cosmetics/krone'],
      ['DELETE', '/v1/team/cosmetics/krone'],
    ] as const) {
      const denied = await webApi(service, method, p, { cookie: modCookie, body: method === 'GET' ? undefined : signCosmetic(keys.privateKey, VALID.head()) });
      assert.equal(denied.status, 403, `${method} ${p}`);
      assert.equal(denied.body.code, 'forbidden');
      assert.equal((await api(service.url, method, p, { token: chefin.token })).status, 401, `${method} ${p} mit Bearer`);
    }

    // Spieler: nichts gewählt; angemeldet, ohne CORS
    const own = await api(service.url, 'GET', '/v1/me/cosmetics', { token: anna.token });
    assert.equal(own.status, 200);
    assert.deepEqual(own.body, NONE_ME);
    assert.equal(own.headers.get('access-control-allow-origin'), null);
    assert.equal((await api(service.url, 'GET', '/v1/me/cosmetics')).status, 401);
    assert.equal((await api(service.url, 'PUT', '/v1/me/cosmetics', { body: { slot: 'head', id: null } })).status, 401);
  });

  test('veröffentlichen in jedem Slot: Übersicht, Liste, Umschlag mit ETag und immutable über ?v=', async () => {
    for (const slot of SLOTS) {
      published[slot] = signCosmetic(keys.privateKey, VALID[slot]());
      const res = await publish(published[slot]);
      assert.equal(res.status, 200, `${slot}: ${JSON.stringify(res.body)}`);
    }
    const view = await overview();
    assert.deepEqual(
      view.cosmetics.map((c: Record<string, unknown>) => [c.id, c.slot, c.version, c.hidden, c.wearers, c.publishedBy, c.access]),
      [
        ['krone', 'head', 1, false, 0, 'Chefin', 'all'],
        ['engelsfluegel', 'back', 1, false, 0, 'Chefin', 'all'],
        ['funken', 'aura', 1, false, 0, 'Chefin', 'all'],
        ['drache', 'companion', 1, false, 0, 'Chefin', 'all'],
        ['sternenregen', 'cape', 1, false, 0, 'Chefin', 'all'],
      ],
    );
    assert.deepEqual(Object.keys(view.cosmetics[0]).sort(), TEAM_KEYS);
    assert.equal(view.cosmetics[0].createdAt, view.cosmetics[0].publishedAt);

    const list = await api(service.url, 'GET', '/v1/cosmetics');
    const cosmetics = list.body.cosmetics;
    assert.deepEqual(
      cosmetics.map((c: { id: string }) => c.id),
      ['krone', 'engelsfluegel', 'funken', 'drache', 'sternenregen'],
      'nach Slot, dann Name',
    );
    for (const c of cosmetics) assert.deepEqual(Object.keys(c).sort(), LIST_KEYS);
    const krone = cosmetics[0];
    assert.deepEqual([krone.name, krone.description, krone.access, krone.date, krone.version], ['Krone', 'Krone für HeldixClient', 'all', DATE, 1]);

    // Umschlag: genau die Bytes hinter sha256 und size
    const raw = await rawRequest(service.url, 'GET', '/v1/cosmetics/krone');
    assert.equal(raw.status, 200);
    const text = raw.body.toString('utf8');
    assert.equal(text, JSON.stringify(published.head));
    assert.equal(sha256(raw.body), krone.sha256);
    assert.equal(raw.body.length, krone.size);
    assert.equal(raw.headers.etag, `"${krone.sha256}"`);
    assert.equal(raw.headers['cache-control'], 'public, no-cache');
    assert.equal(raw.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(raw.headers['x-content-type-options'], 'nosniff');
    assert.equal(raw.headers['access-control-allow-origin'], '*');
    // So prüfen Spiel, Launcher und Webseite: Signatur über "heldix-cosmetic\n" + Manifest
    const envelope = JSON.parse(text);
    assert.ok(verify(null, Buffer.from(COSMETIC_SIGNATURE_PREFIX + envelope.manifest, 'utf8'), keys.publicKey, Buffer.from(envelope.signature, 'base64')));
    // ?v=<sha256> der aktuellen Version: für immer im Cache; ein anderes v: wie ohne
    const pinned = await rawRequest(service.url, 'GET', `/v1/cosmetics/krone?v=${krone.sha256}`);
    assert.equal(pinned.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.deepEqual(pinned.body, raw.body);
    const other = await rawRequest(service.url, 'GET', `/v1/cosmetics/krone?v=${'0'.repeat(64)}`);
    assert.equal(other.headers['cache-control'], 'public, no-cache');
    assert.deepEqual(other.body, raw.body);
    const notModified = await rawRequest(service.url, 'GET', '/v1/cosmetics/krone', { 'If-None-Match': `"${krone.sha256}"` });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.body.length, 0);
    for (const c of cosmetics) {
      const env = await rawRequest(service.url, 'GET', `/v1/cosmetics/${c.id}`);
      assert.equal(sha256(env.body), c.sha256, c.id);
    }
    // Die Team-Ansicht liefert den Umschlag auch (für die Vorschau, auch ausgeblendete)
    const detail = await webApi(service, 'GET', '/v1/team/cosmetics/krone', { cookie });
    assert.equal(detail.status, 200);
    assert.deepEqual(Object.keys(detail.body).sort(), ['cosmetic', 'manifest', 'signature']);
    assert.deepEqual({ manifest: detail.body.manifest, signature: detail.body.signature }, published.head);
    assert.equal(detail.body.cosmetic.id, 'krone');
    assert.equal((await webApi(service, 'GET', '/v1/team/cosmetics/gibtsnicht', { cookie })).status, 404);

    assert.equal(await status(), 5);
    assert.ok((await audit()).includes('cosmetic.publish krone 1 | head, neu'));
  });

  test('Signatur, Domänentrennung zu Addons und Updates, Form und Grenzen', async () => {
    const count = (await overview()).cosmetics.length;
    const manifest = manifestOf('head', { id: 'neu', name: 'Neu' });
    const text = JSON.stringify(manifest);
    const expectError = async (body: unknown, status: number, error: string | RegExp) => {
      const res = await publish(body);
      assert.equal(res.status, status, JSON.stringify(res.body));
      if (typeof error === 'string') assert.equal(res.body.error, error);
      else assert.match(res.body.error, error);
    };
    // falscher Schlüssel, wie ein Launcher-Update (ohne Präfix), wie ein Addon (Präfix heldix-addon)
    await expectError(signCosmetic(otherKeys.privateKey, manifest), 400, WRONG_SIGNATURE);
    await expectError({ manifest: text, signature: sign(null, Buffer.from(text), keys.privateKey).toString('base64') }, 400, WRONG_SIGNATURE);
    await expectError({ manifest: text, signature: sign(null, Buffer.from(ADDON_SIGNATURE_PREFIX + text), keys.privateKey).toString('base64') }, 400, WRONG_SIGNATURE);
    // ein Addon-Manifest, als Cosmetic signiert: falscher type
    const addon = JSON.stringify({ type: 'heldix-addon', id: 'uhrzeit', name: 'Uhrzeit', version: '1.0.0' });
    await expectError(signCosmetic(keys.privateKey, addon), 400, 'Ungültiges Cosmetic-Manifest: „type“ muss „heldix-cosmetic“ sein.');
    // und umgekehrt: ein Cosmetic-Umschlag ist nie ein gültiges Addon
    const asAddon = await webApi(service, 'PUT', '/v1/team/addons/manifest', { cookie, body: signCosmetic(keys.privateKey, manifest) });
    assert.equal(asAddon.status, 400);
    assert.equal(asAddon.body.error, WRONG_SIGNATURE);
    // Form
    await expectError({}, 400, 'Ungültiger Cosmetic-Umschlag: „manifest“ fehlt oder ist kein Text.');
    await expectError({ manifest: text }, 400, 'Ungültiger Cosmetic-Umschlag: „signature“ fehlt oder ist kein Text.');
    await expectError({ manifest: text, signature: 'abc' }, 400, 'Ungültiger Cosmetic-Umschlag: „signature“ muss eine Ed25519-Signatur als Base64 sein (88 Zeichen).');
    await expectError(signCosmetic(keys.privateKey, '{kaputt'), 400, 'Ungültiges Cosmetic-Manifest: „manifest“ ist kein gültiges JSON.');
    await expectError(signCosmetic(keys.privateKey, manifestOf('head', { id: 'neu', name: 'x'.repeat(41) })), 400, 'Ungültiges Cosmetic-Manifest: „name“ ist zu lang (höchstens 40 Zeichen).');
    await expectError(signCosmetic(keys.privateKey, manifestOf('aura', { id: 'neu', model: VALID.head().model })), 400, 'Ungültiges Cosmetic-Manifest: „model“ gibt es beim Slot aura nicht.');
    // Grenzen: Körper über 544 KB (413, größte Grenze aller Formate), Manifest über 512 KB (400), Format 1 über 160 KB (400)
    const tooBig = await webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, rawBody: JSON.stringify({ manifest: 'a'.repeat(550 * 1024), signature: 'x' }) });
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.error, 'Die Anfrage ist zu groß (höchstens 544 KB).');
    await expectError(signCosmetic(keys.privateKey, 'a'.repeat(513 * 1024)), 400, 'Ungültiger Cosmetic-Umschlag: „manifest“ ist zu groß (höchstens 512 KB).');
    const padded = `${text.slice(0, -1)}${' '.repeat(161 * 1024)}}`;
    await expectError(signCosmetic(keys.privateKey, padded), 400, 'Ungültiges Cosmetic-Manifest: „manifest“ ist zu groß (höchstens 160 KB bei Format 1).');
    // IDs eingebauter Capes: die Liste im Format (400) und HELDIX_DIENST_CAPES des Servers (409)
    await expectError(signCosmetic(keys.privateKey, manifestOf('cape', { id: 'glut' })), 400, /eingebauten Capes/);
    await expectError(signCosmetic(keys.privateKey, manifestOf('cape', { id: 'extra' })), 409, 'Die ID „extra“ gehört schon einem eingebauten Cape.');

    assert.equal((await overview()).cosmetics.length, count, 'nichts veröffentlicht');
    assert.equal((await audit()).filter((line) => line.includes('cosmetic.publish neu')).length, 0);
  });

  test('neue Version: höher als die vorhandene, gleicher Slot; Umschlag und sha256 wechseln', async () => {
    const [before] = (await catalog()).filter((c) => c.id === 'krone');
    const entryBefore = await entry('krone');
    let res = await publish(published.head);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Die Version 1 ist nicht höher als die vorhandene (1).');

    res = await publishSigned(manifestOf('head', { version: 2, name: 'Goldkrone' }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await entry('krone');
    assert.deepEqual([after.version, after.name, after.createdAt], [2, 'Goldkrone', entryBefore.createdAt]);
    assert.ok(after.publishedAt >= entryBefore.publishedAt);
    const [listed] = (await catalog()).filter((c) => c.id === 'krone');
    assert.equal(listed!.version, 2);
    assert.notEqual(listed!.sha256, before!.sha256);
    // Die alte Adresse mit ?v= liefert jetzt den neuen Inhalt, aber nicht mehr als immutable
    const old = await rawRequest(service.url, 'GET', `/v1/cosmetics/krone?v=${before!.sha256}`);
    assert.equal(old.headers['cache-control'], 'public, no-cache');
    assert.equal(sha256(old.body), listed!.sha256);

    res = await publishSigned(manifestOf('head', { version: 1, name: 'Zurück' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'Die Version 1 ist nicht höher als die vorhandene (2).');
    res = await publishSigned(manifestOf('back', { id: 'krone', version: 3 }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error, '„krone“ gehört zum Slot head; der Slot lässt sich nicht ändern (neue ID nehmen).');
    assert.ok((await audit()).includes('cosmetic.publish krone 2 | head, vorher Version 1'));
  });

  test('Spieler wählen: Slot passt, eingebaute und Katalog-Capes (auch über PUT /v1/me), Team-only, ablegen, Webseite', async () => {
    let res = await choose(anna, 'head', 'krone');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ...NONE_ME, head: 'krone' });
    res = await choose(anna, 'back', 'krone');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, '„krone“ ist kein Cosmetic für den Slot back (sondern für head).');
    for (const id of ['gibtsnicht', 'GROSS', 'glut']) {
      res = await choose(anna, 'head', id);
      assert.equal(res.status, 404, id);
      assert.equal(res.body.error, NO_COSMETIC);
    }
    res = await choose(anna, 'hand', 'krone');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, '„slot“ muss eins von head, back, aura, companion, cape sein.');
    for (const body of [{ slot: 'head' }, { slot: 'head', id: 5 }, { slot: 'head', id: ['krone'] }]) {
      res = await api(service.url, 'PUT', '/v1/me/cosmetics', { token: anna.token, body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error, '„id“ muss die ID eines Cosmetics sein oder null (ablegen).');
    }

    // Cape-Slot: eingebaute Capes (auch aus HELDIX_DIENST_CAPES) und Katalog-Capes
    for (const cape of ['glut', 'extra', 'sternenregen']) {
      res = await choose(anna, 'cape', cape);
      assert.equal(res.status, 200, cape);
      assert.equal(res.body.cape, cape);
      assert.equal((await me(anna)).cape, cape);
    }
    // PUT /v1/me nimmt Katalog-Capes genauso, aber keine anderen Slots
    for (const cape of ['krone', 'gibtsnicht', 5]) {
      res = await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { cape } });
      assert.equal(res.status, 400, String(cape));
      assert.equal(res.body.error, 'Unbekanntes Cape.');
    }
    res = await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { cape: 'glut' } });
    assert.equal(res.body.cape, 'glut');
    res = await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { cape: 'sternenregen' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.cape, 'sternenregen');
    assert.equal((await mine(anna)).cape, 'sternenregen');

    for (const [slot, id] of [
      ['back', 'engelsfluegel'],
      ['aura', 'funken'],
      ['companion', 'drache'],
    ]) {
      assert.equal((await choose(anna, slot!, id)).status, 200);
    }
    assert.deepEqual(await mine(anna), { head: 'krone', back: 'engelsfluegel', aura: 'funken', companion: 'drache', cape: 'sternenregen', team: false, unlocked: [] });

    // Nur fürs Team: Spieler 403, jede Team-Rolle darf
    assert.equal((await publishSigned(manifestOf('head', { id: 'team-krone', name: 'Team-Krone', access: 'team' }))).status, 200);
    assert.equal((await publishSigned(manifestOf('cape', { id: 'team-cape', name: 'Team-Cape', access: 'team' }))).status, 200);
    for (const attempt of [choose(ben, 'head', 'team-krone'), choose(ben, 'cape', 'team-cape'), api(service.url, 'PUT', '/v1/me', { token: ben.token, body: { cape: 'team-cape' } })]) {
      res = await attempt;
      assert.equal(res.status, 403);
      assert.equal(res.body.error, TEAM_ONLY);
    }
    assert.deepEqual(await mine(ben), NONE_ME);
    assert.equal((await choose(mod, 'head', 'team-krone')).status, 200);
    assert.equal((await choose(mod, 'cape', 'team-cape')).status, 200);
    assert.deepEqual(await mine(mod), { ...NONE_ME, head: 'team-krone', cape: 'team-cape', team: true });

    // ablegen: null oder ""
    assert.equal((await choose(ben, 'aura', 'funken')).body.aura, 'funken');
    assert.deepEqual((await choose(ben, 'aura', null)).body, NONE_ME);
    assert.equal((await choose(ben, 'aura', 'funken')).body.aura, 'funken');
    assert.deepEqual((await choose(ben, 'aura', '')).body, NONE_ME);

    // Webseite: Cookie, ändern nur mit CSRF-Header
    const { cookie: annaCookie } = await webLogin(service, anna);
    const web = await webApi(service, 'GET', '/v1/me/cosmetics', { cookie: annaCookie });
    assert.equal(web.status, 200);
    assert.deepEqual(web.body, await mine(anna));
    assert.equal((await webApi(service, 'PUT', '/v1/me/cosmetics', { cookie: annaCookie, csrf: false, body: { slot: 'aura', id: null } })).status, 403);
    assert.equal((await mine(anna)).aura, 'funken');
    const changed = await webApi(service, 'PUT', '/v1/me/cosmetics', { cookie: annaCookie, body: { slot: 'aura', id: 'funken' } });
    assert.equal(changed.status, 200);
  });

  test('Nachschlagen: alle Slots, ausgeblendet (Auswahl bleibt), Team verlassen, „Für andere erkennbar“', async () => {
    for (const player of [anna, mod, ben]) clients.push((await connect(service.wsUrl, player.token)).client);
    let players = await lookup([anna, mod, ben]);
    assert.deepEqual(players[anna.uuid], {
      cape: 'sternenregen',
      badge: null,
      cosmetics: { head: 'krone', back: 'engelsfluegel', aura: 'funken', companion: 'drache' },
    });
    assert.deepEqual(players[mod.uuid], { cape: 'team-cape', badge: null, cosmetics: { ...NONE, head: 'team-krone' } });
    assert.deepEqual(players[ben.uuid], { cape: '', badge: null, cosmetics: NONE });

    // Ausblenden: niemand sieht es mehr, wählen geht nicht, die Auswahl bleibt gespeichert
    let res = await hide('krone', true);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.cosmetics.filter((c: { id: string }) => c.id === 'krone').map((c: { hidden: boolean; wearers: number }) => [c.hidden, c.wearers]),
      [[true, 1]],
    );
    assert.equal((await lookup([anna]))[anna.uuid].cosmetics.head, null);
    assert.equal((await mine(anna)).head, null);
    assert.equal((await exported(anna)).cosmetics.head, 'krone');
    assert.equal((await catalog()).some((c) => c.id === 'krone'), false);
    assert.equal((await api(service.url, 'GET', '/v1/cosmetics/krone')).status, 404);
    assert.equal((await webApi(service, 'GET', '/v1/team/cosmetics/krone', { cookie })).status, 200, 'das Team sieht es weiter');
    assert.equal((await choose(ben, 'head', 'krone')).status, 404);
    assert.equal(await status(), 6);
    // Noch einmal ausblenden ändert nichts (kein zweiter Eintrag im Protokoll)
    assert.equal((await hide('krone', true)).status, 200);
    // Wieder zeigen: die Auswahl ist noch da
    assert.equal((await hide('krone', false)).status, 200);
    assert.equal((await lookup([anna]))[anna.uuid].cosmetics.head, 'krone');
    assert.equal((await mine(anna)).head, 'krone');
    assert.equal(await status(), 7);

    // Ein ausgeblendetes Katalog-Cape: Cape '' beim Nachschlagen und in /v1/me
    assert.equal((await hide('sternenregen', true)).status, 200);
    assert.equal((await lookup([anna]))[anna.uuid].cape, '');
    assert.equal((await me(anna)).cape, '');
    assert.equal((await mine(anna)).cape, null);
    assert.equal((await hide('sternenregen', false)).status, 200);
    assert.equal((await lookup([anna]))[anna.uuid].cape, 'sternenregen');

    // Fehler
    assert.equal((await hide('gibtsnicht', true)).status, 404);
    res = await hide('krone', 'ja');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, '„hidden“ muss true oder false sein.');

    // Wer das Team verlässt, trägt Team-only nicht mehr (Auswahl bleibt; wieder im Team: wieder sichtbar)
    assert.equal((await webApi(service, 'DELETE', `/v1/team/members/${mod.uuid}`, { cookie })).status, 200);
    players = await lookup([mod]);
    assert.deepEqual(players[mod.uuid], { cape: '', badge: null, cosmetics: NONE });
    assert.deepEqual(await mine(mod), NONE_ME);
    assert.equal((await me(mod)).cape, '');
    assert.equal((await webApi(service, 'POST', '/v1/team/members', { cookie, body: { uuid: mod.uuid, role: 'moderator' } })).status, 200);
    assert.deepEqual((await lookup([mod]))[mod.uuid].cosmetics, { ...NONE, head: 'team-krone' });

    // „Für andere erkennbar“ aus: gar nicht in der Antwort
    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { visible: false } });
    assert.deepEqual(await lookup([anna]), {});
    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { visible: true } });
    assert.equal((await lookup([anna]))[anna.uuid].cosmetics.head, 'krone');

    const lines = await audit();
    assert.equal(lines.filter((line) => line === 'cosmetic.hide krone | null').length, 1);
    assert.ok(lines.includes('cosmetic.show krone | null'));
    assert.ok(lines.includes('cosmetic.hide sternenregen | null'));
  });

  test('löschen: Träger werden zurückgesetzt, eine neue Veröffentlichung gibt ihnen nichts zurück', async () => {
    assert.equal((await choose(ben, 'cape', 'glut')).status, 200);
    assert.deepEqual([(await entry('krone')).wearers, (await entry('sternenregen')).wearers, (await entry('team-krone')).wearers], [1, 1, 1]);
    let res = await webApi(service, 'DELETE', '/v1/team/cosmetics/krone', { cookie });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.cosmetics.some((c: { id: string }) => c.id === 'krone'), false);
    assert.equal((await mine(anna)).head, null);
    assert.equal((await exported(anna)).cosmetics.head, null, 'auch gespeichert zurückgesetzt');
    assert.equal((await api(service.url, 'GET', '/v1/cosmetics/krone')).status, 404);
    // Die ID ist wieder frei (auch mit Version 1); wer sie trug, trägt sie nicht wieder
    res = await publishSigned(VALID.head());
    assert.equal(res.status, 200);
    assert.equal((await mine(anna)).head, null);
    assert.equal((await entry('krone')).wearers, 0);

    // Katalog-Cape löschen: Cape zurück auf keins; eingebaute Capes anderer bleiben
    res = await webApi(service, 'DELETE', '/v1/team/cosmetics/sternenregen', { cookie });
    assert.equal(res.status, 200);
    assert.equal((await me(anna)).cape, '');
    assert.equal((await mine(ben)).cape, 'glut');
    assert.equal((await lookup([ben]))[ben.uuid].cape, 'glut');
    for (const id of ['gibtsnicht', 'GROSS', 'sternenregen']) assert.equal((await webApi(service, 'DELETE', `/v1/team/cosmetics/${id}`, { cookie })).status, 404, id);

    const lines = await audit();
    assert.ok(lines.includes('cosmetic.delete krone 2 | head, 1 Träger zurückgesetzt'));
    assert.ok(lines.includes('cosmetic.delete sternenregen 1 | cape, 1 Träger zurückgesetzt'));
    assert.ok(lines.includes('cosmetic.publish krone 1 | head, neu'));
  });

  test('Datenauskunft enthält die Auswahl, Konto löschen entfernt sie', async () => {
    assert.equal((await choose(anna, 'head', 'krone')).status, 200);
    let data = await exported(anna);
    assert.deepEqual(data.cosmetics, { head: 'krone', back: 'engelsfluegel', aura: 'funken', companion: 'drache', cape: null });
    // Ausgeblendetes steht weiter in der Auskunft (gespeichert ist es ja)
    await hide('engelsfluegel', true);
    data = await exported(anna);
    assert.equal(data.cosmetics.back, 'engelsfluegel');
    assert.equal((await mine(anna)).back, null);
    await hide('engelsfluegel', false);
    assert.equal(/[0-9a-f]{64}/.test(JSON.stringify(data)), false, 'kein Hash in der Auskunft');

    assert.deepEqual([(await entry('drache')).wearers, (await entry('krone')).wearers], [1, 1]);
    const res = await api(service.url, 'DELETE', '/v1/me', { token: anna.token });
    assert.equal(res.status, 200);
    assert.deepEqual([(await entry('drache')).wearers, (await entry('krone')).wearers, (await entry('funken')).wearers], [0, 0, 0]);
    // Neu angemeldet: nichts gewählt
    const again = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Anna', uuid: anna.uuid } });
    assert.equal(again.status, 200);
    assert.deepEqual((await api(service.url, 'GET', '/v1/me/cosmetics', { token: again.body.token })).body, NONE_ME);
  });
});

test('ohne Update-Schlüssel: 503 beim Veröffentlichen, Übersicht ohne Schlüssel', async () => {
  const clock = new Clock();
  const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const keys = generateKeyPairSync('ed25519');
    const res = await webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, body: signCosmetic(keys.privateKey, VALID.head()) });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Auf diesem Server ist kein Update-Schlüssel eingerichtet. Cosmetics lassen sich hier nicht veröffentlichen.');
    assert.deepEqual((await webApi(service, 'GET', '/v1/team/cosmetics', { cookie })).body, { cosmetics: [], keyConfigured: false, publicKey: null });
  } finally {
    await service.close();
  }
});

test('Umschläge: höchstens N pro Minute und IP (hier 2), die Liste zählt nicht mit', async () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  const service = await startService({
    dev: true,
    website: WEBSITE,
    totpNow: clock.read,
    updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    cosmeticRateLimit: 2,
  });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    assert.equal((await webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, body: signCosmetic(keys.privateKey, VALID.aura()) })).status, 200);
    assert.equal((await api(service.url, 'GET', '/v1/cosmetics/funken')).status, 200);
    assert.equal((await api(service.url, 'GET', '/v1/cosmetics/funken')).status, 200);
    const limited = await api(service.url, 'GET', '/v1/cosmetics/funken');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal((await api(service.url, 'GET', '/v1/cosmetics')).status, 200);

    // Ein großes Cape (256 breit, 24 Bilder, mit glow) passt in die Grenzen des Umschlags
    const hd = manifestOf('cape', {
      id: 'hd-cape',
      texture: dataUrl(makePng(256, 128 * 24)),
      glow: dataUrl(makePng(256, 128 * 24)),
      cape: { frames: 24, fps: 12 },
    });
    const res = await webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, body: signCosmetic(keys.privateKey, hd) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const listed = (await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics.find((c: { id: string }) => c.id === 'hd-cape');
    assert.ok(listed && listed.size <= 192 * 1024);
  } finally {
    await service.close();
  }
});

test('Format 2: veröffentlichen bis 512 KB, Liste und Team-Übersicht mit format, Format-1-Umschläge unverändert', async () => {
  const clock = new Clock();
  const keys = generateKeyPairSync('ed25519');
  const service = await startService({
    dev: true,
    website: WEBSITE,
    totpNow: clock.read,
    updateKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  try {
    const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
    const publish = (body: unknown) => webApi(service, 'PUT', '/v1/team/cosmetics', { cookie, body });
    const oldEnvelope = signCosmetic(keys.privateKey, VALID.back());
    assert.equal((await publish(oldEnvelope)).status, 200);
    // Ein Mesh-Cosmetic mit Leerraum auf 400 KB gebracht: größer als Format 1 je erlaubt, für Format 2 in Ordnung
    const text = JSON.stringify(valid2('companion'));
    const big = `${text.slice(0, -1)}${' '.repeat(400 * 1024 - Buffer.byteLength(text))}}`;
    const res = await publish(signCosmetic(keys.privateKey, big));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.cosmetics.map((c: { id: string; format: number }) => [c.id, c.format]),
      [['engelsfluegel', 1], ['mesh-companion', 2]],
    );

    const list = (await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics as { id: string; format: number; size: number; sha256: string }[];
    assert.deepEqual(list.map((c) => [c.id, c.format]), [['engelsfluegel', 1], ['mesh-companion', 2]]);
    assert.ok(list[1]!.size > 400 * 1024 && list[1]!.size <= 544 * 1024);
    const team = (await webApi(service, 'GET', '/v1/team/cosmetics', { cookie })).body.cosmetics as { id: string; format: number }[];
    assert.deepEqual(team.map((c) => [c.id, c.format]), [['engelsfluegel', 1], ['mesh-companion', 2]]);

    // Format 1: Bytes genau wie früher (ältere Clients prüfen sie unverändert), höchstens 192 KB
    const raw = await rawRequest(service.url, 'GET', '/v1/cosmetics/engelsfluegel');
    assert.equal(raw.body.toString('utf8'), JSON.stringify(oldEnvelope));
    assert.ok(raw.body.length <= 192 * 1024);
    const mesh = await rawRequest(service.url, 'GET', '/v1/cosmetics/mesh-companion');
    assert.equal(sha256(mesh.body), list[1]!.sha256);
    assert.equal(JSON.parse(mesh.body.toString('utf8')).manifest, big);

    // Neue Version: Das Format darf wechseln, die Liste folgt (Zwischenspeicher je sha256)
    const smaller = { ...valid2('companion'), version: 2 };
    assert.equal((await publish(signCosmetic(keys.privateKey, smaller))).status, 200);
    const after = (await api(service.url, 'GET', '/v1/cosmetics')).body.cosmetics as { id: string; format: number; version: number }[];
    assert.deepEqual(after.map((c) => [c.id, c.format, c.version]), [['engelsfluegel', 1, 1], ['mesh-companion', 2, 2]]);

    // Fehler im Mesh: 400 mit dem Hinweis des Prüfers
    const broken = structuredClone(valid2('back')) as Record<string, any>;
    broken.mesh.triangles = encodeUint16LE([0, 1, 2, 0, 2, 9]);
    const rejected = await publish(signCosmetic(keys.privateKey, broken));
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'Ungültiges Cosmetic-Manifest: „mesh.triangles“: Dreieck 1 nennt den Vertex 9, es gibt nur 4 (0 bis 3).');

    // Wählen geht wie bei Format 1
    const anna = await devPlayer(service.url, 'Anna');
    const chosen = await api(service.url, 'PUT', '/v1/me/cosmetics', { token: anna.token, body: { slot: 'companion', id: 'mesh-companion' } });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.companion, 'mesh-companion');

    // Nach einem Neustart (frischer Zwischenspeicher) kommt das Format aus dem gespeicherten Manifest
    const store = new Store(service.dataDir);
    try {
      const fresh = JSON.parse(new Cosmetics(store, new Set(DEFAULT_CAPES), () => undefined).list().text).cosmetics as { id: string; format: number }[];
      assert.deepEqual(fresh.map((c) => [c.id, c.format]), [['engelsfluegel', 1], ['mesh-companion', 2]]);
    } finally {
      store.close();
    }
  } finally {
    await service.close();
  }
});
