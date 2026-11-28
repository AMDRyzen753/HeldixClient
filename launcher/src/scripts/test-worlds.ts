// Prüft „Welt teilen“ im Launcher (core/worlds.ts) ohne Minecraft und ohne echten Dienst (npm run test:worlds):
// Welt-Links heldixclient://welt/<code> (streng: 6 Zeichen aus dem Einladungs-Alphabet), Adressen <code>.welt.<Domain>,
// eingefügte Links, Antworten des Dienstes, die Entscheidung „welche Instanz, geht Beitreten?“ und den Client gegen
// einen kleinen nachgebauten Dienst (offene Welten, Ereignisse, Dienst ohne Welt teilen, öffentliche Welt-Info).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ServiceError, serviceRequest } from '../main/core/heldixservice';
import {
  WorldClient,
  findWorldLink,
  isWorldMissing,
  mapFriendWorld,
  mapPublicWorld,
  normalizeWorldAddress,
  parsePastedWorld,
  parseWorldLink,
  planWorldJoin,
  worldAppUrl,
  worldCode,
  worldCodeOf,
  worldWebUrl,
  type WorldAuth,
  type WorldEvent,
  type WorldInstance,
} from '../main/core/worlds';
import type { WorldsOverview } from '../shared/api';
import { check, delay, finish } from './testkit';

const CODE = 'k7m2xq';
const HOST = { uuid: 'a'.repeat(32), name: 'Lena' };

function links(): void {
  check('Link: heldixclient://welt/<code>', parseWorldLink(`heldixclient://welt/${CODE}`) === CODE);
  check('Link: Protokoll groß, Schrägstrich am Ende', parseWorldLink(`HeldixClient://WELT/${CODE}/`) === CODE);
  const bad = [
    'heldixclient://welt/k7m2x', // 5 Zeichen
    'heldixclient://welt/k7m2xqa', // 7 Zeichen
    'heldixclient://welt/k7m2xi', // i nicht im Alphabet
    'heldixclient://welt/k7m2x0', // 0 nicht im Alphabet
    'heldixclient://welt/K7M2XQ', // Code nur klein
    `heldixclient://welt/${CODE}?x=1`,
    `heldixclient://welt/${CODE}#x`,
    `heldixclient://welt/${CODE}/mehr`,
    `heldixclient://einladung/${CODE}`,
    `https://heldixclient.com/welt#${CODE}`,
    `heldixclient://welt/${CODE}${' '.repeat(300)}x`,
  ];
  check('Link: alles andere fällt still weg', bad.every((link) => parseWorldLink(link) === null), bad.filter((link) => parseWorldLink(link) !== null));
  check('Link: kein Text → null', parseWorldLink(null) === null && parseWorldLink(42) === null);
  check('Befehlszeile: erster gültiger Welt-Link', findWorldLink(['launcher.exe', '--x', 'heldixclient://einladung/abcdefghjk', `heldixclient://welt/${CODE}`]) === CODE
    && findWorldLink(['launcher.exe', 'heldixclient://welt/kaput1']) === null);
  check('Code aus der Oberfläche', worldCode(CODE) === CODE);
  let threw = false;
  try {
    worldCode('../../etc');
  } catch {
    threw = true;
  }
  check('Code aus der Oberfläche: ungültig wirft', threw);
  check('App- und Web-Link', worldAppUrl(CODE) === `heldixclient://welt/${CODE}` && worldWebUrl('https://heldixclient.com/', CODE) === `https://heldixclient.com/welt#${CODE}`
    && worldWebUrl('http://heldixclient.com', CODE) === null && worldWebUrl('https://heldixclient.com', 'kaput1') === null);
}

function addresses(): void {
  check('Adresse: <code>.welt.<Domain>', worldCodeOf(`${CODE}.welt.heldixclient.com`) === CODE && worldCodeOf(`${CODE.toUpperCase()}.WELT.heldixclient.com:25565`) === CODE);
  check('Adresse: normalisiert (klein, ohne Standard-Port)', normalizeWorldAddress(`${CODE.toUpperCase()}.welt.Heldixclient.com:25565`) === `${CODE}.welt.heldixclient.com`
    && normalizeWorldAddress(`${CODE}.welt.heldixclient.com:25599`) === `${CODE}.welt.heldixclient.com:25599`);
  const bad = ['hypixel.net', `${CODE}.heldixclient.com`, `${CODE}.welt.`, 'k7m2xi.welt.heldixclient.com', `${CODE}.welt.heldixclient.com:99999`, `x${CODE}.welt.heldixclient.com`, '192.168.0.2'];
  check('Adresse: keine Welt', bad.every((a) => worldCodeOf(a) === null), bad.filter((a) => worldCodeOf(a) !== null));
}

function pasted(): void {
  check('Eingefügt: App-Link', parsePastedWorld(`heldixclient://welt/${CODE}`) === CODE);
  check('Eingefügt: Web-Link (auch ohne https, Code groß)', parsePastedWorld(`https://heldixclient.com/welt#${CODE}`) === CODE && parsePastedWorld(`heldixclient.com/welt#${CODE.toUpperCase()}`) === CODE);
  check('Eingefügt: Adresse und Link im Satz', parsePastedWorld(`${CODE}.welt.heldixclient.com`) === CODE && parsePastedWorld(`Komm in meine Welt: https://heldixclient.com/welt#${CODE}!`) === CODE);
  check('Eingefügt: bloßer Code, Einladungen und Müll zählen nicht', parsePastedWorld(CODE) === null && parsePastedWorld('https://heldixclient.com/einladung#abcdefghjk') === null
    && parsePastedWorld('heldixclient://welt/') === null && parsePastedWorld('x'.repeat(3000)) === null);
}

function mapping(): void {
  const world = mapFriendWorld({ id: 'f'.repeat(32), name: 'Insel\u0007 der Ruhe', address: `${CODE}.welt.heldixclient.com`, host: { uuid: 'A'.repeat(32), name: 'Lena' }, players: 3, maxPlayers: 8, version: '26.3', online: true });
  check('Welt eines Freundes: übernommen (Steuerzeichen weg, UUID klein)', world?.code === CODE && world.name === 'Insel der Ruhe' && world.host.uuid === 'a'.repeat(32) && world.players === 3 && world.version === '26.3', world);
  check('Welt eines Freundes: ungültig → null', mapFriendWorld({ id: 'x', address: `${CODE}.welt.x.de`, host: HOST }) === null
    && mapFriendWorld({ id: 'f'.repeat(32), address: 'hypixel.net', host: HOST }) === null
    && mapFriendWorld({ id: 'f'.repeat(32), address: `${CODE}.welt.x.de`, host: { uuid: 'kaputt' } }) === null
    && mapFriendWorld({ id: 'f'.repeat(32), address: `${CODE}.welt.x.de`, host: HOST, version: '26.3; rm -rf' })?.version === null);
  const view = mapPublicWorld({ name: '', host: HOST, online: true, players: 2, maxPlayers: 99, version: '26.3', access: 'friends' }, CODE);
  check('Öffentliche Welt-Info: Standardname, Grenzen, Zugang offen/geschlossen', view.name === 'Welt von Lena' && view.maxPlayers === 20 && view.access === 'closed' && view.address === null, view);
  check('Öffentliche Welt-Info: Adresse nur passend zum Code', mapPublicWorld({ host: HOST, address: `${CODE}.welt.heldixclient.com`, access: 'open' }, CODE).address === `${CODE}.welt.heldixclient.com`
    && mapPublicWorld({ host: HOST, address: 'abcdef.welt.heldixclient.com' }, CODE).address === null);
  let threw = false;
  try {
    mapPublicWorld({ name: 'ohne Gastgeber' }, CODE);
  } catch (error) {
    threw = error instanceof ServiceError;
  }
  check('Öffentliche Welt-Info: ohne Gastgeber ungültig', threw);
}

interface Inst extends WorldInstance {
  heldix: boolean;
}

function plans(): void {
  const instances: Inst[] = [
    { id: 'v', name: 'Vanilla 26.3', minecraft: '26.3', lastPlayed: 9_000, heldix: false },
    { id: 'h1', name: 'HeldixClient 26.3', minecraft: '26.3', lastPlayed: 1_000, heldix: true },
    { id: 'h2', name: 'HeldixClient 26.3 Kreativ', minecraft: '26.3', lastPlayed: 5_000, heldix: true },
    { id: 'h3', name: 'HeldixClient 26.2', minecraft: '26.2', lastPlayed: 8_000, heldix: true },
  ];
  const world = { online: true, version: '26.3', host: HOST, address: `${CODE}.welt.heldixclient.com` };
  const plan = (overrides: Partial<Parameters<typeof planWorldJoin<Inst>>[0]> = {}) =>
    planWorldJoin<Inst>({ world, instances, preferred: null, hasClient: (i) => i.heldix, gameRunning: false, self: 'b'.repeat(32), ...overrides });
  check('Beitreten: zuletzt gespielte HeldixClient-Instanz mit derselben Version', plan().instance?.id === 'h2' && plan().problem === null, plan());
  check('Beitreten: Vanilla mit gleicher Version und HeldixClient mit anderer Version zählen nicht', plan({ instances: instances.filter((i) => i.id === 'v' || i.id === 'h3') }).instance === null
    && /Minecraft 26\.3/.test(plan({ instances: instances.filter((i) => i.id === 'v' || i.id === 'h3') }).problem ?? ''));
  check('Beitreten: noch nie gespielt → bevorzugte bzw. erste passende', plan({ instances: instances.map((i) => ({ ...i, lastPlayed: null })), preferred: { ...instances[2], lastPlayed: null } }).instance?.id === 'h2'
    && plan({ instances: instances.map((i) => ({ ...i, lastPlayed: null })) }).instance?.id === 'h1');
  check('Beitreten: Version unbekannt → zuletzt gespielte mit HeldixClient', plan({ world: { ...world, version: null } }).instance?.id === 'h3');
  check('Beitreten: Welt zu → Hinweis', /nicht geöffnet/.test(plan({ world: { ...world, online: false } }).problem ?? ''));
  check('Beitreten: Spiel läuft → Hinweis', /läuft schon ein Spiel/.test(plan({ gameRunning: true }).problem ?? '') && plan({ gameRunning: true }).instance?.id === 'h2');
  check('Beitreten: eigene Welt → Hinweis', /eigene Welt/.test(plan({ self: HOST.uuid }).problem ?? ''));
  check('Beitreten: ohne Adresse → Hinweis', /Adresse/.test(plan({ world: { ...world, address: null } }).problem ?? ''));
}

// ---------- Client gegen einen nachgebauten Dienst ----------

class FakeService {
  url = '';
  requests: string[] = [];
  /** Antwort für GET /v1/worlds: Liste oder Status */
  worlds: unknown[] | number = [];
  publicWorlds = new Map<string, unknown>();
  private server = createServer((req, res) => this.handle(req, res));

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const route = `${req.method} ${req.url}`;
    this.requests.push(route);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (route === 'GET /v1/worlds') {
      if (typeof this.worlds === 'number') return json(this.worlds, { error: this.worlds === 503 ? 'Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet.' : 'Nicht gefunden.' });
      return json(200, { mine: [], friends: this.worlds });
    }
    const pub = /^GET \/v1\/public\/worlds\/([a-z0-9]+)$/.exec(route);
    if (pub) {
      const world = this.publicWorlds.get(pub[1]);
      return world ? json(200, world) : json(404, { error: 'Diese Welt gibt es nicht.' });
    }
    json(404, { error: 'Nicht gefunden.' });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function friendWorld(id: string, code: string, name: string, host = HOST): unknown {
  return { id: id.repeat(32).slice(0, 32), name, address: `${code}.welt.heldixclient.com`, host, players: 1, maxPlayers: 8, version: '26.3', online: true };
}

async function client(): Promise<void> {
  const fake = await new FakeService().start();
  let account = 'konto-1';
  const auth: WorldAuth = {
    authed: (route) => serviceRequest(fake.url, route, { token: 'test' }),
    accountId: async () => account,
    canAuthenticate: async () => true,
  };
  const updates: WorldsOverview[] = [];
  const events: WorldEvent[] = [];
  let enabled = true;
  const worlds = new WorldClient({ serviceUrl: fake.url, auth, enabled: async () => enabled, onUpdate: (o) => updates.push(o), onEvent: (e) => events.push(e) });

  fake.worlds = [friendWorld('1', CODE, 'Insel'), { kaputt: true }];
  let overview = await worlds.refresh();
  check('Offene Welten: geladen, Kaputtes fällt weg', overview.status === 'ok' && overview.friends.length === 1 && overview.friends[0].code === CODE, overview);
  check('Offene Welten: beim ersten Laden keine Meldung', events.length === 0);
  check('Offene Welten: Welt eines Freundes nach Gastgeber', worlds.worldOf(HOST.uuid)?.code === CODE && worlds.worldOf('c'.repeat(32)) === null);
  fake.worlds = [friendWorld('1', CODE, 'Insel'), friendWorld('2', 'abcdef', 'Burg', { uuid: 'd'.repeat(32), name: 'Max' })];
  overview = await worlds.refresh();
  check('Offene Welten: neue Welt → Meldung „geöffnet“, sortiert nach Gastgeber', events.length === 1 && events[0].world.host.name === 'Max' && overview.friends.map((w) => w.host.name).join() === 'Lena,Max', { events, overview });
  const updatesBefore = updates.length;
  await worlds.refresh();
  check('Offene Welten: unverändert → keine neue Meldung an die Oberfläche', updates.length === updatesBefore && events.length === 1);
  account = 'konto-2';
  fake.worlds = [friendWorld('3', 'ghjkmn', 'Neu')];
  await worlds.refresh();
  check('Offene Welten: Kontowechsel → keine Meldung beim ersten Laden', events.length === 1);
  enabled = false;
  overview = await worlds.refresh();
  check('Offene Welten: Freunde aus → „off“, keine Abfrage', overview.status === 'off' && overview.friends.length === 0);
  enabled = true;

  fake.worlds = 503;
  const before = fake.requests.length;
  overview = await worlds.refresh();
  check('Dienst ohne Welt teilen (503) → „unsupported“', overview.status === 'unsupported', overview);
  await worlds.refresh();
  check('… danach 30 Minuten Ruhe (keine weitere Abfrage)', fake.requests.length === before + 1, fake.requests.slice(before));

  const older = new WorldClient({ serviceUrl: fake.url, auth, enabled: async () => true });
  fake.worlds = 404;
  check('Dienst vor 1.12.0 (404) → „unsupported“', (await older.refresh()).status === 'unsupported');

  // öffentliche Welt-Info: zwischengespeichert, frisch auf Wunsch
  fake.publicWorlds.set(CODE, { name: 'Insel', address: `${CODE}.welt.heldixclient.com`, host: HOST, online: true, players: 2, maxPlayers: 8, version: '26.3', access: 'open' });
  const publicBefore = fake.requests.filter((r) => r.includes('/public/')).length;
  const info = await worlds.publicWorld(CODE);
  await worlds.publicWorld(CODE);
  check('Öffentliche Welt-Info: einmal gefragt, dann aus dem Speicher', info.host.name === 'Lena' && info.access === 'open' && fake.requests.filter((r) => r.includes('/public/')).length === publicBefore + 1);
  await worlds.publicWorld(CODE, true);
  check('Öffentliche Welt-Info: frisch = neu gefragt', fake.requests.filter((r) => r.includes('/public/')).length === publicBefore + 2);
  check('Öffentliche Welt-Info: aus dem Speicher ohne Warten', worlds.cachedPublicWorld(CODE)?.name === 'Insel');
  let missing = false;
  try {
    await worlds.publicWorld('mnpqrs');
  } catch (error) {
    missing = isWorldMissing(error);
  }
  check('Öffentliche Welt-Info: unbekannt → „gibt es nicht“', missing);
  let ready = 0;
  check('Öffentliche Welt-Info im Hintergrund: erst null, dann Meldung', worlds.cachedPublicWorld('stuvwx', () => ready++) === null);
  await delay(100);
  fake.publicWorlds.set('stuvwx', { name: 'Später', host: HOST, online: false, players: 0, maxPlayers: 4, version: null, access: 'closed' });
  check('… Meldung kam (auch bei Fehler) und Fehler wird kurz gemerkt', ready === 1 && worlds.cachedPublicWorld('stuvwx') === null, { ready });
  await fake.stop();
}

async function main(): Promise<void> {
  links();
  addresses();
  pasted();
  mapping();
  plans();
  await client();
  finish('Welt teilen (Launcher)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
