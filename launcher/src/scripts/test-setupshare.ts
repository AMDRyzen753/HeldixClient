// Prüft „Setup teilen“, Partner-Server und das öffentliche Profil im Launcher (0.14.1) ohne Electron-Fenster und ohne
// echtes Netz: Links heldixclient://setup/<code> und eingefügte Web-Links, das Format content (Prüfung, ungültige
// Einträge), Grafik- und Tasten-Werte aus options.txt (feste Liste, Leistungsprofil, Übernahme beim ersten Start mit
// Datenversion), ein Setup aus einer Instanz bauen (Modrinth-Index, SHA-1-Nachschau, Store-Addons, „nicht geteilt“),
// Vorschau und Nachbauen gegen einen nachgebauten Dienst, Modrinth (API und CDN) und Addon-Store mit Test-Schlüssel,
// die Routen /v1/setups, Partner-Liste und öffentliches Profil.
//
// Alles läuft in einem temporären Ordner; fetch ist so umgebogen, dass api.modrinth.com und cdn.modrinth.com beim lokalen
// Test-Server landen und jede andere Adresse außer 127.0.0.1 einen Fehler wirft.
//
// Aufruf: npm run build && node dist/scripts/test-setupshare.js

import AdmZip from 'adm-zip';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ADDON_SIGNATURE_PREFIX, fetchStore } from '../main/core/addonstore';
import { ServiceError, serviceRequest } from '../main/core/heldixservice';
import { InstanceStore } from '../main/core/instances';
import { parsePastedInvite } from '../main/core/invites';
import { PartnerClient, mapPartner, mapPartners, partnerFor } from '../main/core/partners';
import { createPaths } from '../main/core/paths';
import { PublicProfileClient, mapPublicProfile, publicProfileUrl } from '../main/core/publicprofile';
import {
  SetupService,
  buildSetup,
  installSetup,
  mapOwnSetup,
  mapPublicSetup,
  pickModrinthFile,
  previewSetup,
  setupMissing,
  type ModrinthVersion,
  type SetupAuth,
} from '../main/core/setupinstall';
import {
  GRAPHICS_KEYS,
  PENDING_OPTIONS_FILE,
  acceptedGraphics,
  acceptedKeys,
  activeResourcePacks,
  applyHeldixProfile,
  applyPendingOptions,
  dataVersionOf,
  findSetupLink,
  graphicsFromOptions,
  graphicsSummary,
  heldixProfileFrom,
  keysFromOptions,
  mergeOptionsText,
  optionValue,
  parseOptions,
  parsePastedSetup,
  parseSetupContent,
  parseSetupLink,
  resourcePacksValue,
  setupAppUrl,
  setupCode,
  setupContentBytes,
  setupWebUrl,
  type SetupContent,
} from '../main/core/setupshare';
import { check, finish, rejects } from './testkit';

const CODE = 'abc23def45';
const MC = '26.3';
const sha1 = (data: Buffer) => createHash('sha1').update(data).digest('hex');
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// ---------- Dateien ----------

function jar(entries: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)));
  zip.addFile('test/Main.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  return zip.toBuffer();
}
const fabricMod = (id: string, version = '1.0.0') => jar({ 'fabric.mod.json': { schemaVersion: 1, id, name: id.charAt(0).toUpperCase() + id.slice(1), version } });
const addonJar = (id: string, version: string) => jar({ 'heldix.addon.json': { id, name: id, version, api: 1, entrypoint: 'test.Main' } });
const zipWith = (text: string) => {
  const zip = new AdmZip();
  zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { description: text } })));
  return zip.toBuffer();
};

// ---------- Nachgebautes Modrinth ----------

interface FakeProject { id: string; title: string; type: string; version: string; filename: string; data: Buffer; loaders: string[]; games?: string[]; deps?: { project_id: string | null; version_id: string | null; dependency_type: string }[]; url?: string; sha1?: string; projectOf?: string }

const P = {
  sodium: { id: 'AANobbMI', title: 'Sodium', type: 'mod', version: 'sodVer01', filename: 'sodium-0.9.jar', data: fabricMod('sodium', '0.9.2'), loaders: ['fabric'] },
  iris: { id: 'YL57xq9U', title: 'Iris', type: 'mod', version: 'irisVer1', filename: 'iris-1.11.jar', data: fabricMod('iris', '1.11.7'), loaders: ['fabric'], deps: [{ project_id: 'AANobbMI', version_id: 'sodVer01', dependency_type: 'required' }] },
  lithium: { id: 'gvQqBUqZ', title: 'Lithium', type: 'mod', version: 'lithVer1', filename: 'lithium-0.15.jar', data: fabricMod('lithium', '0.15.0'), loaders: ['fabric'] },
  needDep: { id: 'NeedDep1', title: 'Braucht Abhängigkeit', type: 'mod', version: 'needVer1', filename: 'needdep.jar', data: fabricMod('needdep'), loaders: ['fabric'], deps: [{ project_id: 'DepMod01', version_id: null, dependency_type: 'required' }, { project_id: 'Optional', version_id: null, dependency_type: 'optional' }] },
  depMod: { id: 'DepMod01', title: 'Abhängigkeit', type: 'mod', version: 'depVer01', filename: 'depmod.jar', data: fabricMod('depmod'), loaders: ['fabric'] },
  oldMc: { id: 'OldMc001', title: 'Alte Mod', type: 'mod', version: 'oldVer01', filename: 'oldmc.jar', data: fabricMod('oldmc'), loaders: ['fabric'], games: ['1.20.1'] },
  badUrl: { id: 'BadUrl01', title: 'Fremde Adresse', type: 'mod', version: 'badVer01', filename: 'evil.jar', data: fabricMod('evil'), loaders: ['fabric'], url: 'https://example.com/evil.jar' },
  badHash: { id: 'BadHash1', title: 'Falsche Prüfsumme', type: 'mod', version: 'bhVer001', filename: 'badhash.jar', data: fabricMod('badhash'), loaders: ['fabric'], sha1: 'f'.repeat(40) },
  forge: { id: 'Forge001', title: 'Nur Forge', type: 'mod', version: 'forgeVr1', filename: 'forge.jar', data: fabricMod('forge'), loaders: ['forge'] },
  other: { id: 'Other001', title: 'Anderes Projekt', type: 'mod', version: 'wrongVr1', filename: 'other.jar', data: fabricMod('other'), loaders: ['fabric'] },
  shaderA: { id: 'ShadrAAA', title: 'Shader A', type: 'shader', version: 'shaVerAA', filename: 'a-shader.zip', data: zipWith('Shader A'), loaders: ['iris'] },
  shaderB: { id: 'ShadrBBB', title: 'Shader B', type: 'shader', version: 'shaVerBB', filename: 'b-shader.zip', data: zipWith('Shader B'), loaders: ['iris', 'optifine'] },
  packA: { id: 'PackAAAA', title: 'Paket A', type: 'resourcepack', version: 'rpVerAAA', filename: 'pack-a.zip', data: zipWith('Paket A'), loaders: ['minecraft'] },
  packB: { id: 'PackBBBB', title: 'Paket B', type: 'resourcepack', version: 'rpVerBBB', filename: 'pack-b.zip', data: zipWith('Paket B'), loaders: ['minecraft'] },
} satisfies Record<string, FakeProject>;
const PROJECTS: FakeProject[] = Object.values(P);

function versionJson(p: FakeProject): Record<string, unknown> {
  return {
    id: p.version,
    project_id: p.projectOf ?? p.id,
    version_number: `${p.title} 1.0`,
    version_type: 'release',
    loaders: p.loaders,
    game_versions: p.games ?? [MC],
    files: [{ url: p.url ?? `https://cdn.modrinth.com/data/${p.id}/versions/${p.version}/${p.filename}`, filename: p.filename, primary: true, size: p.data.length, hashes: { sha1: p.sha1 ?? sha1(p.data), sha512: 'x' } }],
    dependencies: p.deps ?? [],
  };
}

// ---------- Addon-Store mit Test-Schlüssel ----------

const ADDONS = [
  { id: 'voicechat', name: 'Voice Chat', version: '1.4.0' },
  { id: 'spotify', name: 'Spotify', version: '1.1.0' },
  { id: 'kaputt', name: 'Kaputt', version: '1.0.0', tampered: true },
];
const ADDON_JARS = new Map(ADDONS.map((a) => [a.id, addonJar(a.id, a.version)]));
function addonManifest(a: (typeof ADDONS)[number]): Record<string, unknown> {
  const data = ADDON_JARS.get(a.id)!;
  return {
    type: 'heldix-addon', id: a.id, name: a.name, version: a.version, summary: `${a.name} zum Testen`, description: '', authors: ['HeldixClient'],
    api: 1, icon: 'mic', category: 'hud', platforms: [], file: `heldix-addon-${a.id}-${a.version}.jar`, size: data.length,
    sha256: sha256(data), date: '2026-11-28', notes: [], official: true, author: null,
  };
}

// ---------- Test-Server: Dienst, Store, Modrinth und CDN ----------

interface ServerState {
  setups: Map<string, { status: number; body: unknown }>;
  created: Record<string, unknown>[];
  installed: string[];
  revoked: string[];
  own: unknown;
  partners: { status: number; body: unknown };
  profile: Record<string, unknown> | null;
  profilePuts: Record<string, unknown>[];
  storeUp: boolean;
  modrinthDown: boolean;
  modrinthCalls: string[];
  cdnCalls: string[];
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

function startServer(state: ServerState, privateKey: import('node:crypto').KeyObject): Promise<{ base: string; close(): Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://test');
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const p = url.pathname;
      // ---- Modrinth ----
      if (p.startsWith('/modrinth/v2/')) {
        state.modrinthCalls.push(`${req.method} ${p}${url.search}`);
        const route = p.slice('/modrinth/v2'.length);
        if (route === '/versions') {
          const ids = JSON.parse(url.searchParams.get('ids') ?? '[]') as string[];
          return json(200, PROJECTS.filter((x) => ids.includes(x.version)).map(versionJson));
        }
        if (route === '/projects') {
          const ids = JSON.parse(url.searchParams.get('ids') ?? '[]') as string[];
          const known = [...PROJECTS.map((x) => ({ id: x.projectOf ?? x.id, title: x.title, project_type: x.type })), { id: 'Claim001', title: 'Behauptetes Projekt', project_type: 'mod' }];
          return json(200, known.filter((x) => ids.includes(x.id)).map((x) => ({ ...x, icon_url: `https://cdn.modrinth.com/data/${x.id}/icon.png`, slug: x.id.toLowerCase() })));
        }
        if (route === '/version_files' && req.method === 'POST') {
          const { hashes } = (await body(req)) as { hashes: string[] };
          const out: Record<string, unknown> = {};
          for (const x of PROJECTS) if (hashes.includes(sha1(x.data))) out[sha1(x.data)] = versionJson(x);
          return json(200, out);
        }
        const versions = /^\/project\/([A-Za-z0-9]+)\/version$/.exec(route);
        if (versions) return json(200, PROJECTS.filter((x) => x.id === versions[1]).map(versionJson));
        return json(404, { error: 'not_found' });
      }
      if (p.startsWith('/cdn/')) {
        state.cdnCalls.push(p);
        const found = PROJECTS.find((x) => p === `/cdn/data/${x.id}/versions/${x.version}/${x.filename}`);
        if (!found) return json(404, { error: 'not_found' });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': found.data.length });
        res.end(found.data);
        return;
      }
      // ---- Addon-Store ----
      if (p === '/v1/addons' && req.method === 'GET') {
        if (!state.storeUp) return json(503, { error: 'Wartung' });
        return json(200, {
          addons: ADDONS.map((a) => {
            const manifest = JSON.stringify(addonManifest(a));
            return { manifest, signature: sign(null, Buffer.from(ADDON_SIGNATURE_PREFIX + manifest, 'utf8'), privateKey).toString('base64'), downloads: 1, rating: { average: 0, count: 0 }, screenshots: 0, screenshotsVersion: '' };
          }),
        });
      }
      const file = /^\/v1\/addons\/([a-z0-9_-]+)\/files\/(.+)$/.exec(p);
      if (file) {
        const addon = ADDONS.find((a) => a.id === file[1]);
        if (!addon) return json(404, { error: 'Diese Datei gibt es nicht.' });
        const data = addon.tampered ? addonJar(addon.id, '9.9.9') : ADDON_JARS.get(addon.id)!;
        res.writeHead(200, { 'content-type': 'application/java-archive', 'content-length': data.length });
        res.end(data);
        return;
      }
      // ---- Setups ----
      const pub = /^\/v1\/public\/setups\/([a-z0-9]+)(\/installed)?$/.exec(p);
      if (pub) {
        if (pub[2] && req.method === 'POST') {
          state.installed.push(pub[1]);
          return json(200, { ok: true });
        }
        const entry = state.setups.get(pub[1]);
        if (!entry) return json(404, { error: 'Dieses Setup gibt es nicht.' });
        return json(entry.status, entry.body);
      }
      const authed = req.headers.authorization === 'Bearer test-token';
      if (p === '/v1/setups' && req.method === 'POST') {
        if (!authed) return json(401, { error: 'Bitte anmelden.' });
        const data = (await body(req)) as Record<string, unknown>;
        state.created.push(data);
        return json(201, { code: 'neucd23456', url: 'https://heldix.test/setup#neucd23456', expires: data.expiresDays === null ? null : '2026-12-28T00:00:00.000Z' });
      }
      if (p === '/v1/setups' && req.method === 'GET') {
        if (!authed) return json(401, { error: 'Bitte anmelden.' });
        return state.own === 404 ? json(404, { error: 'Nicht gefunden.' }) : json(200, state.own);
      }
      const del = /^\/v1\/setups\/([a-z0-9]+)$/.exec(p);
      if (del && req.method === 'DELETE') {
        state.revoked.push(del[1]);
        return json(200, { ok: true });
      }
      // ---- Partner und öffentliches Profil ----
      if (p === '/v1/public/partners') return json(state.partners.status, state.partners.body);
      if (p === '/v1/account/public-profile') {
        if (!state.profile) return json(404, { error: 'Nicht gefunden.' });
        if (req.method === 'PUT') {
          const data = (await body(req)) as Record<string, unknown>;
          state.profilePuts.push(data);
          state.profile = { ...data };
        }
        return json(200, state.profile);
      }
      json(404, { error: 'Nicht gefunden.' });
    })().catch((error: unknown) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(error) }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((done) => server.close(() => done())),
  })));
}

/** fetch umbiegen: Modrinth → Test-Server, alles außer 127.0.0.1 → Fehler */
function interceptFetch(base: string, state: ServerState): { outside: string[]; restore(): void } {
  const real = globalThis.fetch;
  const outside: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.modrinth.com/')) {
      if (state.modrinthDown) throw new TypeError('Test: Modrinth nicht erreichbar');
      return real(url.replace('https://api.modrinth.com', `${base}/modrinth`), init);
    }
    if (url.startsWith('https://cdn.modrinth.com/')) return real(url.replace('https://cdn.modrinth.com', `${base}/cdn`), init);
    if (url.startsWith(`${base}/`)) return real(input, init);
    outside.push(url);
    throw new TypeError(`Test: keine Verbindung nach außen (${url})`);
  }) as typeof fetch;
  return { outside, restore: () => (globalThis.fetch = real) };
}

// ---------- Prüfungen ----------

function links(): void {
  check('Link: heldixclient://setup/<code>', parseSetupLink(`heldixclient://setup/${CODE}`) === CODE);
  check('Link: Protokoll groß, Schrägstrich am Ende', parseSetupLink(`HeldixClient://SETUP/${CODE}/`) === CODE);
  for (const bad of [`heldixclient://setup/${CODE.slice(0, 9)}`, `heldixclient://setup/${CODE}x`, 'heldixclient://setup/abc23def4i', `heldixclient://setup/${CODE.toUpperCase()}`,
    `heldixclient://setup/${CODE}?x=1`, `heldixclient://setup/${CODE}/mehr`, `heldixclient://einladung/${CODE}`, `heldixclient://welt/k7m2xq`, `https://heldixclient.com/setup#${CODE}`]) {
    check(`Link abgelehnt: ${bad}`, parseSetupLink(bad) === null);
  }
  check('Befehlszeile: erster gültiger Link', findSetupLink(['electron.exe', '.', 'heldixclient://setup/kaputt', `heldixclient://setup/${CODE}`]) === CODE);
  check('Befehlszeile: Einladung ist kein Setup', findSetupLink([`heldixclient://einladung/${CODE}`]) === null);
  check('App-Link', setupAppUrl(CODE) === `heldixclient://setup/${CODE}`);
  check('Web-Link nur https', setupWebUrl('https://heldixclient.com/', CODE) === `https://heldixclient.com/setup#${CODE}` && setupWebUrl('http://heldixclient.com', CODE) === null);
  check('Code aus der Oberfläche geprüft', setupCode(CODE) === CODE);
  let threw = false;
  try {
    setupCode('../../x');
  } catch {
    threw = true;
  }
  check('Ungültiger Code wirft', threw);

  check('Einfügen: Web-Link', parsePastedSetup(`https://heldixclient.com/setup#${CODE}`) === CODE);
  check('Einfügen: ohne https, Code groß', parsePastedSetup(`heldixclient.com/setup#${CODE.toUpperCase()}`) === CODE);
  check('Einfügen: /setup.html', parsePastedSetup(`https://heldixclient.com/setup.html#${CODE}`) === CODE);
  check('Einfügen: App-Link', parsePastedSetup(`heldixclient://setup/${CODE}`) === CODE);
  check('Einfügen: mitten im Satz', parsePastedSetup(`Schau mal: „https://heldixclient.com/setup#${CODE}“, mein PvP-Setup!`) === CODE);
  check('Einfügen: bloßer Code nur im Setup-Feld', parsePastedSetup(CODE) === null && parsePastedSetup(` ${CODE.toUpperCase()} `, { bareCode: true }) === CODE);
  check('Einfügen: Einladungs- und Welt-Links sind keine Setups', parsePastedSetup(`https://heldixclient.com/einladung#${CODE}`) === null && parsePastedSetup('https://heldixclient.com/welt#k7m2xq') === null);
  check('Einfügen: Setup-Link ist keine Einladung', parsePastedInvite(`https://heldixclient.com/setup#${CODE}`) === null);
  check('Einfügen: fremde Seite mit #code', parsePastedSetup(`https://example.com/anders#${CODE}`) === null);
  check('Einfügen: zu lang', parsePastedSetup('x'.repeat(2001)) === null);
}

function content(): void {
  const base = { v: 1, minecraft: MC, loader: 'fabric', heldixClient: true, mods: [], resourcepacks: [], shaderpacks: [], addons: [], settings: { graphics: null, keys: null } };
  const ok = parseSetupContent(base);
  check('content: gültig', ok.dropped === 0 && ok.content.loader === 'fabric' && ok.content.heldixClient === true);
  const broken = (raw: unknown, pattern: RegExp, label: string) => {
    try {
      parseSetupContent(raw);
      check(label, false, 'kein Fehler');
    } catch (error) {
      check(label, pattern.test(String((error as Error).message)), (error as Error).message);
    }
  };
  broken(null, /beschädigt/, 'content: kein Objekt');
  broken({ ...base, v: 2 }, /neueren HeldixClient/, 'content: neuere Version');
  broken({ ...base, minecraft: '../26.3' }, /beschädigt/, 'content: ungültige Minecraft-Version');
  broken({ ...base, loader: 'forge' }, /beschädigt/, 'content: unbekannter Loader');
  broken({ ...base, mods: 'alles' }, /beschädigt/, 'content: Liste ist keine Liste');

  const many = Array.from({ length: 305 }, (_, i) => ({ project: `Proj${String(i).padStart(4, '0')}`, version: `Vers${String(i).padStart(4, '0')}`, title: `Mod ${i}` }));
  const mixed = parseSetupContent({
    ...base,
    loader: 'heldix',
    heldixClient: false,
    mods: [{ project: 'AANobbMI', version: 'sodVer01', title: ' Sodium\u0007 ' }, { project: 'AANobbMI', version: 'sodVer02' }, { project: 'kurz', version: 'sodVer01' }, { project: 'YL57xq9U', version: 'irisVer1', title: 'x'.repeat(200) }],
    resourcepacks: many,
    addons: [{ id: 'voicechat', version: '1.4.0', name: 'Voice Chat' }, { id: 'Gross', version: null }, { id: 'uhr', version: 'neu' }, { id: 'voicechat', version: null }],
    settings: {
      graphics: { renderDistance: 12, 'heldix:fpsBoost': true, 'böse taste': 1, lang: 'de_de', lang2: 'x'.repeat(65), zeile: 'a\nb', unendlich: Number.POSITIVE_INFINITY, objekt: {} },
      keys: { 'key.forward': 'key.keyboard.w', 'key.jump': 'KEY.SPACE', 'heldix.zoom': 'key.keyboard.c', 'key.attack': 'key.mouse.left' },
    },
  });
  const c = mixed.content;
  check('content: Heldix-Instanz hat immer HeldixClient', c.heldixClient === true);
  check('content: Steuerzeichen und Leerraum im Titel weg', c.mods[0].title === 'Sodium', c.mods[0].title);
  check('content: Titel gekürzt', c.mods[1]?.title.length === 64, c.mods[1]?.title.length);
  check('content: doppelte und ungültige Mods weg', c.mods.length === 2);
  check('content: höchstens 300 je Liste', c.resourcepacks.length === 300);
  check('content: Addons geprüft (ID, Version, doppelt)', c.addons.length === 1 && c.addons[0].id === 'voicechat');
  check('content: Grafik-Schlüssel und -Werte geprüft', JSON.stringify(c.settings.graphics) === JSON.stringify({ renderDistance: 12, 'heldix:fpsBoost': true, lang: 'de_de' }), c.settings.graphics);
  check('content: Tasten geprüft', JSON.stringify(c.settings.keys) === JSON.stringify({ 'key.forward': 'key.keyboard.w', 'key.attack': 'key.mouse.left' }), c.settings.keys);
  check('content: Zahl der verworfenen Einträge', mixed.dropped === 2 + 5 + 3 + 5 + 2, mixed.dropped);
  check('content: Vanilla hat nie HeldixClient', parseSetupContent({ ...base, loader: 'vanilla', heldixClient: true }).content.heldixClient === false);
  check('content: Fabric ohne Angabe = mit HeldixClient', parseSetupContent({ ...base, heldixClient: undefined }).content.heldixClient === true);
}

async function options(tmp: string): Promise<void> {
  const text = [
    'version:4999',
    'renderDistance:16',
    'simulationDistance:8',
    'maxFps:260',
    'enableVsync:false',
    'renderClouds:"fast"',
    'fov:0.25',
    'guiScale:0',
    'particles:1',
    'lang:de_de',
    'fullscreen:true',
    'soundDevice:""',
    'resourcePacks:["vanilla","fabric","file/pack-b.zip","file/pack-a.zip"]',
    'key_key.forward:key.keyboard.w',
    'key_key.attack:key.mouse.left',
    'key_Voice Chat – Sprechen:key.keyboard.v',
    'key_key.jump:key.keyboard.space',
    'kaputte zeile',
  ].join('\r\n');
  const map = parseOptions(text);
  check('options.txt: Zeilen gelesen (auch CRLF)', map.get('renderDistance') === '16' && map.get('renderClouds') === '"fast"');
  check('Wert: Zahl, Ja/Nein, Text', optionValue('16') === 16 && optionValue('false') === false && optionValue('"fast"') === '"fast"' && optionValue('0.25') === 0.25);
  const graphics = graphicsFromOptions(map);
  check('Grafik: nur die feste Liste', JSON.stringify(graphics) === JSON.stringify({ renderDistance: 16, simulationDistance: 8, maxFps: 260, enableVsync: false, particles: 1, guiScale: 0, fov: 0.25, renderClouds: '"fast"' }), graphics);
  check('Grafik: nichts vom PC (Vollbild, Audiogerät, Sprache)', !('fullscreen' in graphics) && !('soundDevice' in graphics) && !('lang' in graphics));
  check('Grafik: Liste hat höchstens 60 Einträge samt Leistungsprofil', GRAPHICS_KEYS.length + 4 <= 60);
  const keys = keysFromOptions(map);
  check('Tasten: nur gültige Namen', JSON.stringify(keys) === JSON.stringify({ 'key.forward': 'key.keyboard.w', 'key.attack': 'key.mouse.left', 'key.jump': 'key.keyboard.space' }), keys);
  check('Ressourcenpakete: eigene in der Reihenfolge von options.txt', JSON.stringify(activeResourcePacks(map)) === JSON.stringify(['pack-b.zip', 'pack-a.zip']));
  check('Ressourcenpakete: eingebaute bleiben vorn', resourcePacksValue('["vanilla","fabric","file/alt.zip"]', ['neu.zip']) === '["vanilla","fabric","file/neu.zip"]');
  check('Ressourcenpakete: ohne Zeile vanilla zuerst', resourcePacksValue(undefined, ['a.zip']) === '["vanilla","file/a.zip"]');

  const profile = heldixProfileFrom({ fpsBoost: { entityShadows: 'true' }, backgroundFps: true, backgroundFpsLimit: 500, shader: 'kino', hudScale: 1.2 });
  check('Leistungsprofil gelesen (Grenze begrenzt)', JSON.stringify(profile) === JSON.stringify({ 'heldix:fpsBoost': true, 'heldix:backgroundFps': true, 'heldix:backgroundFpsLimit': 240, 'heldix:shader': 'kino' }), profile);
  check('Leistungsprofil: FPS-Boost aus', heldixProfileFrom({ fpsBoost: null })['heldix:fpsBoost'] === false);

  const accepted = acceptedGraphics({ renderDistance: 12, lang: 'de_de', resourcePacks: '["x"]', 'heldix:fpsBoost': true, 'heldix:backgroundFpsLimit': 3, 'heldix:shader': '../x', 'heldix:unbekannt': true, maxFps: 'ab\u0001' as string, renderClouds: '"fast"', fov: 0.25 });
  check('Übernahme: nur feste Liste in options.txt', JSON.stringify(accepted.options) === JSON.stringify({ renderDistance: '12', renderClouds: '"fast"', fov: '0.25' }), accepted.options);
  check('Übernahme: Leistungsprofil mit passenden Werten', JSON.stringify(accepted.heldix) === JSON.stringify({ 'heldix:fpsBoost': true }), accepted.heldix);
  check('Übernahme: Tasten als key_-Zeilen', JSON.stringify(acceptedKeys({ 'key.forward': 'key.keyboard.w', 'key.x': 'böse' })) === JSON.stringify({ 'key_key.forward': 'key.keyboard.w' }));

  check('Zusammenführen: vorhandene Zeilen ersetzt, neue angehängt, Rest bleibt', mergeOptionsText('version:1\nrenderDistance:8\nlang:de_de\n', { renderDistance: '12', fov: '0' }, null) === 'version:1\nrenderDistance:12\nlang:de_de\nfov:0\n');
  check('Zusammenführen: neue Datei ohne Datenversion → nichts', mergeOptionsText(null, { renderDistance: '12' }, null) === null);
  check('Zusammenführen: neue Datei mit Datenversion zuerst', mergeOptionsText(null, { renderDistance: '12' }, 4999) === 'version:4999\nrenderDistance:12\n');

  const summary = graphicsSummary({ renderDistance: 16, maxFps: 260, fov: 0.25, guiScale: 0, enableVsync: false, renderClouds: '"fast"', 'heldix:fpsBoost': true, lang: 'x' });
  check('Vorschau: lesbare Grafik-Werte', JSON.stringify(summary) === JSON.stringify(['Sichtweite: 16 Chunks', 'FPS-Grenze: unbegrenzt', 'VSync: aus', 'GUI-Größe: automatisch', 'Sichtfeld: 80', 'Wolken: schnell', 'FPS-Boost: an']), summary);

  // Client-JAR mit Datenversion
  const clientJar = path.join(tmp, 'client.jar');
  const zip = new AdmZip();
  zip.addFile('version.json', Buffer.from(JSON.stringify({ id: MC, world_version: 4999 })));
  await writeFile(clientJar, zip.toBuffer());
  check('Datenversion aus version.json', dataVersionOf(clientJar) === 4999);
  check('Datenversion: keine JAR → null', dataVersionOf(path.join(tmp, 'fehlt.jar')) === null);

  // Leistungsprofil schreiben
  const game = path.join(tmp, 'profil');
  await mkdir(path.join(game, 'config'), { recursive: true });
  await writeFile(path.join(game, 'config', 'heldixclient.json'), JSON.stringify({ hudScale: 1.5, fpsBoost: null }));
  await applyHeldixProfile(game, { 'heldix:fpsBoost': true, 'heldix:backgroundFps': false, 'heldix:backgroundFpsLimit': 15, 'heldix:shader': 'warm' });
  const written = JSON.parse(await readFile(path.join(game, 'config', 'heldixclient.json'), 'utf8')) as Record<string, unknown>;
  check('Leistungsprofil: andere Felder bleiben, FPS-Boost an = leere Merkliste', written.hudScale === 1.5 && JSON.stringify(written.fpsBoost) === '{}' && written.backgroundFps === false && written.backgroundFpsLimit === 15 && written.shader === 'warm', written);
  await applyHeldixProfile(game, { 'heldix:fpsBoost': false });
  check('Leistungsprofil: FPS-Boost aus', JSON.parse(await readFile(path.join(game, 'config', 'heldixclient.json'), 'utf8')).fpsBoost === null);
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-setupshare-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const state: ServerState = {
    setups: new Map(), created: [], installed: [], revoked: [], own: { setups: [] }, partners: { status: 200, body: { partners: [] } },
    profile: null, profilePuts: [], storeUp: true, modrinthDown: false, modrinthCalls: [], cdnCalls: [],
  };
  const server = await startServer(state, privateKey);
  const net = interceptFetch(server.base, state);
  const auth: SetupAuth = { authed: (route, init = {}) => serviceRequest(server.base, route, { method: init.method, body: init.body, token: 'test-token' }) };
  try {
    links();
    content();
    await options(tmp);

    // ---------- Setup aus einer Instanz bauen ----------
    const source = path.join(tmp, 'quelle');
    const mods = path.join(source, 'mods');
    await mkdir(mods, { recursive: true });
    await writeFile(path.join(mods, P.sodium.filename), P.sodium.data);
    await writeFile(path.join(mods, P.iris.filename), P.iris.data);
    await writeFile(path.join(mods, 'lithium-von-hand.jar'), P.lithium.data);
    await writeFile(path.join(mods, 'eigene.jar'), fabricMod('eigene'));
    await writeFile(path.join(mods, 'alt.jar.disabled'), fabricMod('alt'));
    await writeFile(path.join(mods, 'fabric-api.jar'), fabricMod('fabric-api'));
    await writeFile(path.join(mods, 'heldixclient.jar'), fabricMod('heldixclient'));
    await writeFile(path.join(mods, '.heldix-managed.json'), JSON.stringify(['heldixclient.jar']));
    await writeFile(path.join(mods, '.heldix-modrinth.json'), JSON.stringify({
      [P.sodium.filename]: { projectId: P.sodium.id, versionId: P.sodium.version, title: 'Sodium' },
      [P.iris.filename]: { projectId: P.iris.id, versionId: P.iris.version, title: 'Iris' },
      'alt.jar': { projectId: P.oldMc.id, versionId: P.oldMc.version, title: 'Alte Mod' },
      'fabric-api.jar': { projectId: 'P7dR8mSH', versionId: 'fapiVer1', title: 'Fabric API' },
    }));
    const shaders = path.join(source, 'shaderpacks');
    await mkdir(path.join(shaders, 'ordner'), { recursive: true });
    await writeFile(path.join(shaders, 'a-shader.zip'), P.shaderA.data);
    await writeFile(path.join(shaders, 'b-von-hand.zip'), P.shaderB.data);
    await writeFile(path.join(shaders, '.heldix-shaderpacks.json'), JSON.stringify({ 'a-shader.zip': { projectId: P.shaderA.id, versionId: P.shaderA.version, title: 'Shader A' } }));
    await mkdir(path.join(source, 'config'), { recursive: true });
    await writeFile(path.join(source, 'config', 'iris.properties'), 'enableShaders=true\nshaderPack=b-von-hand.zip\n');
    await writeFile(path.join(source, 'config', 'heldixclient.json'), JSON.stringify({ fpsBoost: { entityShadows: 'true' }, backgroundFps: true, backgroundFpsLimit: 20, shader: 'kino', hudScale: 1.2 }));
    const packs = path.join(source, 'resourcepacks');
    await mkdir(path.join(packs, 'entpackt'), { recursive: true });
    await writeFile(path.join(packs, 'pack-a.zip'), P.packA.data);
    await writeFile(path.join(packs, 'pack-b.zip'), P.packB.data);
    await writeFile(path.join(packs, 'pack-c.zip'), zipWith('aus'));
    await writeFile(path.join(packs, 'unbekannt.zip'), zipWith('unbekannt'));
    await writeFile(path.join(source, 'options.txt'), [
      'version:4999', 'renderDistance:16', 'maxFps:144', 'enableVsync:false', 'lang:de_de', 'fullscreen:true',
      'resourcePacks:["vanilla","file/pack-b.zip","file/unbekannt.zip","file/entpackt","file/pack-a.zip"]',
      'key_key.forward:key.keyboard.w', 'key_key.jump:key.keyboard.space',
    ].join('\n'));
    const addons = path.join(source, 'heldix-addons');
    await mkdir(addons, { recursive: true });
    await writeFile(path.join(addons, 'heldix-addon-voicechat-1.3.0.jar'), addonJar('voicechat', '1.3.0'));
    await writeFile(path.join(addons, 'eigenes.jar'), addonJar('eigenes', '1.0.0'));
    await writeFile(path.join(addons, 'heldix-addon-spotify-1.1.0.jar.disabled'), ADDON_JARS.get('spotify')!);

    const store = () => fetchStore(server.base, pem);
    const instance = { name: 'Mein PvP', minecraft: MC, loader: 'fabric' as const, heldixClient: true };
    const built = await buildSetup(source, instance, { graphics: true, keys: true, store });
    const c = built.content;
    const projects = (list: { project: string }[]) => list.map((e) => e.project).join(',');
    check('Bauen: Mods aus dem Index und über die SHA-1', projects(c.mods).split(',').sort().join(',') === [P.sodium.id, P.iris.id, P.lithium.id].sort().join(','), c.mods);
    check('Bauen: Titel aus Modrinth für Dateien von Hand', c.mods.find((m) => m.project === P.lithium.id)?.title === 'Lithium');
    check('Bauen: verwaltete Mods und Fabric API nicht geteilt und nicht aufgelistet', !built.notShared.some((n) => /fabric-api|heldixclient/i.test(n.name)) && !c.mods.some((m) => m.project === 'P7dR8mSH'));
    check('Bauen: aktives Shaderpack zuerst', projects(c.shaderpacks) === `${P.shaderB.id},${P.shaderA.id}`, c.shaderpacks);
    check('Bauen: Ressourcenpakete in der Reihenfolge von options.txt', projects(c.resourcepacks) === `${P.packB.id},${P.packA.id}`, c.resourcepacks);
    check('Bauen: Store-Addons mit Version', JSON.stringify(c.addons) === JSON.stringify([{ id: 'voicechat', version: '1.3.0', name: 'Voice Chat' }]), c.addons);
    const reason = (name: string) => built.notShared.find((n) => n.name === name)?.reason;
    check('Nicht geteilt: unbekannte Mod', reason('Eigene') === 'keine Modrinth-Datei', built.notShared);
    check('Nicht geteilt: ausgeschaltete Mod', reason('Alte Mod') === 'ausgeschaltet');
    check('Nicht geteilt: Shaderpack-Ordner', /^Ordner/.test(reason('ordner') ?? ''));
    check('Nicht geteilt: Paket nicht eingeschaltet', reason('pack-c') === 'nicht eingeschaltet');
    check('Nicht geteilt: unbekanntes Paket', reason('unbekannt') === 'keine Modrinth-Datei');
    check('Nicht geteilt: entpacktes Paket', /^Ordner/.test(reason('entpackt') ?? ''));
    check('Nicht geteilt: Addon nicht im Store', reason('eigenes') === 'nicht im Addon-Store');
    check('Nicht geteilt: ausgeschaltetes Addon', reason('spotify') === 'ausgeschaltet');
    check('Bauen: Grafik aus options.txt und Leistungsprofil', JSON.stringify(c.settings.graphics) === JSON.stringify({ renderDistance: 16, maxFps: 144, enableVsync: false, 'heldix:fpsBoost': true, 'heldix:backgroundFps': true, 'heldix:backgroundFpsLimit': 20, 'heldix:shader': 'kino' }), c.settings.graphics);
    check('Bauen: Tasten', JSON.stringify(c.settings.keys) === JSON.stringify({ 'key.forward': 'key.keyboard.w', 'key.jump': 'key.keyboard.space' }));
    check('Bauen: Zähler für den Dialog', built.graphics === 7 && built.keys === 2 && built.items.length === 8, { graphics: built.graphics, keys: built.keys, items: built.items.length });
    const roundTrip = parseSetupContent(JSON.parse(JSON.stringify(c)));
    check('Bauen: Ergebnis besteht die eigene Prüfung ohne Verluste', roundTrip.dropped === 0 && JSON.stringify(roundTrip.content) === JSON.stringify(c));
    check('Bauen: klein genug (≤ 64 KiB)', setupContentBytes(c) < 64 * 1024);
    const plain = await buildSetup(source, instance, { graphics: false, keys: false, store });
    check('Bauen: Grafik und Tasten nur auf Wunsch', plain.content.settings.graphics === null && plain.content.settings.keys === null);
    state.modrinthDown = true;
    const offline = await buildSetup(source, instance, { graphics: false, keys: false, store });
    state.modrinthDown = false;
    check('Bauen ohne Modrinth: Index geht, Nachschau als Grund', offline.content.mods.length === 2 && offline.notShared.some((n) => n.name === 'Lithium' && n.reason === 'Modrinth gerade nicht erreichbar'), offline.notShared);
    state.storeUp = false;
    const noStore = await buildSetup(source, instance, { graphics: false, keys: false, store });
    state.storeUp = true;
    check('Bauen ohne Store: Addons mit Grund', noStore.content.addons.length === 0 && noStore.notShared.some((n) => n.name === 'voicechat' && /Addon-Store/.test(n.reason)), noStore.notShared);
    const heldixBuilt = await buildSetup(source, { ...instance, loader: 'heldix' }, { graphics: false, keys: false, store });
    check('Bauen: Heldix-Instanz teilt keine Fabric-Mods und keine Shaderpacks', heldixBuilt.content.mods.length === 0 && heldixBuilt.content.shaderpacks.length === 0 && heldixBuilt.content.resourcepacks.length === 2);

    // ---------- Setup beim Dienst: anlegen, eigene, widerrufen ----------
    const service = new SetupService({ serviceUrl: server.base, website: 'https://heldix.test', auth });
    const created = await service.create(c, { name: 'Mein PvP', description: 'Für Bedwars', expiresDays: 12 });
    check('Anlegen: Code und Link vom Dienst', created.code === 'neucd23456' && created.url === 'https://heldix.test/setup#neucd23456' && created.expires === Date.parse('2026-12-28T00:00:00.000Z'), created);
    const sent = state.created.at(-1)!;
    check('Anlegen: Name, Beschreibung, content, ungültiger Ablauf → 30', sent.name === 'Mein PvP' && sent.description === 'Für Bedwars' && sent.expiresDays === 30 && JSON.stringify(sent.content) === JSON.stringify(c), sent);
    await service.create(c, { name: 'x', description: '', expiresDays: null });
    check('Anlegen: „nie“ bleibt null', state.created.at(-1)!.expiresDays === null);
    const huge: SetupContent = { ...c, settings: { graphics: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'x'.repeat(64)])), keys: null }, resourcepacks: Array.from({ length: 300 }, (_, i) => ({ project: `Pack${String(i).padStart(4, '0')}`, version: `Vers${String(i).padStart(4, '0')}`, title: 'y'.repeat(64) })) };
    const before = state.created.length;
    await rejects('Anlegen: zu groß, ohne Anfrage', () => service.create({ ...huge, mods: huge.resourcepacks, shaderpacks: huge.resourcepacks }, { name: 'x', description: '', expiresDays: 7 }), /zu groß/);
    check('Anlegen: zu groß ging nicht an den Dienst', state.created.length === before);

    const now = Date.now();
    state.own = { setups: [
      { code: 'axtcd23456', name: 'Alt', created: now - 10_000, expires: now - 1000, views: 3, installs: 1, revoked: false },
      { code: 'neucd23456', name: 'Neu', created: now, expires: null, views: 12, installs: 4, revoked: false },
      { code: 'wegcd23456', name: 'Weg', created: now - 5000, expires: null, revoked: true },
      { code: 'ungültig', name: 'x' },
    ] };
    const own = await service.mine();
    check('Eigene Setups: aktive zuerst, ungültige weg', own.status === 'ok' && own.setups.map((s) => s.code).join(',') === 'neucd23456,wegcd23456,axtcd23456', own);
    check('Eigene Setups: abgelaufen und widerrufen sind nicht aktiv', own.setups.filter((s) => s.active).length === 1 && own.setups[0].url === 'https://heldix.test/setup#neucd23456' && own.setups[0].views === 12);
    await service.revoke('neucd23456');
    check('Widerrufen: DELETE /v1/setups/<code>', state.revoked.join(',') === 'neucd23456');
    state.own = 404;
    check('Eigene Setups: Dienst ohne Setups', (await service.mine()).status === 'unsupported');
    check('Eigene Setups: ohne Dienst aus', (await new SetupService({ serviceUrl: '', website: '', auth: null }).mine()).status === 'off');
    check('Eigener Eintrag: Code geprüft', mapOwnSetup({ code: '../x' }, 'https://heldix.test') === null);

    // ---------- Öffentliches Setup: Vorschau ----------
    const crafted: SetupContent = {
      ...c,
      mods: [
        ...c.mods,
        { project: P.needDep.id, version: P.needDep.version, title: 'Braucht Abhängigkeit' },
        { project: P.oldMc.id, version: P.oldMc.version, title: 'Alte Mod' },
        { project: P.badUrl.id, version: P.badUrl.version, title: 'Fremde Adresse' },
        { project: P.badHash.id, version: P.badHash.version, title: 'Falsche Prüfsumme' },
        { project: P.forge.id, version: P.forge.version, title: 'Nur Forge' },
        { project: 'Claim001', version: P.other.version, title: 'Behauptet' },
        { project: 'GoneProj', version: 'goneVer1', title: 'Gelöscht' },
        { project: 'P7dR8mSH', version: 'fapiVer1', title: 'Fabric API' },
      ],
      addons: [...c.addons, { id: 'kaputt', version: '1.0.0', name: 'Kaputt' }, { id: 'fehlt', version: null, name: 'Fehlt' }],
    };
    const publicBody = (content: unknown) => ({ code: CODE, name: 'PvP-Setup', description: 'Schnell und scharf', creator: { name: 'Lena', uuid: 'a'.repeat(32) }, content, hash: 'h', created: '2026-11-28T10:00:00.000Z', expires: null, views: 7, installs: 2 });
    state.setups.set(CODE, { status: 200, body: publicBody({ ...crafted, mods: [...crafted.mods, { project: 'kaputt', version: 'x' }] }) });
    state.setups.set('wegcd23456', { status: 410, body: { error: 'Abgelaufen.' } });
    state.setups.set('kaputt2345', { status: 200, body: publicBody({ v: 1 }) });
    const setup = await service.publicSetup(CODE, true);
    check('Öffentliches Setup: gelesen', setup.name === 'PvP-Setup' && setup.creator?.name === 'Lena' && setup.views === 7 && setup.dropped === 1 && setup.created === Date.parse('2026-11-28T10:00:00.000Z'), setup);
    let missing: unknown = null;
    try {
      await service.publicSetup('zzzzzzzzzz', true);
    } catch (error) {
      missing = error;
    }
    check('Öffentliches Setup: 404 = gibt es nicht', missing instanceof ServiceError && setupMissing(missing) === 'missing' && /gibt es nicht/.test((missing as Error).message));
    let gone: unknown = null;
    try {
      await service.publicSetup('wegcd23456', true);
    } catch (error) {
      gone = error;
    }
    check('Öffentliches Setup: 410 = abgelaufen oder widerrufen', setupMissing(gone) === 'gone' && /abgelaufen/.test((gone as Error).message));
    await rejects('Öffentliches Setup: kaputter Inhalt', () => service.publicSetup('kaputt2345', true), /beschädigt/);
    check('Öffentliches Setup: kaputter Code', (() => {
      try {
        mapPublicSetup({ content: null }, CODE);
        return false;
      } catch {
        return true;
      }
    })());

    const target = async () => null as string | null;
    const preview = await previewSetup(setup, { serviceUrl: server.base, publicKey: pem, checkTarget: target });
    const item = (title: string) => preview.items.find((i) => i.title === title);
    check('Vorschau: Kopf', preview.status === 'ok' && preview.name === 'PvP-Setup' && preview.minecraft === MC && preview.loader === 'fabric' && preview.problem === null);
    check('Vorschau: Symbole nur vom Modrinth-CDN', item('Sodium')?.iconUrl === `https://cdn.modrinth.com/data/${P.sodium.id}/icon.png` && item('Sodium')?.state === 'ok');
    check('Vorschau: Version von Modrinth', item('Sodium')?.version === 'Sodium 1.0');
    check('Vorschau: fremde Download-Adresse abgelehnt', item('Fremde Adresse')?.state === 'skip' && /ungültig/.test(item('Fremde Adresse')?.note ?? ''));
    check('Vorschau: nicht für Fabric', item('Nur Forge')?.state === 'skip' && /nicht für Fabric/.test(item('Nur Forge')?.note ?? ''));
    check('Vorschau: Version gehört zu anderem Projekt', preview.items.some((i) => i.state === 'skip' && /anderen Projekt/.test(i.note ?? '')));
    check('Vorschau: gelöschte Version', item('Gelöscht')?.state === 'skip' && /nicht mehr/.test(item('Gelöscht')?.note ?? ''));
    check('Vorschau: andere Minecraft-Version nur Hinweis', item('Alte Mod')?.state === 'warn' && /Minecraft 26\.3/.test(item('Alte Mod')?.note ?? ''));
    check('Vorschau: Fabric API bringt der Launcher mit', item('Fabric API')?.state === 'skip');
    check('Vorschau: Store-Addon mit neuerer Version', item('Voice Chat')?.state === 'warn' && /1\.4\.0/.test(item('Voice Chat')?.note ?? '') && item('Voice Chat')?.icon === 'mic');
    check('Vorschau: Addon nicht im Store', item('Fehlt')?.state === 'skip');
    check('Vorschau: Grafik lesbar, Tasten gezählt', preview.graphics.includes('Sichtweite: 16 Chunks') && preview.graphics.includes('Heldix-Shader: kino') && preview.keys === 2, preview.graphics);
    check('Vorschau: Hinweis auf ungültige Einträge', preview.notes.some((n) => /1 ungültige/.test(n)), preview.notes);
    const blocked = await previewSetup(setup, { serviceUrl: server.base, publicKey: pem, checkTarget: async () => 'Für Minecraft 26.3 hat dieser Launcher noch keine HeldixClient-Mod.' });
    check('Vorschau: Problem der Ziel-Instanz', blocked.problem === 'Für Minecraft 26.3 hat dieser Launcher noch keine HeldixClient-Mod.');
    state.modrinthDown = true;
    state.storeUp = false;
    const down = await previewSetup(setup, { serviceUrl: server.base, publicKey: pem, checkTarget: target });
    state.modrinthDown = false;
    state.storeUp = true;
    check('Vorschau ohne Modrinth und Store: Einträge mit Hinweis statt Fehler', down.items.filter((i) => i.kind !== 'addons' && i.title !== 'Fabric API').every((i) => i.state === 'warn') && down.items.filter((i) => i.kind === 'addons').every((i) => i.state === 'warn') && down.notes.length === 3, down.notes);

    // ---------- Nachbauen ----------
    const target1 = createPaths(path.join(tmp, 'ziel'));
    const instances = new InstanceStore(target1);
    const progress: string[] = [];
    const result = await installSetup(setup, { name: '  Von Lena  ', graphics: true, keys: true }, {
      instances,
      serviceUrl: server.base,
      publicKey: pem,
      checkTarget: target,
      onProgress: (e) => progress.push(`${e.done}/${e.total}`),
      markInstalled: (code) => service.markInstalled(code),
    });
    const made = await instances.require(result.instanceId);
    const game = instances.dir(made.id);
    check('Nachbauen: Instanz mit Minecraft-Version, Loader und Namen', made.minecraft === MC && made.loader === 'fabric' && made.name === 'Von Lena' && made.heldixClient !== false, made);
    const modFiles = (await readdir(path.join(game, 'mods'))).sort();
    check('Nachbauen: Mods samt fehlender Pflicht-Abhängigkeit geladen', [P.sodium, P.iris, P.lithium, P.needDep, P.depMod, P.oldMc].every((x) => modFiles.includes(x.filename)), modFiles);
    check('Nachbauen: nichts von fremden Adressen, falscher Prüfsumme oder Forge', !modFiles.some((f) => /evil|badhash|forge|other/.test(f)) && !state.cdnCalls.some((p) => /example/.test(p)));
    for (const x of [P.sodium, P.lithium, P.depMod]) check(`Nachbauen: SHA-1 von ${x.title} stimmt`, sha1(await readFile(path.join(game, 'mods', x.filename))) === sha1(x.data));
    const index = JSON.parse(await readFile(path.join(game, 'mods', '.heldix-modrinth.json'), 'utf8')) as Record<string, { projectId: string; versionId: string }>;
    check('Nachbauen: Modrinth-Index für Updates', index[P.lithium.filename]?.versionId === P.lithium.version && index[P.depMod.filename]?.projectId === P.depMod.id, index);
    check('Nachbauen: Hinweis zur Abhängigkeit', result.notes.some((n) => /Abhängigkeit/.test(n) && /Braucht Abhängigkeit/.test(n)), result.notes);
    const skipped = (title: string) => result.skipped.find((s) => s.title === title)?.reason ?? '';
    check('Nachbauen: falsche Prüfsumme übersprungen', /Prüfsumme/.test(skipped('Falsche Prüfsumme')), result.skipped);
    check('Nachbauen: fremde Adresse übersprungen', /ungültig/.test(skipped('Fremde Adresse')));
    check('Nachbauen: Gründe für Forge, gelöscht, Fabric API', /Fabric/.test(skipped('Nur Forge')) && /nicht mehr/.test(skipped('Gelöscht')) && /selbst/.test(skipped('Fabric API')));
    const shaderFiles = (await readdir(path.join(game, 'shaderpacks'))).filter((f) => !f.startsWith('.')).sort();
    check('Nachbauen: Shaderpacks', shaderFiles.join(',') === 'a-shader.zip,b-shader.zip', shaderFiles);
    check('Nachbauen: aktives Shaderpack eingeschaltet', /shaderPack=b-shader\.zip/.test(await readFile(path.join(game, 'config', 'iris.properties'), 'utf8')));
    const packFiles = (await readdir(path.join(game, 'resourcepacks'))).sort();
    check('Nachbauen: Ressourcenpakete', packFiles.join(',') === 'pack-a.zip,pack-b.zip', packFiles);
    const addonFiles = await readdir(path.join(game, 'heldix-addons'));
    check('Nachbauen: Store-Addon in der aktuellen Version', addonFiles.includes('heldix-addon-voicechat-1.4.0.jar'), addonFiles);
    check('Nachbauen: verändertes Addon abgelehnt', !addonFiles.some((f) => f.includes('kaputt')) && /passt nicht|beschädigt|verändert/.test(skipped('Kaputt')), skipped('Kaputt'));
    check('Nachbauen: fehlendes Addon übersprungen', /Addon-Store/.test(skipped('Fehlt')));
    check('Nachbauen: Zähler', result.graphics === 7 && result.keys === 2, result);
    check('Nachbauen: Fortschritt bis zum Ende', progress.length > 5 && progress.at(-1)!.split('/')[0] === progress.at(-1)!.split('/')[1], progress.slice(-3));
    check('Nachbauen: „installiert“ beim Dienst gemeldet', state.installed.join(',') === CODE);
    const heldix = JSON.parse(await readFile(path.join(game, 'config', 'heldixclient.json'), 'utf8')) as Record<string, unknown>;
    check('Nachbauen: Leistungsprofil sofort', JSON.stringify(heldix.fpsBoost) === '{}' && heldix.backgroundFpsLimit === 20 && heldix.shader === 'kino' && !('hudScale' in heldix), heldix);
    check('Nachbauen: options.txt noch nicht geschrieben (Datenversion fehlt)', !(await stat(path.join(game, 'options.txt')).catch(() => null)));
    const pending = JSON.parse(await readFile(path.join(game, PENDING_OPTIONS_FILE), 'utf8')) as { options: Record<string, string>; resourcePacks: string[] };
    check('Nachbauen: Werte für den ersten Start gemerkt', pending.options.renderDistance === '16' && pending.options['key_key.forward'] === 'key.keyboard.w' && !('lang' in pending.options) && pending.resourcePacks.join(',') === 'pack-b.zip,pack-a.zip', pending);

    // erster Start: options.txt mit Datenversion
    const note = await applyPendingOptions(game, path.join(tmp, 'client.jar'));
    const optionsText = await readFile(path.join(game, 'options.txt'), 'utf8');
    check('Erster Start: options.txt mit version:-Zeile zuerst', optionsText.startsWith('version:4999\n'), optionsText);
    check('Erster Start: Grafik, Tasten und Ressourcenpakete', /\nrenderDistance:16\n/.test(optionsText) && /\nkey_key\.jump:key\.keyboard\.space\n/.test(optionsText) && optionsText.includes('resourcePacks:["vanilla","file/pack-b.zip","file/pack-a.zip"]'), optionsText);
    check('Erster Start: nichts vom PC', !/fullscreen|lang:/.test(optionsText));
    check('Erster Start: Merkdatei weg, Hinweis fürs Log', !(await stat(path.join(game, PENDING_OPTIONS_FILE)).catch(() => null)) && /übernommen/.test(note ?? ''));
    check('Zweiter Start: nichts mehr zu tun', (await applyPendingOptions(game, path.join(tmp, 'client.jar'))) === null);

    // ohne Datenversion bleibt die Merkdatei liegen
    await writeFile(path.join(game, PENDING_OPTIONS_FILE), JSON.stringify({ v: 1, options: { renderDistance: '8' }, resourcePacks: [] }));
    await rm(path.join(game, 'options.txt'));
    check('Ohne Datenversion: nichts geschrieben, später noch einmal', /nächsten Start/.test((await applyPendingOptions(game, path.join(tmp, 'fehlt.jar'))) ?? '') && !!(await stat(path.join(game, PENDING_OPTIONS_FILE)).catch(() => null)));
    // vorhandene options.txt: Werte einsetzen, eigene Zeilen bleiben, gefälschte Schlüssel weg
    await writeFile(path.join(game, 'options.txt'), 'version:4000\nrenderDistance:4\nlang:de_de\n');
    await writeFile(path.join(game, PENDING_OPTIONS_FILE), JSON.stringify({ v: 1, options: { renderDistance: '8', lang: 'en_us', 'key_key.x': 'key.keyboard.x\nfullscreen:true' }, resourcePacks: ['../böse.zip', 'gut.zip'] }));
    await applyPendingOptions(game, path.join(tmp, 'fehlt.jar'));
    const merged = await readFile(path.join(game, 'options.txt'), 'utf8');
    check('Vorhandene options.txt: Werte eingesetzt, Rest bleibt, Fremdes weg', merged === 'version:4000\nrenderDistance:8\nlang:de_de\nresourcePacks:["vanilla","file/gut.zip"]\n', merged);

    // ohne Grafik und Tasten, Heldix-Instanz bzw. Problem der Ziel-Instanz
    const result2 = await installSetup(setup, { name: '', graphics: false, keys: false }, { instances, serviceUrl: server.base, publicKey: pem, checkTarget: target });
    const game2 = instances.dir(result2.instanceId);
    const pending2 = JSON.parse(await readFile(path.join(game2, PENDING_OPTIONS_FILE), 'utf8')) as { options: Record<string, string>; resourcePacks: string[] };
    check('Ohne Grafik/Tasten: nur die Ressourcenpakete gemerkt', Object.keys(pending2.options).length === 0 && pending2.resourcePacks.length === 2 && result2.graphics === 0 && result2.keys === 0);
    check('Ohne Grafik: kein Leistungsprofil', !(await stat(path.join(game2, 'config', 'heldixclient.json')).catch(() => null)));
    check('Leerer Name: Name des Setups', (await instances.require(result2.instanceId)).name === 'PvP-Setup');
    const vanillaSetup = mapPublicSetup(publicBody({ ...crafted, loader: 'vanilla', settings: { graphics: null, keys: null } }), CODE);
    const result3 = await installSetup(vanillaSetup, {}, { instances, serviceUrl: server.base, publicKey: pem, checkTarget: target });
    check('Vanilla: keine Mods, Shaderpacks und Addons, aber Ressourcenpakete', result3.installed.every((i) => i.kind === 'resourcepacks') && result3.installed.length === 2
      && result3.skipped.some((s) => s.kind === 'mods' && /Fabric-Instanzen/.test(s.reason)) && result3.skipped.some((s) => s.kind === 'addons' && /HeldixClient/.test(s.reason)), result3);
    const count = (await instances.list()).length;
    await rejects('Problem der Ziel-Instanz: nichts angelegt', () => installSetup(setup, {}, { instances, serviceUrl: server.base, publicKey: pem, checkTarget: async () => 'Fabric unterstützt Minecraft 26.3 nicht.' }), /Fabric unterstützt/);
    check('Problem der Ziel-Instanz: keine neue Instanz', (await instances.list()).length === count);

    // pickModrinthFile streng
    const v = (url: string, filename = 'x.jar', hash = 'a'.repeat(40)): ModrinthVersion => ({ id: 'abcdefgh', project: 'abcdefgh', number: '1', loaders: ['fabric'], gameVersions: [], files: [{ url, filename, size: 10, sha1: hash, primary: true }], dependencies: [] });
    check('Datei: nur https://cdn.modrinth.com', pickModrinthFile(v('https://cdn.modrinth.com/data/x/x.jar'), 'mods') !== null && pickModrinthFile(v('http://cdn.modrinth.com/data/x/x.jar'), 'mods') === null
      && pickModrinthFile(v('https://cdn.modrinth.com.evil.de/x.jar'), 'mods') === null && pickModrinthFile(v('https://evil.de/cdn.modrinth.com/x.jar'), 'mods') === null);
    check('Datei: reiner Dateiname mit passender Endung', pickModrinthFile(v('https://cdn.modrinth.com/x', '../x.jar'), 'mods') === null && pickModrinthFile(v('https://cdn.modrinth.com/x', 'x.zip'), 'mods') === null && pickModrinthFile(v('https://cdn.modrinth.com/x', 'x.zip'), 'shaderpacks') !== null);
    check('Datei: SHA-1 nötig', pickModrinthFile(v('https://cdn.modrinth.com/x', 'x.jar', 'kurz'), 'mods') === null);

    // ---------- Partner-Server ----------
    const partner = mapPartner({ id: 'craftwelt', name: ' CraftWelt ', description: 'Minispiele', website: 'https://craftwelt.de', servers: ['Play.CraftWelt.de:25565', 'craftwelt.de', 'play.craftwelt.de', '127.0.0.1', 'localhost'], featured: true });
    check('Partner: gelesen, Adressen normalisiert und ohne IPs', partner?.name === 'CraftWelt' && partner.servers.join(',') === 'play.craftwelt.de,craftwelt.de' && partner.address === 'play.craftwelt.de' && partner.featured, partner);
    check('Partner: ungültig ohne Adresse, ID oder Namen', mapPartner({ id: 'x1', name: 'A', servers: ['a.de'] }) === null && mapPartner({ id: 'gut-1', name: 'A', servers: ['10.0.0.1'] }) === null && mapPartner({ id: 'gut-1', name: '', servers: ['a.de'] }) === null);
    check('Partner: Webseite nur https', mapPartner({ id: 'gut-1', name: 'A', servers: ['a.de'], website: 'http://a.de' })?.website === null);
    const list = mapPartners({ partners: [
      { id: 'zulu', name: 'Zulu', servers: ['zulu.net'] },
      { id: 'alpha', name: 'Alpha', servers: ['alpha.net'] },
      { id: 'mitte', name: 'Mitte', servers: ['mc.mitte.de:25570'], featured: true },
      { id: 'alpha', name: 'Doppelt', servers: ['x.net'] },
    ] });
    check('Partner: hervorgehobene zuerst, dann nach Name, keine doppelten', list.map((x) => x.id).join(',') === 'mitte,alpha,zulu');
    check('Partner: Domain deckt Subdomains ab', partnerFor('PLAY.alpha.net', list)?.id === 'alpha' && partnerFor('alpha.net:25565', list)?.id === 'alpha');
    check('Partner: ähnliche Domain passt nicht', partnerFor('notalpha.net', list) === null && partnerFor('alpha.net.evil.de', list) === null);
    check('Partner: Eintrag mit Port nur mit diesem Port', partnerFor('mc.mitte.de:25570', list)?.id === 'mitte' && partnerFor('mc.mitte.de', list) === null);
    state.partners = { status: 200, body: { partners: [{ id: 'alpha', name: 'Alpha', servers: ['alpha.net'] }] } };
    const updates: number[] = [];
    const client = new PartnerClient({ serviceUrl: server.base, onUpdate: (p) => updates.push(p.partners.length) });
    const first = await client.list();
    check('Partner-Liste vom Dienst', first.status === 'ok' && first.partners[0]?.id === 'alpha');
    state.partners = { status: 500, body: { error: 'Kaputt.' } };
    check('Partner-Liste: aus dem Speicher (1 Stunde)', (await client.list()).status === 'ok');
    const failed = await client.list(true);
    check('Partner-Liste: Fehler behält den letzten Stand', failed.partners.length === 1 && failed.error === 'Kaputt.', failed);
    state.partners = { status: 404, body: { error: 'Nicht gefunden.' } };
    check('Partner-Liste: Dienst ohne Partner', (await client.list(true)).status === 'unsupported' && (await new PartnerClient({ serviceUrl: '' }).list()).status === 'off');

    // ---------- Öffentliches Profil ----------
    check('Profil: Standardwerte', JSON.stringify(mapPublicProfile({ enabled: true, bio: 'Hallo\u0007 Welt' })) === JSON.stringify({ enabled: true, bio: 'Hallo Welt', showCosmetics: true, showWorlds: true, showBadges: true, showFriendsButton: true }));
    check('Profil: Bio höchstens 160 Zeichen', mapPublicProfile({ bio: 'x'.repeat(300) }).bio.length === 160);
    check('Profil-Link', publicProfileUrl('https://heldixclient.com/', 'Lena_2') === 'https://heldixclient.com/spieler/Lena_2' && publicProfileUrl('https://heldixclient.com', '../x') === null && publicProfileUrl('http://x.de', 'Lena') === null);
    const profiles = new PublicProfileClient(auth);
    check('Profil: Dienst ohne öffentliche Profile → null', (await profiles.get()) === null);
    state.profile = { enabled: false, bio: 'Baut gern', showCosmetics: false, showWorlds: true, showBadges: true, showFriendsButton: false };
    const on = await profiles.setEnabled(true);
    check('Profil: einschalten schickt alle Felder, nur enabled geändert', on.enabled && JSON.stringify(state.profilePuts.at(-1)) === JSON.stringify({ enabled: true, bio: 'Baut gern', showCosmetics: false, showWorlds: true, showBadges: true, showFriendsButton: false }), state.profilePuts);
    check('Profil: Stand danach', (await profiles.get())?.enabled === true);

    check('Kein Aufruf nach außen (nur Test-Server)', net.outside.length === 0, net.outside);
  } finally {
    net.restore();
    await server.close();
    await rm(tmp, { recursive: true, force: true });
  }
  finish('test-setupshare');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
