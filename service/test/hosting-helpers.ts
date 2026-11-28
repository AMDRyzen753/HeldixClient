// Hilfen für die Tests der dauerhaften Welten: nachgebaute Fill-API (Paper), Mojang-Manifest und Modrinth-API auf
// einem lokalen Port (nie die echten Dienste), Dienst mit FakeRunner und kurzen Zeiten, Freischalten, Warten.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/db';
import { HostingStore } from '../src/hosting/store';
import type { ServiceOptions } from '../src/app';
import { FakeRunner } from './fake-runner';
import { api, devPlayer, startService, type Player, type TestService } from './helpers';
import { Clock, WEBSITE } from './web-helpers';
import { DOMAIN } from './world-helpers';

export const PAPER_SHA = 'a'.repeat(64);
export const VANILLA_SHA1 = 'b'.repeat(40);

export interface FakeApis {
  url: string;
  /** alle Anfragen (Pfad mit Abfrage) und ihre User-Agents */
  requests: { path: string; userAgent: string }[];
  /** Modrinth-Projekte zum Anpassen in Tests */
  projects: Map<string, Record<string, unknown>>;
  versions: Map<string, Record<string, unknown>[]>;
  close(): Promise<void>;
}

function sha512(text: string): string {
  return createHash('sha512').update(text).digest('hex');
}

/** Modrinth-Version wie in der API (eine Jar auf cdn.modrinth.com). */
export function modrinthVersion(project: string, id: string, number: string, options: { loaders?: string[]; game?: string[]; type?: string; date?: string; url?: string; file?: string } = {}) {
  const file = options.file ?? `${project}-${number}.jar`;
  return {
    id,
    project_id: project,
    name: `${project} ${number}`,
    version_number: number,
    version_type: options.type ?? 'release',
    date_published: options.date ?? '2026-11-01T00:00:00Z',
    loaders: options.loaders ?? ['paper', 'bukkit'],
    game_versions: options.game ?? ['26.3'],
    files: [{ filename: file, url: options.url ?? `https://cdn.modrinth.com/data/${project}/versions/${id}/${file}`, primary: true, size: 1000, hashes: { sha512: sha512(id), sha1: 'c'.repeat(40) } }],
  };
}

export async function startFakeApis(): Promise<FakeApis> {
  const requests: { path: string; userAgent: string }[] = [];
  const projects = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, Record<string, unknown>[]>();
  projects.set('AbCdEf12', {
    id: 'AbCdEf12',
    slug: 'luckperms',
    title: 'LuckPerms',
    description: 'Rechte für Server',
    icon_url: 'https://cdn.modrinth.com/data/AbCdEf12/icon.png',
    downloads: 1000,
    followers: 10,
    loaders: ['paper', 'bukkit', 'fabric'],
    game_versions: ['26.3', '1.21.4'],
    categories: ['management'],
    license: { id: 'MIT' },
    source_url: 'https://github.com/example/luckperms',
  });
  versions.set('AbCdEf12', [
    modrinthVersion('AbCdEf12', 'Ver00001', '5.4.0', { date: '2026-10-01T00:00:00Z' }),
    modrinthVersion('AbCdEf12', 'Ver00002', '5.5.0', { date: '2026-11-01T00:00:00Z', file: 'LuckPerms Bukkit 5.5.0.jar' }),
    modrinthVersion('AbCdEf12', 'Ver00003', '5.6.0-beta', { date: '2026-11-20T00:00:00Z', type: 'beta' }),
    modrinthVersion('AbCdEf12', 'VerFabri', '5.6.0-fabric', { date: '2026-11-25T00:00:00Z', loaders: ['fabric'] }),
    modrinthVersion('AbCdEf12', 'VerOld01', '5.0.0', { date: '2026-01-01T00:00:00Z', game: ['1.21.4'] }),
  ]);
  projects.set('FabricOn', { id: 'FabricOn', slug: 'sodium', title: 'Sodium', description: '', loaders: ['fabric'], game_versions: ['26.3'] });
  projects.set('EvilCdn1', { id: 'EvilCdn1', slug: 'evil', title: 'Evil', description: '', loaders: ['paper'], game_versions: ['26.3'] });
  versions.set('EvilCdn1', [modrinthVersion('EvilCdn1', 'EvilVer1', '1.0', { url: 'https://evil.example/evil.jar' })]);

  const server: Server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    requests.push({ path: `${url.pathname}${url.search}`, userAgent: String(req.headers['user-agent'] ?? '') });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    };
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const p = url.pathname;
    // ---- Fill-API v3 (Paper) ----
    if (p === '/v3/projects/paper') return json(200, { project: { id: 'paper' }, versions: { '26.3': ['26.3', '26.3-rc-3'], '1.21': ['1.21.4'] } });
    const build = /^\/v3\/projects\/paper\/versions\/([^/]+)\/builds(\/latest)?$/.exec(p);
    if (build) {
      const version = build[1];
      const stable = (id: number) => ({
        id,
        channel: 'STABLE',
        downloads: { 'server:default': { name: `paper-${version}-${id}.jar`, checksums: { sha256: PAPER_SHA }, url: `https://fill-data.papermc.io/v1/objects/${PAPER_SHA}/paper-${version}-${id}.jar` } },
      });
      if (version === '26.3') return json(200, build[2] ? stable(263) : [stable(263)]);
      // 1.21.4: neuester Build ist nur ALPHA, stabil ist 120
      if (version === '1.21.4') return build[2] ? json(200, { ...stable(130), channel: 'ALPHA' }) : json(200, [stable(119), stable(120)]);
      return json(404, { ok: false, error: 'version_not_found' });
    }
    // ---- Mojang ----
    if (p === '/mojang/manifest.json') {
      return json(200, { versions: [{ id: '9.9', url: `${base}/mojang/9.9.json` }, { id: '26.3', url: `${base}/mojang/26.3.json` }] });
    }
    if (p === '/mojang/9.9.json') return json(200, { downloads: { server: { url: `https://piston-data.mojang.com/v1/objects/${VANILLA_SHA1}/server.jar`, sha1: VANILLA_SHA1 } } });
    // ---- Modrinth ----
    if (p === '/modrinth/v2/search') {
      return json(200, {
        hits: [
          { project_id: 'AbCdEf12', slug: 'luckperms', title: 'LuckPerms', description: 'Rechte', author: 'lucko', icon_url: 'https://cdn.modrinth.com/x.webp', downloads: 5, follows: 1, categories: ['paper'] },
          { project_id: '../böse', slug: 'x', title: 'kaputt' },
          { project_id: 'Other123', slug: 'other', title: 'Other', icon_url: 'https://evil.example/icon.png' },
        ],
        total_hits: 2,
      });
    }
    const versionList = /^\/modrinth\/v2\/project\/([^/]+)\/version$/.exec(p);
    if (versionList) {
      const id = decodeURIComponent(versionList[1]!);
      const project = [...projects.values()].find((x) => x.id === id || x.slug === id);
      if (!project) return json(404, { error: 'not_found' });
      const loaders = JSON.parse(url.searchParams.get('loaders') ?? '[]') as string[];
      const game = url.searchParams.get('game_versions');
      const games = game ? (JSON.parse(game) as string[]) : null;
      const list = (versions.get(String(project.id)) ?? []).filter(
        (v) => (v.loaders as string[]).some((l) => loaders.includes(l)) && (games === null || (v.game_versions as string[]).some((g) => games.includes(g))),
      );
      return json(200, list);
    }
    const projectPath = /^\/modrinth\/v2\/project\/([^/]+)$/.exec(p);
    if (projectPath) {
      const id = decodeURIComponent(projectPath[1]!);
      const project = [...projects.values()].find((x) => x.id === id || x.slug === id);
      return project ? json(200, project) : json(404, { error: 'not_found' });
    }
    json(404, { error: 'unbekannt' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    requests,
    projects,
    versions,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export interface HostingTest {
  service: TestService;
  runner: FakeRunner;
  apis: FakeApis;
  clock: Clock;
  close(): Promise<void>;
}

/** Dienst mit Welt teilen, FakeRunner, Fake-APIs und kurzen Zeiten. */
export async function startHosting(options: Partial<ServiceOptions> = {}, runner = new FakeRunner()): Promise<HostingTest> {
  const apis = await startFakeApis();
  const clock = new Clock();
  const service = await startService({
    dev: true,
    weltDomain: DOMAIN,
    website: WEBSITE,
    totpNow: clock.read,
    worldConnectionsPerMinute: 10_000,
    worldMaxConnectionsPerIp: 1000,
    hostingRunner: runner,
    hostingMax: 4,
    hostingTickMs: 20,
    hostingReadyPollMs: 15,
    hostingPingIntervalMs: 40,
    hostingStopTimeoutMs: 2000,
    hostingStartTimeoutMs: 5000,
    paperApi: apis.url,
    mojangManifest: `${apis.url}/mojang/manifest.json`,
    modrinthApi: `${apis.url}/modrinth`,
    discoverCacheMs: 0,
    pluginSearchRateLimit: 1000,
    hostingDownloadRateLimit: 1000,
    publicDiscoverRateLimit: 1000,
    discoverLikeRateLimit: 1000,
    ...options,
  });
  return {
    service,
    runner,
    apis,
    clock,
    async close() {
      await service.close();
      await apis.close();
    },
  };
}

/** Freischaltung „Beta: Dauerhafte Welten“ direkt in der Datenbank (wie das Team). */
export function grantBeta(service: TestService, uuid: string): void {
  const store = new Store(service.dataDir);
  try {
    new HostingStore(store).grant(uuid, 'beta', Date.now(), 'Test', null);
  } finally {
    store.close();
  }
}

export function setTeam(service: TestService, uuid: string, role: 'admin' | 'developer-team' | 'moderator' | 'supporter' | 'designer' | 'tester'): void {
  const store = new Store(service.dataDir);
  try {
    store.setTeamMember(uuid, role, Date.now(), null);
  } finally {
    store.close();
  }
}

/** Wartet, bis `check` wahr ist (fragt alle 10 ms). */
export async function waitFor<T>(check: () => T | Promise<T>, what: string, timeoutMs = 4000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`Nicht rechtzeitig: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Dauerhafte Welt einer Person im gewünschten Zustand (über GET /v1/hosting/worlds/<id>). */
export async function waitState(service: TestService, player: Player, id: string, state: string, timeoutMs = 4000): Promise<any> {
  let last: any = null;
  try {
    return await waitFor(
      async () => {
        const res = await api(service.url, 'GET', `/v1/hosting/worlds/${id}`, { token: player.token });
        last = res.body;
        return res.status === 200 && res.body.state === state ? res.body : null;
      },
      `Zustand ${state}`,
      timeoutMs,
    );
  } catch (err) {
    throw new Error(`${(err as Error).message} (zuletzt: ${JSON.stringify(last)})`);
  }
}

/** Freigeschalteter Spieler mit neuer, schlafender dauerhafter Welt. */
export async function hostedWorld(t: HostingTest, name?: string, body: Record<string, unknown> = {}): Promise<{ player: Player; world: any }> {
  const player = await devPlayer(t.service.url, name);
  grantBeta(t.service, player.uuid);
  const res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: player.token, body: { world: null, name: 'Insel', ...body } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const world = await waitState(t.service, player, res.body.id, 'sleeping');
  return { player, world };
}

/** Rohen Körper senden (Upload eines Teils). */
export async function putRaw(base: string, path: string, token: string, data: Buffer): Promise<{ status: number; body: any }> {
  const res = await fetch(base + path, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(data) });
  const text = await res.text();
  return { status: res.status, body: text === '' ? undefined : JSON.parse(text) };
}

/** ZIP in Teilen hochladen und abschließen; liefert die Antwort von finish. */
export async function uploadZip(t: HostingTest, player: Player, id: string, zip: Buffer, sha256 = createHash('sha256').update(zip).digest('hex')) {
  const start = await api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/upload`, { token: player.token, body: { size: zip.length } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const { chunkSize, chunks } = start.body;
  for (let i = chunks - 1; i >= 0; i--) {
    const part = await putRaw(t.service.url, `/v1/hosting/worlds/${id}/upload/${i}`, player.token, zip.subarray(i * chunkSize, (i + 1) * chunkSize));
    assert.equal(part.status, 200, JSON.stringify(part.body));
  }
  return api(t.service.url, 'POST', `/v1/hosting/worlds/${id}/upload/finish`, { token: player.token, body: { sha256 } });
}
