// Prüft Einladungslinks und Discord-Knöpfe (core/invites.ts, core/presence.ts) ohne Netz und gegen einen kleinen
// Fake-Dienst: Links heldixclient://einladung/<code> aus Befehlszeile, second-instance und open-url streng prüfen,
// Serveradresse für den Direktbeitritt, Instanz für „Annehmen und beitreten“, Antworten des Dienstes übersetzen,
// Ergebnis-Texte, Ereignisse statt Realtime (freigeschaltet, angenommen, bestätigt), Knöpfe im Discord-Status und der
// Zwischenspeicher der Einladungen dafür (nicht bei jeder Statusänderung neu fragen), Dienst ohne Einladungen (404).
//
// Aufruf: npm run test:invites

import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { InviteEvent, InviteState } from '../shared/api';
import { ServiceError, serviceRequest } from '../main/core/heldixservice';
import {
  DOWNLOAD_INVITE_FILE,
  DOWNLOAD_INVITE_MAX_MS,
  INVITE_MISSING,
  InviteService,
  acceptNotes,
  parsePastedInvite,
  takeDownloadInvite,
  readDownloadInvite,
  finishDownloadInvite,
  findInviteLink,
  inviteCode,
  inviteEvents,
  inviteServer,
  isMissing,
  mapAcceptResult,
  mapInviteState,
  mapPublicInvite,
  parseInviteLink,
  pickInviteInstance,
  type InviteAuth,
} from '../main/core/invites';
import { GET_BUTTON, JOIN_BUTTON, buildActivity, presenceButtons, presenceJoinServer, type PresenceInput } from '../main/core/presence';
import { check, delay, finish, rejects } from './testkit';

type Json = Record<string, any>;
const CODE = 'abcdefghjk';
const UUID = '0123456789abcdef0123456789abcdef';

// ---------- Fake-Dienst ----------
class FakeService {
  supported = true;
  requests: string[] = [];
  invites = new Map<string, Json>();
  state: Json = { invited: 0, confirmed: 0, pending: 0, rewards: [{ cosmetic: 'freundesband', friends: 3, unlocked: false }, { cosmetic: 'freundesfunken', friends: 1, unlocked: false }], unlocked: [] };
  website = 'https://heldixclient.com';
  private server: Server | null = null;
  private next = 0;
  url = '';

  code(): string {
    const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
    let n = ++this.next;
    let code = '';
    for (let i = 0; i < 10; i++) {
      code += letters[n % letters.length];
      n = Math.floor(n / letters.length) + 7;
    }
    return code;
  }

  link(server: string | null): Json {
    for (const invite of this.invites.values()) if (invite.server === server) return invite;
    const code = this.code();
    const invite = { code, url: this.website ? `${this.website}/einladung#${code}` : null, appUrl: `heldixclient://einladung/${code}`, created: Date.now(), expires: Date.now() + 30 * 86_400_000, server, voice: false, accepted: 0 };
    this.invites.set(code, invite);
    return invite;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let raw = '';
      req.on('data', (d: Buffer) => (raw += d.toString()));
      req.on('end', () => {
        this.requests.push(`${req.method} ${url.pathname}`);
        if (!this.supported) return send(404, { error: 'Nicht gefunden.' });
        const pub = /^\/v1\/public\/invites\/([^/]+)$/.exec(url.pathname);
        if (req.method === 'GET' && pub) {
          if (pub[1] !== CODE) return send(404, { error: 'Diese Einladung gibt es nicht.' });
          return send(200, { code: CODE, inviter: { uuid: UUID, name: 'Heldin' }, server: 'play.example.de:25570', voice: null, expires: Date.now() + 86_400_000, welcome: 'freundesfunken' });
        }
        const accept = /^\/v1\/invites\/([^/]+)\/accept$/.exec(url.pathname);
        if (req.method === 'POST' && accept) {
          if (req.headers.authorization !== 'Bearer test') return send(401, { error: 'Nicht angemeldet.' });
          if (accept[1] !== CODE) return send(404, { error: 'Nicht gefunden.' });
          return send(200, { inviter: { uuid: UUID, name: 'Heldin' }, server: 'play.example.de:25570', friend: 'new', reward: 'freundesfunken', rewardReason: null });
        }
        if (url.pathname === '/v1/invites' && req.method === 'POST') {
          const body = JSON.parse(raw || '{}') as Json;
          if (typeof body.server === 'string' && body.server.endsWith('.lan')) return send(400, { error: 'Nur öffentliche Server.' });
          return send(200, this.link(body.server ?? null));
        }
        if (url.pathname === '/v1/invites' && req.method === 'GET') {
          return send(200, { ...this.state, link: this.link(null), invites: [...this.invites.values()] });
        }
        const one = /^\/v1\/invites\/([^/]+)$/.exec(url.pathname);
        if (req.method === 'DELETE' && one) {
          this.invites.delete(one[1]);
          return send(200, { ok: true });
        }
        send(404, { error: 'Unbekannt.' });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  count(prefix: string): number {
    return this.requests.filter((r) => r.startsWith(prefix)).length;
  }
}

function fakeAuth(base: string, account: { id: string | null; microsoft: boolean }): InviteAuth {
  return {
    async authed<T>(route: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}, options: { offlineMessage?: string } = {}): Promise<T> {
      if (!account.id) throw new Error('Bitte zuerst ein Konto hinzufügen.');
      if (!account.microsoft) throw new Error(options.offlineMessage ?? 'offline');
      return serviceRequest<T>(base, route, { ...init, token: 'test', timeoutMs: 3000 });
    },
    accountId: async () => account.id,
    canAuthenticate: async () => account.id !== null && account.microsoft,
  };
}

function links(): void {
  // ---------- Links ----------
  check('Link: Code aus heldixclient://einladung/<code>', parseInviteLink(`heldixclient://einladung/${CODE}`) === CODE);
  check('Link: Schrägstrich am Ende, Protokoll in Großbuchstaben, Leerzeichen am Rand', parseInviteLink(`heldixclient://einladung/${CODE}/`) === CODE
    && parseInviteLink(`HeldixClient://Einladung/${CODE}`) === CODE && parseInviteLink(`  heldixclient://einladung/${CODE} `) === CODE);
  const bad = [
    'heldixclient://einladung/abcdefghji', // i
    'heldixclient://einladung/abcdefghjl', // l
    'heldixclient://einladung/abcdefghjo', // o
    'heldixclient://einladung/abcdefghj0', // 0
    'heldixclient://einladung/abcdefghj1', // 1
    'heldixclient://einladung/ABCDEFGHJK', // Code in Großbuchstaben
    'heldixclient://einladung/abcdefghj', // 9 Zeichen
    'heldixclient://einladung/abcdefghjkm', // 11 Zeichen
    `heldixclient://einladung/${CODE}?x=1`,
    `heldixclient://einladung/${CODE}#x`,
    `heldixclient://einladung/${CODE}/mehr`,
    `heldixclient://einladung//${CODE}`,
    `heldixclient://freunde/${CODE}`,
    `heldixclient:einladung/${CODE}`,
    `https://heldixclient.com/einladung#${CODE}`,
    'heldixclient://einladung/%61bcdefghjk',
    `heldixclient://einladung/${CODE} --inspect`,
    `heldixclient://einladung/${CODE}${' '.repeat(300)}x`,
    '',
  ];
  const accepted = bad.filter((link) => parseInviteLink(link) !== null);
  check('Link: alles andere wird verworfen', accepted.length === 0, accepted);
  check('Link: kein Text → null', parseInviteLink(null) === null && parseInviteLink(42) === null && parseInviteLink({ toString: () => CODE }) === null);
  check('Befehlszeile (fertige App): Link als Argument', findInviteLink(['C:\\Programme\\HeldixClient\\HeldixClient.exe', `heldixclient://einladung/${CODE}`]) === CODE);
  check('Befehlszeile (Entwicklung): electron . <Link>', findInviteLink(['electron.exe', '.', '--allow-file-access-from-files', `heldixclient://einladung/${CODE}`]) === CODE);
  check('Befehlszeile: ungültiger Link, dann gültiger → der gültige', findInviteLink(['app', 'heldixclient://einladung/kaputt', `heldixclient://einladung/${CODE}`]) === CODE);
  check('Befehlszeile ohne Link → null', findInviteLink(['app', '--hidden', 'C:\\x\\heldixclient-einladung']) === null && findInviteLink([]) === null);
  check('Befehlszeile: andere Argumente mit dem Code zählen nicht', findInviteLink(['app', CODE, `--url=heldixclient://einladung/${CODE}`]) === null);
  let thrown = '';
  try {
    inviteCode('../../v1/admin');
  } catch (error) {
    thrown = (error as Error).message;
  }
  check('Code aus der Oberfläche: ungültig → Fehler', thrown === 'Ungültiger Einladungslink.' && inviteCode(CODE) === CODE, thrown);

  // ---------- Serveradresse ----------
  const servers: [unknown, string | null][] = [
    ['Play.Example.de', 'play.example.de'],
    ['play.example.de:25565', 'play.example.de'],
    ['play.example.de:25570', 'play.example.de:25570'],
    [' mc.hypixel.net. ', 'mc.hypixel.net'],
    ['xn--mnchen-3ya.de', 'xn--mnchen-3ya.de'],
    ['192.168.0.12', null],
    ['192.168.0.12:25565', null],
    ['localhost', null],
    ['minecraft', null],
    ['[::1]:25565', null],
    ['evil/../x.de', null],
    ['a b.de', null],
    ['-bad.de', null],
    ['play.example.de:0', null],
    ['play.example.de:70000', null],
    ['play.example.123', null],
    [`${'a'.repeat(64)}.de`, null],
    [null, null],
  ];
  const wrong = servers.filter(([input, expected]) => inviteServer(input) !== expected).map(([input]) => input);
  check('Serveradresse: öffentliche Domain normalisiert, IPs und Unsinn → null', wrong.length === 0, wrong);

  // ---------- Instanz für „Annehmen und beitreten“ ----------
  const list = [
    { id: 'vanilla', client: false, lastPlayed: 900 },
    { id: 'heldix-alt', client: true, lastPlayed: 100 },
    { id: 'heldix-neu', client: true, lastPlayed: 500 },
    { id: 'heldix-nie', client: true, lastPlayed: null },
  ];
  const has = (i: { client: boolean }) => i.client;
  check('Instanz: zuletzt gespielte mit HeldixClient (nicht die Vanilla-Instanz)', pickInviteInstance(list, list[3], has)?.id === 'heldix-neu');
  check('Instanz: noch keine gespielt → ausgewählte mit HeldixClient', pickInviteInstance([list[0], list[3], { ...list[1], lastPlayed: null }], list[3], has)?.id === 'heldix-nie');
  check('Instanz: Auswahl ohne HeldixClient → erste mit HeldixClient', pickInviteInstance([{ ...list[1], lastPlayed: null }, list[3]], list[0], has)?.id === 'heldix-alt');
  check('Instanz: keine mit HeldixClient → null', pickInviteInstance([list[0]], list[0], has) === null);
}

function mapping(): void {
  const invite = mapPublicInvite({ code: CODE, inviter: { uuid: '01234567-89ab-cdef-0123-456789ABCDEF', name: 'Heldin' }, server: 'Play.Example.de:25570', voice: { members: 2, guests: 1, maxGuests: 4 }, expires: '2026-12-01T10:00:00.000Z', welcome: 'freundesfunken' }, CODE);
  check('öffentliche Einladung: UUID klein ohne Striche, Server normalisiert, Zeit aus ISO', invite.inviter.uuid === UUID && invite.server === 'play.example.de:25570' && invite.expires === Date.parse('2026-12-01T10:00:00.000Z') && invite.welcome === 'freundesfunken' && invite.voice?.members === 2, invite);
  check('öffentliche Einladung: IP-Adresse als Server fällt weg', mapPublicInvite({ inviter: { uuid: UUID, name: 'X' }, server: '10.0.0.1' }, CODE).server === null);
  let invalid = false;
  try {
    mapPublicInvite({ inviter: { uuid: 'nicht-gueltig' } }, CODE);
  } catch (error) {
    invalid = error instanceof ServiceError;
  }
  check('öffentliche Einladung ohne gültigen Einladenden: ungültige Antwort', invalid);

  const state = mapInviteState({
    link: { code: CODE, url: `https://heldixclient.com/einladung#${CODE}`, appUrl: 'heldixclient://einladung/boese', expires: 5, server: null, voice: false },
    invites: [
      { code: CODE, url: 'javascript:alert(1)', created: 1, expires: 5, server: null, voice: false, accepted: 2 },
      { code: 'falsch!', url: 'https://x.de', expires: 5 },
      { code: 'mnpqrstuvw', url: null, expires: 9, server: 'mc.example.de', voice: true, accepted: 0 },
    ],
    invited: 3,
    confirmed: 1,
    rewards: [{ cosmetic: 'freundesband', friends: 3 }, { cosmetic: 'freundesfunken', friends: 1, unlocked: false }, { cosmetic: 'Böse' }],
    unlocked: ['freundesfunken', 'freundesfunken', '../x'],
  }, { freundesband: 'Freundesband (Katalog)' });
  check('Übersicht: appUrl immer selbst gebaut, nur http(s)-Links', state.link?.appUrl === `heldixclient://einladung/${CODE}` && state.invites[0].url === null && state.invites[0].appUrl.endsWith(CODE));
  check('Übersicht: ungültige Einladungen fallen weg, Voice und Server übernommen', state.invites.length === 2 && state.invites[1].voice && state.invites[1].server === 'mc.example.de', state.invites);
  check('Übersicht: ausstehend = eingeladen − bestätigt, wenn der Dienst es nicht schickt', state.invited === 3 && state.confirmed === 1 && state.pending === 2);
  check('Übersicht: Belohnungen aufsteigend, Name aus dem Katalog bzw. bekannt, freigeschaltet aus unlocked',
    state.rewards.map((r) => `${r.cosmetic}:${r.friends}:${r.unlocked}:${r.name}`).join() === 'freundesfunken:1:true:Freundesfunken,freundesband:3:false:Freundesband (Katalog)', state.rewards);
  check('Übersicht: unlocked ohne Doppelte und ungültige IDs', state.unlocked.join() === 'freundesfunken', state.unlocked);

  const result = mapAcceptResult({ inviter: { uuid: UUID, name: 'Heldin' }, server: 'play.example.de', friend: 'new', reward: 'freundesfunken', rewardReason: null });
  check('Annehmen: Ergebnis übernommen', result.friend === 'new' && result.reward === 'freundesfunken' && result.server === 'play.example.de');
  check('Annehmen: Einladender aus der Einladung, wenn er fehlt', mapAcceptResult({ friend: 'already' }, { uuid: UUID, name: 'Heldin' }).inviter.name === 'Heldin');
  let bogus = false;
  try {
    mapAcceptResult({ inviter: { uuid: UUID, name: 'X' }, friend: 'vielleicht' });
  } catch {
    bogus = true;
  }
  check('Annehmen: unbekanntes Freundschafts-Ergebnis → ungültige Antwort', bogus);

  const notes = acceptNotes(result, 'Freundesfunken');
  check('Texte: neu befreundet und Belohnung', notes.length === 2 && notes.every((n) => n.tone === 'success') && notes[0].text === 'Du und Heldin seid jetzt Freunde.' && /Belohnung freigeschaltet: Freundesfunken/.test(notes[1].text), notes);
  const notNew = acceptNotes({ ...result, friend: 'already', reward: null, rewardReason: 'not-new' });
  check('Texte: schon befreundet, Belohnung nur für neue Spieler', notNew.length === 2 && /schon befreundet/.test(notNew[0].text) && /nur für neue Spieler/.test(notNew[1].text), notNew);
  const blocked = acceptNotes({ ...result, friend: 'blocked', reward: null, rewardReason: 'already-invited' });
  check('Texte: blockiert (ohne zu verraten, wer), Belohnung nur einmal', blocked[0].tone === 'warn' && !/dich|hat dich/.test(blocked[0].text) && /nur einmal/.test(blocked[1].text), blocked);
  check('Texte: Grenze und eigene Einladung', /Freundesliste ist voll/.test(acceptNotes({ ...result, friend: 'limit', reward: null })[0].text)
    && /eigene Einladung/.test(acceptNotes({ ...result, friend: 'self', reward: null, rewardReason: 'self' })[0].text)
    && acceptNotes({ ...result, friend: 'self', reward: null, rewardReason: 'self' }).length === 1);
  check('404 = Einladung weg', isMissing(new ServiceError('x', 404)) && !isMissing(new ServiceError('x', 500)) && !isMissing(new Error('x')));
}

function events(): void {
  const base: InviteState = { available: true, error: null, link: null, invites: [{ code: CODE, url: null, appUrl: '', created: 0, expires: 0, server: null, voice: false, accepted: 1 }], invited: 1, confirmed: 0, pending: 1, rewards: [], unlocked: [] };
  const snap = (state: InviteState, account = 'konto') => ({ account, unlocked: new Set(state.unlocked), invited: state.invited, confirmed: state.confirmed, accepted: new Map(state.invites.map((i) => [i.code, i.accepted])) });
  check('Ereignisse: erster Stand → keine', inviteEvents(null, base, 'konto', []).length === 0);
  check('Ereignisse: anderes Konto → keine', inviteEvents(snap(base, 'alt'), { ...base, invited: 5, unlocked: ['freundesband'] }, 'konto', []).length === 0);
  check('Ereignisse: nichts Neues → keine', inviteEvents(snap(base), base, 'konto', ['Jemand']).length === 0);
  const unlocked = inviteEvents(snap(base), { ...base, unlocked: ['freundesfunken'] }, 'konto', [], { freundesfunken: 'Freundesfunken!' });
  check('Ereignisse: neue Freischaltung mit Namen aus dem Katalog', JSON.stringify(unlocked) === JSON.stringify([{ kind: 'unlock', cosmetic: 'freundesfunken', name: 'Freundesfunken!' }]), unlocked);
  const one = inviteEvents(snap(base), { ...base, invited: 2, pending: 2, invites: [{ ...base.invites[0], accepted: 2 }] }, 'konto', ['Neuling']);
  check('Ereignisse: angenommen, genau ein neuer Freund → mit Namen', JSON.stringify(one) === JSON.stringify([{ kind: 'accepted', name: 'Neuling', count: 1 }]), one);
  const two = inviteEvents(snap(base), { ...base, invited: 3 }, 'konto', ['A', 'B']);
  check('Ereignisse: zwei angenommen → ohne Namen, Anzahl 2', two.length === 1 && two[0].kind === 'accepted' && two[0].name === null && two[0].count === 2, two);
  const existing = inviteEvents(snap(base), { ...base, invites: [...base.invites, { ...base.invites[0], code: 'mnpqrstuvw', accepted: 1 }] }, 'konto', ['Alter Hase']);
  check('Ereignisse: bestehender Spieler nimmt einen neuen Link an (nur Zähler am Link) → angenommen', existing.length === 1 && existing[0].kind === 'accepted' && existing[0].name === 'Alter Hase', existing);
  const revoked = inviteEvents(snap(base), { ...base, invites: [] }, 'konto', []);
  check('Ereignisse: widerrufener Link → keine Meldung', revoked.length === 0, revoked);
  const confirmed = inviteEvents(snap(base), { ...base, confirmed: 1, pending: 0, unlocked: ['freundesfunken'] }, 'konto', []);
  check('Ereignisse: bestätigt (und Belohnung freigeschaltet)', confirmed.map((e) => e.kind).join() === 'unlock,confirmed', confirmed);
}

function presence(): void {
  const running: Pick<PresenceInput, 'phase' | 'status' | 'showServer'> = { phase: 'running', status: { mode: 'multiplayer', server: 'play.example.de:25570' }, showServer: true };
  check('Mitspielen: laufendes Spiel auf einer öffentlichen Domain', presenceJoinServer(running) === 'play.example.de:25570');
  check('Mitspielen: nicht, wenn der Server nicht gezeigt wird', presenceJoinServer({ ...running, showServer: false }) === null);
  check('Mitspielen: nicht bei IP-Adressen, localhost, Heimnetz', ['192.168.0.12:25565', 'localhost', 'server.local', 'minecraft'].every((server) => presenceJoinServer({ ...running, status: { mode: 'multiplayer', server } }) === null));
  check('Mitspielen: nicht im Hauptmenü, Einzelspieler oder im Launcher', presenceJoinServer({ ...running, status: { mode: 'menu' } }) === null
    && presenceJoinServer({ ...running, status: { mode: 'singleplayer' } }) === null && presenceJoinServer({ ...running, phase: 'launcher' }) === null);
  const linksBoth = { general: 'https://heldixclient.com/einladung#aaaaaaaaaa', server: 'https://heldixclient.com/einladung#bbbbbbbbbb' };
  const both = presenceButtons(running, linksBoth);
  check('Knöpfe: „Mitspielen“ und „HeldixClient holen“', both.map((b) => b.label).join() === `${JOIN_BUTTON},${GET_BUTTON}` && both[0].url === linksBoth.server && both[1].url === linksBoth.general, both);
  check('Knöpfe: Beschriftung höchstens 32 Zeichen', both.every((b) => b.label.length <= 32));
  check('Knöpfe: nicht beitretbar → nur „HeldixClient holen“, auch mit Server-Link', presenceButtons({ ...running, showServer: false }, linksBoth).map((b) => b.label).join() === GET_BUTTON);
  check('Knöpfe: ohne Links keine', presenceButtons(running, { general: null, server: null }).length === 0);
  check('Knöpfe: nur https, höchstens 512 Zeichen, kein eigenes Protokoll', presenceButtons(running, { general: `heldixclient://einladung/${CODE}`, server: 'http://heldixclient.com/einladung#x' }).length === 0
    && presenceButtons(running, { general: `https://heldixclient.com/${'x'.repeat(520)}`, server: null }).length === 0);
  const input: PresenceInput = { ...running, minecraft: '26.3', loader: 'heldix', startedAt: 1000, clientVersion: '0.13.7' };
  const activity = buildActivity({ ...input, buttons: both });
  check('Discord-Status: Knöpfe im Status', JSON.stringify(activity.buttons) === JSON.stringify(both) && activity.details === 'Spielt auf play.example.de', activity);
  const plain = buildActivity(input);
  check('Discord-Status: ohne Knöpfe unverändert (kein Feld buttons)', !('buttons' in plain) && plain.details === 'Spielt auf play.example.de');
  check('Discord-Status: im Launcher „HeldixClient holen“', buildActivity({ phase: 'launcher', showServer: true, clientVersion: 'x', buttons: presenceButtons({ phase: 'launcher', showServer: true }, linksBoth) }).buttons?.map((b) => b.label).join() === GET_BUTTON);
}

async function service(): Promise<void> {
  const fake = await new FakeService().start();
  const account = { id: 'konto-1' as string | null, microsoft: true };
  let enabled = true;
  const seen: InviteEvent[] = [];
  let linkUpdates = 0;
  const make = (url = fake.url) => new InviteService({
    serviceUrl: url,
    auth: fakeAuth(url, account),
    enabled: async () => enabled,
    cosmeticNames: async () => ({ freundesfunken: 'Freundesfunken' }),
    onEvent: (event) => seen.push(event),
    onLinks: () => linkUpdates++,
  });
  try {
    const invites = make();
    // ---------- Öffnen und Annehmen ----------
    const invite = await invites.publicInvite(CODE);
    check('Dienst: öffentliche Einladung ohne Anmeldung', invite.inviter.name === 'Heldin' && invite.server === 'play.example.de:25570' && invite.welcome === 'freundesfunken' && fake.count('GET /v1/public/invites/') === 1);
    const missing = await invites.publicInvite('mnpqrstuvw').then(() => null, (e: unknown) => e);
    check('Dienst: unbekannte Einladung → 404 (isMissing)', isMissing(missing), missing);
    await rejects('Dienst: ungültiger Code geht gar nicht erst raus', () => invites.publicInvite('../../x'), /Ungültiger Einladungslink/);
    check('… keine Anfrage', fake.count('GET /v1/public/invites/') === 2);
    const result = await invites.accept(CODE);
    check('Dienst: annehmen mit Anmeldung', result.friend === 'new' && result.reward === 'freundesfunken');
    await rejects('Dienst: annehmen einer unbekannten Einladung → klare Meldung', () => invites.accept('mnpqrstuvw'), new RegExp(INVITE_MISSING.slice(0, 30)));
    account.microsoft = false;
    await rejects('Dienst: annehmen mit Offline-Konto → Hinweis Microsoft-Konto', () => invites.accept(CODE), /nur mit einem Microsoft-Konto/);
    account.microsoft = true;

    // ---------- Übersicht und Ereignisse ----------
    let state = await invites.state();
    check('Übersicht: verfügbar, allgemeiner Link angelegt', state.available && !!state.link && state.link.server === null && state.link.url?.startsWith('https://heldixclient.com/einladung#') === true, state);
    check('Übersicht: erster Stand ohne Meldung', seen.length === 0, seen);
    fake.state = { ...fake.state, invited: 1, pending: 1 };
    invites.friendsAdded(['Neuling']);
    await invites.poll();
    check('angenommen: Meldung mit dem Namen des neuen Freundes', JSON.stringify(seen) === JSON.stringify([{ kind: 'accepted', name: 'Neuling', count: 1 }]), seen);
    fake.state = { ...fake.state, confirmed: 1, pending: 0, unlocked: ['freundesfunken'] };
    await invites.poll();
    check('bestätigt und freigeschaltet: Meldungen', seen.slice(1).map((e) => e.kind).join() === 'unlock,confirmed' && (seen[1] as { name: string }).name === 'Freundesfunken', seen);
    await invites.poll();
    check('nichts Neues: keine weitere Meldung', seen.length === 3, seen.length);
    enabled = false;
    const before = fake.requests.length;
    await invites.poll();
    check('Freunde ausgeschaltet: keine Abfrage im Hintergrund', fake.requests.length === before);
    enabled = true;

    // ---------- Discord ----------
    const fresh = make();
    linkUpdates = 0;
    const posts = () => fake.count('POST /v1/invites') - fake.count('POST /v1/invites/');
    const postsBefore = posts();
    let presenceLinks = await fresh.presenceLinks(null);
    check('Discord: noch nichts im Speicher → keine Knöpfe, Einladung wird geholt', presenceLinks.general === null);
    for (let i = 0; i < 50 && linkUpdates === 0; i++) await delay(20);
    presenceLinks = await fresh.presenceLinks(null);
    const general = [...fake.invites.values()].find((i) => i.server === null);
    check('Discord: danach der allgemeine Link (onLinks gerufen)', linkUpdates === 1 && presenceLinks.general === general?.url, { linkUpdates, presenceLinks });
    for (let i = 0; i < 5; i++) await fresh.presenceLinks(null);
    check('Discord: wiederholte Statusänderungen fragen nicht erneut', posts() === postsBefore + 1, posts() - postsBefore);
    presenceLinks = await fresh.presenceLinks('Play.Example.de:25570');
    for (let i = 0; i < 50 && linkUpdates < 2; i++) await delay(20);
    presenceLinks = await fresh.presenceLinks('play.example.de:25570');
    check('Discord: Link für den Server (gleicher Server in anderer Schreibweise = derselbe Eintrag)', presenceLinks.server?.includes('/einladung#') === true && presenceLinks.server !== presenceLinks.general && posts() === postsBefore + 2, { presenceLinks, posts: posts() - postsBefore });
    await fresh.presenceLinks('play.example.de:25570');
    check('Discord: Server-Link aus dem Speicher', posts() === postsBefore + 2);
    await fresh.presenceLinks('10.0.0.1:25565');
    check('Discord: IP-Adresse → keine Anfrage', posts() === postsBefore + 2);
    check('Discord: abgelehnter Server → kein Link', (await fresh.presenceLinks('privat.lan')).server === null);
    await delay(150);
    const afterRefusal = posts();
    await fresh.presenceLinks('privat.lan');
    await fresh.presenceLinks('privat.lan');
    check('Discord: abgelehnter Server (400) wird gemerkt, nur ein Versuch', afterRefusal === postsBefore + 3 && posts() === afterRefusal && (await fresh.presenceLinks('privat.lan')).server === null, posts() - postsBefore);
    fake.website = '';
    fake.invites.clear();
    const noSite = make();
    await noSite.presenceLinks(null);
    await delay(150);
    check('Discord: Dienst ohne Webseite → keine Knöpfe (nur https-Links)', (await noSite.presenceLinks(null)).general === null);
    fake.website = 'https://heldixclient.com';
    fake.invites.clear();
    enabled = false;
    check('Discord: Freunde aus → keine Knöpfe', (await fresh.presenceLinks(null)).general === null);
    enabled = true;
    account.microsoft = false;
    check('Discord: ohne Anmeldung beim Dienst (Offline-Konto) → keine Knöpfe', (await fresh.presenceLinks(null)).general === null);
    account.microsoft = true;
    account.id = 'konto-2';
    check('Discord: anderes Konto → eigener Speicher', (await fresh.presenceLinks(null)).general === null);
    await delay(150);
    account.id = 'konto-1';
    const current = (await fresh.state()).link!;
    const beforeRevoke = linkUpdates;
    state = await fresh.revoke(current.code);
    check('Widerrufen: Link weg, Discord-Links neu holen', !state.invites.some((i) => i.code === current.code) && linkUpdates > beforeRevoke && fake.count('DELETE /v1/invites/') === 1);
    check('… der Discord-Status bekommt den neuen allgemeinen Link', (await fresh.presenceLinks(null)).general === state.link?.url && !!state.link?.url && state.link.code !== current.code, state.link);
    await rejects('Link für einen Server: IP-Adresse abgelehnt ohne Anfrage', () => fresh.create('192.168.0.1'), /öffentliche Serveradresse/);
    const serverLink = await fresh.create('mc.example.de');
    check('Link für einen Server anlegen', serverLink.server === 'mc.example.de' && serverLink.appUrl === `heldixclient://einladung/${serverLink.code}`);

    // ---------- Dienst ohne Einladungen ----------
    fake.supported = false;
    const old = make();
    state = await old.state();
    check('Dienst ohne Einladungen (404): Bereich nicht verfügbar, kein Fehler', !state.available && state.error === null && state.invites.length === 0);
    const count = fake.requests.length;
    await old.poll();
    check('… danach keine Abfragen im Hintergrund und keine Discord-Knöpfe', fake.requests.length === count && (await old.presenceLinks(null)).general === null && fake.requests.length === count);
    const oldPublic = await old.publicInvite(CODE).then(() => null, (e: unknown) => e);
    check('… Link öffnen: 404 → „gibt es nicht (mehr)“', isMissing(oldPublic));
    const none = new InviteService({ serviceUrl: '', auth: null, enabled: async () => true });
    check('ohne Dienst eingerichtet: keine Knöpfe', (await none.presenceLinks(null)).general === null);
    await rejects('ohne Dienst eingerichtet: Übersicht mit Meldung', () => none.state(), /Kein Heldix-Dienst/);
  } finally {
    await fake.stop();
  }
}

/** „Link von einem Freund? Hier einfügen“ (Freunde → Einladen) */
function pasted(): void {
  const good: [string, string][] = [
    [`heldixclient://einladung/${CODE}`, 'Launcher-Link'],
    [`HeldixClient://einladung/${CODE.toUpperCase()}`, 'Launcher-Link mit Großbuchstaben'],
    [`https://heldixclient.com/einladung#${CODE}`, 'Web-Link'],
    [`http://heldixclient.com/einladung/#${CODE}`, 'Web-Link mit http und Schrägstrich'],
    [`heldixclient.com/einladung#${CODE.toUpperCase()}`, 'Web-Link ohne https:// (Adresszeile), Code groß'],
    [`https://heldixclient.com/einladung.html#${CODE}`, 'Web-Link auf die .html-Seite'],
    [`  https://heldixclient.com/einladung#${CODE}\n`, 'Leerzeichen und Zeilenumbruch am Rand'],
    [CODE, 'nur der Code'],
    [`Komm spielen: https://heldixclient.com/einladung#${CODE}!`, 'Link mitten in einer Nachricht'],
    [`„heldixclient://einladung/${CODE}“`, 'Link in Anführungszeichen'],
  ];
  const wrongGood = good.filter(([text]) => parsePastedInvite(text) !== CODE).map(([, label]) => label);
  check('Einfügen: Web-Link, heldixclient://-Link, Code und Link im Satz → Code', wrongGood.length === 0, wrongGood);
  const bad = [
    '',
    '   ',
    'abcdefghji',
    `https://heldixclient.com/konto#${CODE}`,
    `https://heldixclient.com/einladung?code=${CODE}`,
    `https://heldixclient.com/einladung#${CODE}x`,
    `https://heldixclient.com/einladung#abcdefghj1`,
    `heldixclient://freunde/${CODE}`,
    `heldixclient://einladung/${CODE}/mehr`,
    `javascript:alert(1)//einladung#${CODE}`,
    `file:///C:/einladung#${CODE}`,
    `Komm spielen, Code ${CODE}`,
    'x'.repeat(5000),
  ];
  const wrongBad = bad.filter((text) => parsePastedInvite(text) !== null);
  check('Einfügen: alles andere → null', wrongBad.length === 0, wrongBad);
  check('Einfügen: kein Text → null', parsePastedInvite(null) === null && parsePastedInvite(42) === null);
}

/** Einladung aus dem Download: download-invite.txt vom Windows-Installer (build/installer.nsh) */
async function downloadInvite(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'heldix-download-invite-'));
  const file = path.join(dir, DOWNLOAD_INVITE_FILE);
  try {
    check('Download: Dateiname im Datenordner', DOWNLOAD_INVITE_FILE === 'download-invite.txt');
    check('Download: keine Datei → null', (await takeDownloadInvite(file)) === null);

    await writeFile(file, `${CODE}`);
    check('Download: Code wird gelesen', (await takeDownloadInvite(file)) === CODE);
    check('Download: Datei danach gelöscht (nur einmal)', !existsSync(file) && (await takeDownloadInvite(file)) === null);

    // Launcher mitten im Einrichtungs-Assistenten geschlossen: gelesen, aber noch nicht gezeigt → Datei bleibt
    await writeFile(file, `${CODE}`);
    check('Download: nur gelesen → Datei bleibt (nächster Start zeigt sie wieder)', (await readDownloadInvite(file)) === CODE && existsSync(file));
    check('Download: beim nächsten Start wieder da', (await readDownloadInvite(file)) === CODE);
    await finishDownloadInvite(file);
    check('Download: nach dem Zeigen gelöscht', !existsSync(file) && (await readDownloadInvite(file)) === null);
    await finishDownloadInvite(file);
    check('Download: zweimal löschen schadet nicht', !existsSync(file));
    await writeFile(file, 'kaputt');
    check('Download: nur gelesen, aber ungültig → gleich gelöscht', (await readDownloadInvite(file)) === null && !existsSync(file));

    await writeFile(file, `\uFEFF${CODE}\r\n`);
    check('Download: BOM und Zeilenumbruch stören nicht', (await takeDownloadInvite(file)) === CODE);

    await writeFile(file, CODE);
    const old = new Date(Date.now() - DOWNLOAD_INVITE_MAX_MS - 60_000);
    await utimes(file, old, old);
    check('Download: älter als 7 Tage → null, Datei trotzdem gelöscht', (await takeDownloadInvite(file)) === null && !existsSync(file));

    await writeFile(file, CODE);
    const almost = new Date(Date.now() - DOWNLOAD_INVITE_MAX_MS + 60 * 60_000);
    await utimes(file, almost, almost);
    check('Download: 6 Tage und 23 Stunden alt → gilt noch', (await takeDownloadInvite(file)) === CODE);

    await writeFile(file, CODE);
    const mtime = (await stat(file)).mtimeMs;
    check('Download: mit fester Uhr (Datei aus der Zukunft → null)', (await takeDownloadInvite(file, mtime - 2 * 60 * 60_000)) === null && !existsSync(file));

    const invalid = ['abcdefghji', CODE.toUpperCase(), `${CODE}x`, 'abcdefghj', `../${CODE}`, `${CODE}\n${CODE}`, '', 'x'.repeat(300)];
    const accepted: string[] = [];
    for (const text of invalid) {
      await writeFile(file, text);
      if ((await takeDownloadInvite(file)) !== null) accepted.push(text.slice(0, 20));
      if (existsSync(file)) accepted.push(`nicht gelöscht: ${text.slice(0, 20)}`);
    }
    check('Download: ungültiger Inhalt → null, Datei gelöscht', accepted.length === 0, accepted);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  links();
  pasted();
  await downloadInvite();
  mapping();
  events();
  presence();
  await service();
  finish('Einladungen und Discord-Knöpfe');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
