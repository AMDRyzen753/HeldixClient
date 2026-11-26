// Prüft den Addon-Store als eigene Seite (core/addonstore.ts, core/storeservice.ts) gegen einen kleinen Fake-Dienst
// mit eigenem Test-Schlüssel: Manifest mit official/author (signiert), Übersicht über alle Instanzen, Bewertungen,
// Screenshots, Versionsverlauf, Melden, „Alle aktualisieren“, Entfernen und die Update-Prüfung im Hintergrund.
//
// Aufruf: npm run test:store

import AdmZip from 'adm-zip';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ADDON_SIGNATURE_PREFIX, currentPlatform, parseAddonManifest, uninstallStoreAddon, type OverviewInstance } from '../main/core/addonstore';
import { SocialClient } from '../main/core/social';
import { AddonStoreService, noticeList, type StoreNotice } from '../main/core/storeservice';
import { check, encodePng, finish, rejects, skinPixels } from './testkit';

interface FakeAddon {
  id: string;
  name: string;
  version: string;
  official: boolean;
  author: { uuid: string; name: string } | null;
  platforms: string[];
  jar: Buffer;
  rating: { average: number; count: number };
  screenshots: number;
  screenshotsVersion: string;
  /** unsignierte Felder, die etwas anderes behaupten (dürfen nicht zählen) */
  lie?: boolean;
  badSignature?: boolean;
}

function addonJar(id: string, version: string, name: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('heldix.addon.json', Buffer.from(JSON.stringify({ id, name, version, api: 1, entrypoint: 'test.Main', description: `${name} zum Testen` })));
  zip.addFile('test/Main.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  return zip.toBuffer();
}

function manifestOf(addon: FakeAddon): Record<string, unknown> {
  return {
    type: 'heldix-addon',
    id: addon.id,
    name: addon.name,
    version: addon.version,
    summary: `${addon.name} zum Testen`,
    description: 'Absatz eins.\n\n- Punkt',
    authors: ['Team'],
    api: 1,
    icon: 'music',
    category: 'musik',
    platforms: addon.platforms,
    file: `heldix-addon-${addon.id}-${addon.version}.jar`,
    size: addon.jar.length,
    sha256: createHash('sha256').update(addon.jar).digest('hex'),
    date: '2026-11-26',
    notes: ['Neu: Test'],
    official: addon.official,
    author: addon.author,
  };
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-store-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const other: KeyObject = generateKeyPairSync('ed25519').privateKey;
  const png = encodePng(320, 180, Buffer.alloc(320 * 180 * 4, 200));
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1), Buffer.from([0xff, 0xd9])]);
  const elsewhere = (['windows', 'mac', 'linux'] as const).find((p) => p !== currentPlatform())!;

  const addons: FakeAddon[] = [
    { id: 'spotify', name: 'Spotify', version: '1.1.0', official: true, author: null, platforms: [], jar: addonJar('spotify', '1.1.0', 'Spotify'), rating: { average: 4.44, count: 9 }, screenshots: 2, screenshotsVersion: 'v1' },
    { id: 'chatplus', name: 'Chat Plus', version: '2.0.0', official: false, author: { uuid: 'c'.repeat(32), name: 'Bastler_1' }, platforms: [], jar: addonJar('chatplus', '2.0.0', 'Chat Plus'), rating: { average: 0, count: 0 }, screenshots: 0, screenshotsVersion: '', lie: true },
    { id: 'linuxonly', name: 'Nur Linux', version: '1.0.0', official: true, author: null, platforms: [elsewhere], jar: addonJar('linuxonly', '1.0.0', 'Nur Linux'), rating: { average: 3, count: 1 }, screenshots: 1, screenshotsVersion: 'a' },
    { id: 'falsch', name: 'Falsch signiert', version: '1.0.0', official: true, author: null, platforms: [], jar: addonJar('falsch', '1.0.0', 'Falsch'), rating: { average: 5, count: 1 }, screenshots: 0, screenshotsVersion: '', badSignature: true },
  ];
  const myRatings = new Map<string, number>([['spotify', 5]]);
  const reports: Record<string, unknown>[] = [];
  const requests: string[] = [];
  let screenshotType = 'image/png';
  let failRating = false;
  const tokens = new Set<string>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const route = `${req.method} ${url.pathname}`;
    requests.push(route);
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const authed = () => tokens.has((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (route === 'POST /v1/auth/dev') {
      const token = `tok-${tokens.size + 1}`;
      tokens.add(token);
      return json(200, { token, uuid: 'a'.repeat(32), name: 'Tester', expiresAt: Date.now() + 86_400_000 });
    }
    if (route === 'GET /v1/addons') {
      return json(200, {
        addons: addons.map((a) => {
          const manifest = JSON.stringify(manifestOf(a));
          const signature = sign(null, Buffer.from(ADDON_SIGNATURE_PREFIX + manifest, 'utf8'), a.badSignature ? other : privateKey).toString('base64');
          return { ...manifestOf(a), ...(a.lie ? { official: true, author: null } : {}), manifest, signature, downloads: 12, rating: a.rating, screenshots: a.screenshots, screenshotsVersion: a.screenshotsVersion };
        }),
      });
    }
    let m = /^GET \/v1\/addons\/([a-z0-9_-]+)$/.exec(route);
    if (m) {
      const addon = addons.find((a) => a.id === m![1]);
      if (!addon) return json(404, { error: 'Dieses Addon gibt es nicht.' });
      return json(200, { addon: manifestOf(addon), versions: [{ version: '1.0.0', date: '2026-10-01', notes: ['Erste Version'] }, { version: addon.version, date: '2026-11-26', notes: ['Neu: Test', 42] }, { version: 'kaputt' }] });
    }
    m = /^GET \/v1\/addons\/([a-z0-9_-]+)\/files\/(.+)$/.exec(route);
    if (m) {
      const addon = addons.find((a) => a.id === m![1] && `heldix-addon-${a.id}-${a.version}.jar` === m![2]);
      if (!addon) return json(404, { error: 'Diese Datei gibt es nicht.' });
      res.writeHead(200, { 'content-type': 'application/java-archive', 'content-length': addon.jar.length });
      res.end(addon.jar);
      return;
    }
    m = /^GET \/v1\/addons\/([a-z0-9_-]+)\/screenshots\/([1-4])$/.exec(route);
    if (m) {
      const addon = addons.find((a) => a.id === m![1]);
      if (!addon || Number(m[2]) > addon.screenshots) return json(404, { error: 'Kein Bild.' });
      const data = m[2] === '2' ? jpeg : screenshotType === 'huge' ? Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]) : png;
      res.writeHead(200, { 'content-type': m[2] === '2' ? 'image/jpeg' : screenshotType === 'huge' ? 'image/png' : screenshotType, 'content-length': data.length });
      res.end(data);
      return;
    }
    m = /^(GET|PUT|DELETE) \/v1\/addons\/([a-z0-9_-]+)\/rating$/.exec(route);
    if (m) {
      if (!authed()) return json(401, { error: 'Bitte anmelden.' });
      if (failRating) return json(500, { error: 'kaputt' });
      const id = m[2];
      if (id === 'chatplus' && m[1] === 'PUT') return json(403, { error: 'Eigene Addons kannst du nicht bewerten.' });
      if (m[1] === 'PUT') myRatings.set(id, Number((await body(req)).stars));
      if (m[1] === 'DELETE') myRatings.delete(id);
      return json(200, { myRating: myRatings.get(id) ?? null, average: 4.2, count: myRatings.has(id) ? 10 : 9 });
    }
    m = /^POST \/v1\/addons\/([a-z0-9_-]+)\/reports$/.exec(route);
    if (m) {
      if (!authed()) return json(401, { error: 'Bitte anmelden.' });
      reports.push({ id: m[1], ...(await body(req)) });
      return json(200, { reported: true });
    }
    json(404, { error: 'Nicht gefunden.' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // ---------- Manifest ----------
    const plain = manifestOf(addons[0]);
    check('Manifest: official und author übernommen', parseAddonManifest(plain).official === true && parseAddonManifest(plain).author === null);
    const community = parseAddonManifest(manifestOf(addons[1]));
    check('Manifest: Community-Addon mit Autor', community.official === false && community.author?.name === 'Bastler_1' && community.author.uuid === 'c'.repeat(32));
    const { official: _o, author: _a, ...old } = plain;
    check('altes Manifest ohne die Felder: Community, kein Autor', parseAddonManifest(old).official === false && parseAddonManifest(old).author === null);
    for (const [label, patch] of [
      ['official kein Wahrheitswert', { official: 'ja' }],
      ['author mit falscher UUID', { author: { uuid: 'xyz', name: 'Bastler' } }],
      ['author mit ungültigem Namen', { author: { uuid: 'c'.repeat(32), name: 'Leer zeichen' } }],
    ] as const) {
      try {
        parseAddonManifest({ ...plain, ...patch });
        check(`Manifest abgelehnt: ${label}`, false);
      } catch (error) {
        check(`Manifest abgelehnt: ${label}`, /official|author/.test((error as Error).message), error);
      }
    }

    // ---------- Instanzen ----------
    const dirs = { one: path.join(tmp, 'eins'), two: path.join(tmp, 'zwei') };
    await mkdir(path.join(dirs.one, 'heldix-addons'), { recursive: true });
    await mkdir(path.join(dirs.two, 'heldix-addons'), { recursive: true });
    await writeFile(path.join(dirs.one, 'heldix-addons', 'heldix-addon-spotify-1.0.0.jar'), addonJar('spotify', '1.0.0', 'Spotify'));
    await writeFile(path.join(dirs.one, 'heldix-addons', 'heldix-addon-chatplus-2.0.0.jar.disabled'), addonJar('chatplus', '2.0.0', 'Chat Plus'));
    await writeFile(path.join(dirs.one, 'heldix-addons', 'eigenes.jar'), addonJar('eigenes', '0.1.0', 'Eigenes'));
    const instances: OverviewInstance[] = [
      { id: 'eins', name: 'Eins', minecraft: '26.3', loader: 'heldix', dir: dirs.one },
      { id: 'zwei', name: 'Zwei', minecraft: '26.3', loader: 'fabric', dir: dirs.two },
    ];
    const busy = new Set<string>();
    let running = false;
    const settings = { addonUpdateNotifications: true, addonAutoUpdate: false };
    const counts: number[] = [];
    const notices: StoreNotice[] = [];
    const social = new SocialClient({ serviceUrl: base, devAuth: true, enabled: async () => false, account: async () => ({ id: 'ich', type: 'offline' as const, name: 'Tester', uuid: 'a'.repeat(32) }), accessToken: async () => '' });
    const storeService = (auth: SocialClient | null = social) =>
      new AddonStoreService({
        serviceUrl: base,
        publicKey: pem,
        instances: async () => instances,
        busy: (id) => busy.has(id),
        gameRunning: () => running,
        auth,
        settings: async () => settings,
        stateFile: path.join(tmp, 'addon-updates.json'),
        screenshotDir: path.join(tmp, 'screenshots'),
        onCount: (count) => counts.push(count),
        onNotice: (notice) => notices.push(notice),
      });
    const service = storeService();

    // ---------- Übersicht ----------
    const overview = await service.overview();
    const byId = new Map(overview.addons.map((a) => [a.id, a]));
    check('Übersicht: falsch signiertes Addon fehlt', overview.error === null && overview.addons.length === 3 && !byId.has('falsch'), overview.addons.map((a) => a.id));
    check('Übersicht: Instanzen ohne Spielordner', overview.instances.length === 2 && !('dir' in overview.instances[0]));
    const spotify = byId.get('spotify')!;
    check('Übersicht: offiziell, Bewertung gerundet, Screenshots', spotify.official && spotify.author === null && spotify.rating.average === 4.4 && spotify.rating.count === 9 && spotify.screenshots === 2, spotify);
    check('Übersicht: eigene Bewertung', spotify.myRating === 5 && byId.get('chatplus')?.myRating === null);
    check('Übersicht: Update in Eins, verfügbar in Zwei', spotify.installs.find((i) => i.instanceId === 'eins')?.state === 'update' && spotify.installs.find((i) => i.instanceId === 'eins')?.installedVersion === '1.0.0' && spotify.installs.find((i) => i.instanceId === 'zwei')?.state === 'available');
    const chat = byId.get('chatplus')!;
    check('Übersicht: Community/Autor nur aus dem signierten Manifest', !chat.official && chat.author?.name === 'Bastler_1', { official: chat.official, author: chat.author });
    check('Übersicht: ausgeschaltetes Addon zählt als installiert', chat.installs.find((i) => i.instanceId === 'eins')?.state === 'installed');
    check('Übersicht: läuft nicht auf diesem System', byId.get('linuxonly')?.problem?.startsWith('Nur für') === true && byId.get('linuxonly')?.installs.every((i) => i.state === 'unsupported-platform') === true);
    check('Abzeichen: 1 Addon mit Update', counts.at(-1) === 1 && service.updates === 1, counts);
    failRating = true;
    const withoutRatings = await storeService().overview();
    check('Bewertungen nicht ladbar: Übersicht trotzdem da', withoutRatings.error === null && withoutRatings.addons.every((a) => a.myRating === null), withoutRatings.error);
    failRating = false;
    const anonymous = await storeService(null).overview();
    check('ohne Anmeldung: keine eigenen Bewertungen, keine Anfrage dafür', anonymous.addons.every((a) => a.myRating === null));
    const down = await new AddonStoreService({ serviceUrl: 'http://127.0.0.1:1', publicKey: pem, instances: async () => instances, busy: () => false, gameRunning: () => false, auth: null, settings: async () => settings, stateFile: path.join(tmp, 'x.json'), screenshotDir: null }).overview();
    check('Store nicht erreichbar: Meldung, keine Addons', down.addons.length === 0 && /nicht erreichbar/.test(down.error ?? '') && down.instances.length === 2, down.error);

    // ---------- Versionsverlauf ----------
    const details = await service.details('spotify');
    check('Versionsverlauf: neueste zuerst, nur gültige', details.versions.map((v) => v.version).join() === '1.1.0,1.0.0' && details.versions[0].notes.join() === 'Neu: Test', details);
    await rejects('Versionsverlauf: unbekanntes Addon', () => service.details('gibtsnicht'), /gibt es nicht/);
    await rejects('Versionsverlauf: ungültige ID', () => service.details('../x'), /Ungültige Addon-ID/);

    // ---------- Screenshots ----------
    const shot = await service.screenshot('spotify', 1);
    check('Screenshot: PNG als data:-URL', shot === `data:image/png;base64,${png.toString('base64')}`, shot?.slice(0, 30));
    check('Screenshot: JPEG', (await service.screenshot('spotify', 2))?.startsWith('data:image/jpeg;base64,') === true);
    const before = requests.length;
    check('Screenshot: zwischengespeichert', (await service.screenshot('spotify', 1)) === shot && requests.length === before);
    check('Screenshot: auch als Datei', (await readdir(path.join(tmp, 'screenshots'))).includes('spotify.1.v1.img'));
    check('Screenshot: Nummer außerhalb', (await service.screenshot('spotify', 3)) === null && (await service.screenshot('spotify', 0)) === null && (await service.screenshot('spotify', 1.5)) === null);
    screenshotType = 'text/html';
    addons[2].screenshotsVersion = 'b';
    await service.overview();
    check('Screenshot: falscher Content-Type → null', (await service.screenshot('linuxonly', 1)) === null);
    screenshotType = 'huge';
    addons[2].screenshotsVersion = 'c';
    await service.overview();
    check('Screenshot: über 2 MiB → null', (await service.screenshot('linuxonly', 1)) === null);
    screenshotType = 'image/png';
    addons[0].screenshotsVersion = 'v2';
    await service.overview();
    const count = requests.length;
    await service.screenshot('spotify', 1);
    check('Screenshot: neue screenshotsVersion lädt neu, alte Datei weg', requests.length === count + 1 && !(await readdir(path.join(tmp, 'screenshots'))).includes('spotify.1.v1.img'));

    // ---------- Bewerten und Melden ----------
    let rating = await service.rate('linuxonly', 4);
    check('bewerten: 4 Sterne', rating.myRating === 4 && rating.count === 10 && rating.average === 4.2, rating);
    rating = await service.rate('linuxonly', null);
    check('Bewertung entfernen', rating.myRating === null && !myRatings.has('linuxonly'), rating);
    await rejects('ungültige Sterne', () => service.rate('spotify', 6), /1 bis 5 Sterne/);
    await rejects('eigenes Addon: Meldung des Dienstes', () => service.rate('chatplus', 5), /Eigene Addons/);
    const offlineAuth = new SocialClient({ serviceUrl: base, devAuth: false, enabled: async () => true, account: async () => ({ id: 'off', type: 'offline' as const, name: 'Off', uuid: 'b'.repeat(32) }), accessToken: async () => '' });
    await rejects('Offline-Konto: Bewerten nur mit Microsoft-Konto', () => storeService(offlineAuth).rate('spotify', 3), /nur mit einem Microsoft-Konto/);
    await service.report('chatplus', 'malware', '  sieht komisch aus  ');
    check('melden', JSON.stringify(reports.at(-1)) === JSON.stringify({ id: 'chatplus', reason: 'malware', note: 'sieht komisch aus' }), reports);
    await rejects('melden: ungültiger Grund', () => service.report('chatplus', 'langweilig'), /Grund/);
    await rejects('melden: Notiz zu lang', () => service.report('chatplus', 'other', 'x'.repeat(501)), /500/);

    // ---------- Prüfung im Hintergrund ----------
    await service.check();
    check('Prüfung: Benachrichtigung „verfügbar“', notices.length === 1 && notices[0].kind === 'available' && notices[0].items.map((i) => `${i.addonId}@${i.version}`).join() === 'spotify@1.1.0', notices);
    check('Text der Benachrichtigung', noticeList(notices[0].items) === 'Spotify 1.1.0' && noticeList([...notices[0].items, { addonId: 'b', name: 'B', version: '1.0.0' }, { addonId: 'c', name: 'C', version: '1.0.0' }]) === 'Spotify 1.1.0, B 1.0.0 und 1 weiteres');
    await storeService().check();
    check('Prüfung: dieselbe Version nur einmal (auch nach Neustart)', notices.length === 1);
    settings.addonAutoUpdate = true;
    running = true;
    await service.check();
    check('automatisch: nicht, solange ein Spiel läuft', notices.length === 1 && (await readdir(path.join(dirs.one, 'heldix-addons'))).includes('heldix-addon-spotify-1.0.0.jar'));
    running = false;
    await service.check();
    const files = await readdir(path.join(dirs.one, 'heldix-addons'));
    check('automatisch: aktualisiert, alte Version weg', files.includes('heldix-addon-spotify-1.1.0.jar') && !files.includes('heldix-addon-spotify-1.0.0.jar'), files);
    check('automatisch: Benachrichtigung „aktualisiert“, Abzeichen 0', notices.at(-1)?.kind === 'updated' && service.updates === 0 && counts.at(-1) === 0, { notices, counts });
    settings.addonAutoUpdate = false;

    // ---------- Alle aktualisieren ----------
    addons[0].version = '1.2.0';
    addons[0].jar = addonJar('spotify', '1.2.0', 'Spotify');
    await writeFile(path.join(dirs.two, 'heldix-addons', 'heldix-addon-spotify-1.0.0.jar'), addonJar('spotify', '1.0.0', 'Spotify'));
    busy.add('zwei');
    let result = await service.updateAll();
    check('alle aktualisieren: laufende Instanz ausgelassen', result.updated === 1 && result.failed.length === 0 && (await readdir(path.join(dirs.two, 'heldix-addons'))).includes('heldix-addon-spotify-1.0.0.jar'), result);
    check('… Abzeichen zählt die übrige', service.updates === 1, service.updates);
    busy.delete('zwei');
    addons[0].jar = Buffer.concat([addons[0].jar]); // gleiche Bytes
    result = await service.updateAll();
    check('alle aktualisieren: Rest erledigt', result.updated === 1 && service.updates === 0, result);

    // ---------- Entfernen ----------
    const removed = await uninstallStoreAddon(dirs.one, 'chatplus');
    const left = await readdir(path.join(dirs.one, 'heldix-addons'));
    check('entfernen: auch .jar.disabled, andere bleiben', removed === 1 && !left.some((f) => f.includes('chatplus')) && left.includes('eigenes.jar') && left.includes('heldix-addon-spotify-1.2.0.jar'), left);
    await rejects('entfernen: ungültige ID', () => uninstallStoreAddon(dirs.one, '../x'), /Ungültige Addon-ID/);

    // ---------- ohne installierte Addons: kein Abruf ----------
    const empty = path.join(tmp, 'leer');
    await mkdir(empty, { recursive: true });
    const quiet = new AddonStoreService({ serviceUrl: base, publicKey: pem, instances: async () => [{ id: 'leer', name: 'Leer', minecraft: '26.3', loader: 'heldix', dir: empty }], busy: () => false, gameRunning: () => false, auth: null, settings: async () => settings, stateFile: path.join(tmp, 'leer.json'), screenshotDir: null });
    const n = requests.length;
    await quiet.check();
    check('keine Addons installiert: Store wird nicht gefragt', requests.length === n && quiet.updates === 0);
  } finally {
    server.close();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  finish('Addon-Store');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
