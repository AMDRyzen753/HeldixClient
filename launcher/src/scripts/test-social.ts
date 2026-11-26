// Prüft Freunde & Nachrichten (core/social.ts) und das Heldix-Cape (core/profile.ts) gegen einen lokalen Heldix-Dienst
// im Entwicklungsmodus: Anmeldung (über einen Fake-Mojang-Server bzw. /v1/auth/dev), Anfragen, Online-Status und
// Server, Nachrichten, ungelesene Zähler, Benachrichtigungen, Privatsphäre, Blockieren, Melden, Skins anderer Spieler
// und die Zustände ohne Dienst, Konto oder Microsoft-Konto.
//
// Ohne Angabe startet das Skript den Dienst selbst aus service/dist (vorher: cd service && npm run build) mit
// eigenem Datenordner im Temp-Ordner. Mit --service=http://127.0.0.1:<port> nimmt es einen schon laufenden Dienst
// (z. B. aus service/ mit npm run dev und PORT); dann nur Anmeldungen über /v1/auth/dev.
//
// Aufruf: npm run test:social [-- --service=http://127.0.0.1:8787]

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { SocialOverview } from '../shared/api';
import { isLoopback, serviceLogin, type ServiceToken } from '../main/core/heldixservice';
import { MojangApi, ProfileService, loadHeldixCapes } from '../main/core/profile';
import { POLL_HIDDEN_MS, POLL_VISIBLE_MS, SocialClient, joinableServer, pickJoinInstance, type SocialAccount, type SocialNotice } from '../main/core/social';
import { allowTestTextureOrigin } from '../main/core/skins';
import { createPaths } from '../main/core/paths';
import { FakeMojang, check, delay, finish, freePort, makeSkin, randomUuid, rejects, startDevService, type DevService } from './testkit';

interface Player extends SocialAccount {
  token: string;
}

async function main(): Promise<void> {
  const external = process.argv.find((a) => a.startsWith('--service='))?.slice('--service='.length) ?? null;
  if (external && !isLoopback(external)) {
    console.error('Nur gegen einen lokalen Dienst (127.0.0.1/localhost) testen – nie gegen den echten Heldix-Dienst.');
    process.exit(2);
  }
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-social-'));
  const fake = await new FakeMojang().start();
  allowTestTextureOrigin(fake.url);
  let service: DevService | null = null;
  const clients: SocialClient<Player>[] = [];
  try {
    if (!external) service = await startDevService(path.join(tmp, 'dienst'), fake.url);
    const base = external ?? service!.url;
    console.log(`Heldix-Dienst: ${base}${external ? ' (läuft schon)' : ' (für diesen Test gestartet)'} · Fake-Mojang: ${fake.url}`);

    const tag = randomUuid().slice(0, 4);
    const mojangA = fake.addPlayer(`HeldA_${tag}`, { skin: makeSkin({ seed: 3 }) });
    // A meldet sich wie im Launcher über Mojang an (Fake), B–D wie Offline-Konten über /v1/auth/dev
    const A: Player = { id: 'konto-a', type: external ? 'offline' : 'microsoft', name: mojangA.name, uuid: mojangA.uuid, token: mojangA.token };
    const offline = (letter: string): Player => ({ id: `konto-${letter}`, type: 'offline', name: `Held${letter.toUpperCase()}_${tag}`, uuid: randomUuid(), token: '' });
    const B = offline('b');
    const C = offline('c');
    const D = offline('d');

    const notices = new Map<string, SocialNotice[]>();
    const updates = new Map<string, SocialOverview[]>();
    const make = (player: Player | (() => Player | null), extra: Partial<ConstructorParameters<typeof SocialClient<Player>>[0]> = {}) => {
      const key = typeof player === 'function' ? 'wechsel' : player.id;
      const client = new SocialClient<Player>({
        serviceUrl: base,
        devAuth: true,
        sessionServer: fake.url,
        enabled: async () => true,
        account: async () => (typeof player === 'function' ? player() : player),
        accessToken: async (account) => account.token,
        wantNotices: () => true,
        onNotice: (notice) => notices.set(key, [...(notices.get(key) ?? []), notice]),
        onUpdate: (overview) => updates.set(key, [...(updates.get(key) ?? []), overview]),
        skinCacheDir: path.join(tmp, 'skins', key),
        ...extra,
      });
      clients.push(client);
      return client;
    };

    // ---------- Zustände ohne Anmeldung ----------
    const closedPort = await freePort();
    let o = await make(A, { enabled: async () => false }).refresh();
    check('Einstellung aus: Status disabled', o.status === 'disabled' && o.friends.length === 0, o);
    o = await make(A, { serviceUrl: '' }).refresh();
    check('kein Dienst eingerichtet: Status no-service', o.status === 'no-service', o);
    o = await make(() => null).refresh();
    check('kein Konto: Status no-account', o.status === 'no-account', o);
    o = await make(B, { devAuth: false }).refresh();
    check('Offline-Konto ohne Testmodus: Status offline-account', o.status === 'offline-account', o);
    o = await make(B, { serviceUrl: `http://127.0.0.1:${closedPort}` }).refresh();
    check('Dienst nicht erreichbar: deutsche Meldung', o.status === 'error' && o.error === 'Heldix-Dienst nicht erreichbar.', o);
    if (!external) {
      const expired = make({ ...A, id: 'konto-abgelaufen' }, {
        accessToken: async () => {
          throw new Error('Die Anmeldung über den Minecraft Launcher ist abgelaufen. Bitte einmal spielen oder neu anmelden.');
        },
      });
      o = await expired.refresh();
      check('abgelaufene Launcher-Anmeldung: Status error mit Hinweis', o.status === 'error' && /Bitte einmal spielen oder neu anmelden/.test(o.error ?? ''), o);
      o = await make({ ...A, id: 'konto-falsch', token: 'falsches-token' }).refresh();
      check('von Mojang abgelehntes Token: Status error', o.status === 'error' && /Mojang hat die Anmeldung abgelehnt/.test(o.error ?? ''), o);
    }
    await rejects('Aktion ohne Freunde-Einstellung', () => make(A, { enabled: async () => false }).sendFriendRequest('Irgendwer'), /ausgeschaltet/);

    // ---------- Anmeldung ----------
    const a = make(A);
    const b = make(B);
    const c = make(C);
    const d = make(D);
    const first = await a.getOverview();
    check(`A angemeldet${external ? ' (/v1/auth/dev)' : ' über Challenge → Mojang-Join (Fake) → Login'}`, first.status === 'online' && first.me?.uuid === A.uuid && first.me?.name === A.name, first);
    if (!external) check('Fake-Mojang hat den Join bekommen', fake.log.includes('POST /session/minecraft/join'), fake.log);
    check('Zustand „connecting“ vor dem ersten Laden gemeldet', (updates.get('konto-a') ?? []).slice(-2).map((u) => u.status).join() === 'connecting,online', updates.get('konto-a')?.map((u) => u.status));
    for (const [client, player] of [[b, B], [c, C], [d, D]] as const) {
      const overview = await client.refresh();
      check(`${player.name} angemeldet (Testmodus)`, overview.status === 'online' && overview.me?.uuid === player.uuid, overview);
    }

    // ---------- Anfragen ----------
    await rejects('ungültiger Name wird abgelehnt', () => a.sendFriendRequest('kein name!'), /1–16 Zeichen/);
    await rejects('unbekannter Spieler: Meldung des Dienstes', () => a.sendFriendRequest(`Niemand_${tag}`), /nutzt HeldixClient nicht/);
    await rejects('Anfrage an sich selbst', () => a.sendFriendRequest(A.name), /.+/);
    o = await a.sendFriendRequest(B.name);
    check('Anfrage gesendet: B steht unter outgoing', o.outgoing.some((r) => r.uuid === B.uuid && r.name === B.name && r.at > 0), o.outgoing);
    o = await b.refresh();
    check('B sieht die Anfrage unter incoming', o.incoming.some((r) => r.uuid === A.uuid), o.incoming);
    check('Benachrichtigung „möchte mit dir befreundet sein“ (nicht beim ersten Laden)', JSON.stringify(notices.get('konto-b')) === JSON.stringify([{ kind: 'request', uuid: A.uuid, name: A.name }]), notices.get('konto-b'));
    o = await b.acceptFriendRequest(A.uuid);
    check('B nimmt an: A ist Freund', o.friends.some((f) => f.uuid === A.uuid) && o.incoming.length === 0, o);
    o = await c.sendFriendRequest(A.name);
    o = await a.acceptFriendRequest(C.uuid);
    check('A hat zwei Freunde (B, C), keine offenen Anfragen', o.friends.length === 2 && o.outgoing.length === 0 && o.incoming.length === 0, o);
    check('Freund ohne WebSocket ist offline (Launcher zählt nicht als online)', o.friends.every((f) => !f.online && f.activity === null && f.server === null), o.friends);

    // Zurückziehen und Ablehnen
    o = await a.sendFriendRequest(D.name);
    o = await a.removeFriendRequest(D.uuid);
    check('eigene Anfrage zurückgezogen', o.outgoing.length === 0, o.outgoing);
    await d.sendFriendRequest(A.name);
    o = await a.refresh();
    check('Anfrage von D angekommen', o.incoming.some((r) => r.uuid === D.uuid), o.incoming);
    o = await a.removeFriendRequest(D.uuid);
    check('Anfrage von D abgelehnt', o.incoming.length === 0, o.incoming);

    // ---------- Online-Status und Server (C spielt im Spiel mit HeldixClient, also mit WebSocket) ----------
    const cToken = await serviceLogin(base, { name: C.name, uuid: C.uuid, accessToken: '' }, { devAuth: true });
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/v1/ws`, { headers: { authorization: `Bearer ${cToken.token}` } } as unknown as string[]);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('WebSocket'));
    });
    socket.send(JSON.stringify({ type: 'status', state: 'multiplayer', server: 'play.example.de:25570' }));
    await delay(400);
    o = await a.refresh();
    const friendC = o.friends.find((f) => f.uuid === C.uuid);
    check('Freund im Spiel: online, Mehrspieler, Server mit Port', friendC?.online === true && friendC.activity === 'multiplayer' && friendC.server === 'play.example.de:25570', friendC);
    check('Sortierung: online zuerst, dann nach Name', o.friends.map((f) => f.uuid).join() === [C.uuid, B.uuid].join(), o.friends.map((f) => f.name));
    check('Beitreten: Serveradresse des Freundes', friendC !== undefined && joinableServer(friendC) === 'play.example.de:25570');
    const friendB = o.friends.find((f) => f.uuid === B.uuid)!;
    check('Beitreten: Freund offline → kein Server', joinableServer(friendB) === null);
    check('Beitreten: IP-Adressen und Unsinn werden nicht gestartet', joinableServer({ ...friendB, online: true, activity: 'multiplayer', server: 'evil/../x' }) === null && joinableServer({ ...friendB, online: true, activity: 'singleplayer', server: 'hypixel.net' }) === null);
    const list = [{ id: 'vanilla', client: false }, { id: 'heldix-1', client: true }, { id: 'heldix-2', client: true }];
    check('Beitreten: ausgewählte Instanz mit HeldixClient', pickJoinInstance(list, list[2], (i) => i.client)?.id === 'heldix-2');
    check('Beitreten: ohne HeldixClient die erste passende', pickJoinInstance(list, list[0], (i) => i.client)?.id === 'heldix-1');
    check('Beitreten: keine passende Instanz', pickJoinInstance([list[0]], list[0], (i) => i.client) === null);

    // ---------- Nachrichten ----------
    await rejects('leere Nachricht', () => a.sendMessage(B.uuid, '   '), /leer/);
    await rejects('zu lange Nachricht', () => a.sendMessage(B.uuid, 'x'.repeat(501)), /500 Zeichen/);
    await rejects('ungültige UUID', () => a.sendMessage('../etc', 'Hallo'), /Ungültige Spieler-ID/);
    await rejects('Nachricht an Nicht-Freund', () => a.sendMessage(D.uuid, 'Hallo D'), /nur an Freunde/);
    const m1 = await a.sendMessage(B.uuid, '  Hallo B  ');
    check('Nachricht gesendet: mine, Text ohne Leerzeichen am Rand', m1.mine && m1.text === 'Hallo B' && m1.from === A.uuid && m1.to === B.uuid && m1.id > 0, m1);
    const m2 = await a.sendMessage(B.uuid, 'Zweite Nachricht, die für die Benachrichtigung etwas länger ist als hundertzwanzig Zeichen, damit man das Kürzen sieht – fertig.');
    o = await b.refresh();
    const fromA = o.friends.find((f) => f.uuid === A.uuid);
    check('B: 2 ungelesene von A, Summe 2', fromA?.unread === 2 && o.unread === 2, { friend: fromA, total: o.unread });
    const messageNotice = (notices.get('konto-b') ?? []).find((n) => n.kind === 'message');
    check('Benachrichtigung „Neue Nachricht“ mit gekürztem Text', messageNotice?.kind === 'message' && messageNotice.name === A.name && messageNotice.count === 2 && messageNotice.text !== null && messageNotice.text.endsWith('…') && [...messageNotice.text].length <= 120, messageNotice);
    const conversations = await b.listConversations();
    check('Unterhaltungen: A mit letzter Nachricht', conversations.length === 1 && conversations[0].uuid === A.uuid && conversations[0].unread === 2 && conversations[0].last?.id === m2.id && conversations[0].last.mine === false, conversations);
    const history = await b.getMessages(A.uuid);
    check('Verlauf: älteste zuerst, mine aus Sicht von B', history.messages.length === 2 && history.messages[0].id === m1.id && !history.messages[0].mine && history.more === false, history);
    const page = await b.getMessages(A.uuid, m2.id);
    check('Verlauf mit before: nur ältere', page.messages.length === 1 && page.messages[0].id === m1.id, page);
    await rejects('before muss eine ID sein', () => b.getMessages(A.uuid, -1), /Ungültige Nachrichten-ID/);
    const own = await a.getMessages(B.uuid);
    check('Verlauf von A: eigene Nachrichten mine', own.messages.every((m) => m.mine), own);
    await b.markRead(A.uuid);
    check('gelesen: Zähler sofort 0', b.current.unread === 0 && b.current.friends.find((f) => f.uuid === A.uuid)?.unread === 0, b.current);
    await delay(200);
    o = await b.refresh();
    check('gelesen: auch beim Dienst 0', o.unread === 0, o.unread);
    const before = (notices.get('konto-b') ?? []).length;
    await b.refresh();
    check('keine doppelte Benachrichtigung', (notices.get('konto-b') ?? []).length === before);

    // Benachrichtigungen aus (Fenster im Vordergrund oder Einstellung aus)
    const quiet = make({ ...B, id: 'konto-b-leise' }, { wantNotices: () => false });
    await quiet.refresh();
    await a.sendMessage(B.uuid, 'Noch eine');
    await quiet.refresh();
    check('keine Benachrichtigung, wenn wantNotices nein sagt', (notices.get('konto-b-leise') ?? []).length === 0, notices.get('konto-b-leise'));
    check('… aber der Zähler stimmt', quiet.current.unread === 1, quiet.current.unread);
    await b.markRead(A.uuid);

    // ---------- Privatsphäre ----------
    const privacy = await b.getPrivacy();
    check('Privatsphäre: Standard alles an', privacy.visible && privacy.presence && privacy.showServer && privacy.messages, privacy);
    const changed = await b.setPrivacy({ messages: false, bogus: 1, visible: 'ja' });
    check('Privatsphäre: nur gültige Schalter übernommen', changed.messages === false && changed.visible === true, changed);
    await rejects('Nachrichten aus: Freund bekommt die Meldung des Dienstes', () => a.sendMessage(B.uuid, 'Hallo?'), /nimmt gerade keine Nachrichten an/);
    await b.setPrivacy({ messages: true });
    await c.setPrivacy({ showServer: false });
    o = await a.refresh();
    check('Server ausgeblendet: online, aber ohne Server', o.friends.find((f) => f.uuid === C.uuid)?.online === true && o.friends.find((f) => f.uuid === C.uuid)?.server === null, o.friends);
    await c.setPrivacy({ showServer: true, presence: false });
    o = await a.refresh();
    const hidden = o.friends.find((f) => f.uuid === C.uuid);
    check('Online-Status aus: Freund erscheint offline', hidden?.online === false && hidden.activity === null && hidden.server === null, hidden);
    await c.setPrivacy({ presence: true });
    await rejects('Privatsphäre bei ausgeschalteten Freunden', () => make(B, { enabled: async () => false }).getPrivacy(), /ausgeschaltet/);

    // ---------- Blockieren ----------
    let blocked = await a.blockPlayer(C.uuid);
    check('blockiert: C in der Liste', blocked.length === 1 && blocked[0].uuid === C.uuid && blocked[0].name === C.name && blocked[0].at > 0, blocked);
    check('blockiert: C ist kein Freund mehr', !a.current.friends.some((f) => f.uuid === C.uuid), a.current.friends);
    blocked = await a.listBlocked();
    check('Liste der Blockierten', blocked.length === 1, blocked);
    await rejects('Blockierter kann keine Anfrage schicken (wie unbekannt)', () => c.sendFriendRequest(A.name), /nutzt HeldixClient nicht/);
    blocked = await a.unblockPlayer(C.uuid);
    check('freigegeben', blocked.length === 0, blocked);

    // ---------- Melden ----------
    await a.reportPlayer(B.uuid, 'spam', '  Testmeldung  ');
    check('gemeldet', true);
    await rejects('denselben Spieler nicht zweimal am Tag', () => a.reportPlayer(B.uuid, 'other'), /.+/);
    await rejects('Grund muss gültig sein', () => a.reportPlayer(D.uuid, 'egal'), /Grund/);
    await rejects('Notiz höchstens 300 Zeichen', () => a.reportPlayer(D.uuid, 'other', 'x'.repeat(301)), /300/);

    // ---------- Heldix-Cape ----------
    const capes = await loadHeldixCapes(path.resolve(__dirname, '..', '..', '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'textures', 'cape', 'capes.json'));
    check('Katalog der Heldix-Capes gelesen', capes.length >= 9 && capes.some((cape) => cape.id === 'heldix' && cape.frames > 0 && cape.glow), capes.map((cape) => cape.id));
    let me = await a.getMe();
    check('Heldix-Cape: Standard keins', me.cape === '' && me.uuid === A.uuid, me);
    me = await a.updateMe({ cape: 'aurora' });
    check('Heldix-Cape setzen', me.cape === 'aurora', me);
    await rejects('unbekanntes Cape: Meldung des Dienstes', () => a.updateMe({ cape: 'gibtsnicht' }), /Unbekanntes Cape/);
    const profiles = new ProfileService<Player>({
      paths: createPaths(path.join(tmp, 'launcher')),
      libraryDir: path.join(tmp, 'launcher', 'skins'),
      mojang: new MojangApi(fake.url),
      account: async () => A,
      accessToken: async (account) => account.token,
      heldix: { getMe: () => a.getMe(), setCape: (cape) => a.updateMe({ cape }) },
      heldixForOffline: true,
      capes: async () => capes,
      fallbackSkin: async () => null,
    });
    let state = await profiles.state();
    check('Skins & Capes: Heldix-Cape verfügbar und gewählt', state.heldixAvailable && state.heldixCape === 'aurora' && state.heldixCapes.length === capes.length, { ...state, library: state.library.length });
    state = await profiles.setHeldixCape('glut');
    check('Skins & Capes: Heldix-Cape wechseln', state.heldixCape === 'glut' && (await a.getMe()).cape === 'glut', state.heldixCape);
    await rejects('Skins & Capes: Cape außerhalb des Katalogs', () => profiles.setHeldixCape('xyz'), /gibt es nicht/);
    state = await profiles.setHeldixCape(null);
    check('Skins & Capes: Heldix-Cape ablegen', state.heldixCape === null && (await a.getMe()).cape === '', state.heldixCape);
    const noService = new ProfileService<Player>({
      paths: createPaths(path.join(tmp, 'launcher')),
      libraryDir: path.join(tmp, 'launcher', 'skins'),
      mojang: new MojangApi(fake.url), account: async () => A, accessToken: async (x) => x.token, heldix: { getMe: () => make(A, { serviceUrl: `http://127.0.0.1:${closedPort}` }).getMe(), setCape: async () => ({ cape: '' }) }, heldixForOffline: true, capes: async () => capes, fallbackSkin: async () => null });
    state = await noService.state();
    check('Dienst weg: Heldix-Cape nicht verfügbar, Rest bleibt', !state.heldixAvailable && /Heldix-Dienst nicht erreichbar/.test(state.error ?? '') && (external !== null || state.canEditSkin), state.error);

    // ---------- Skins anderer Spieler ----------
    check('Skin eines Freundes ohne Mojang-Skin: null (Standard zeigen)', (await a.playerSkin(B.uuid)) === null);
    check('Skin eines fremden Spielers: null', (await a.playerSkin(D.uuid)) === null);
    check('ungültige UUID: null', (await a.playerSkin('nicht-gueltig')) === null);
    await skinsAgainstFakeService(tmp);

    // ---------- erneute Anmeldung nach 401, Kontowechsel, Entfernen ----------
    (a as unknown as { tokens: Map<string, ServiceToken> }).tokens.get(A.id)!.token = 'abgelaufen';
    o = await a.refresh();
    check('ungültiges Token (401): neu angemeldet, weiter online', o.status === 'online' && o.friends.length >= 1, o.status);

    let active: Player = A;
    const switching = make(() => active);
    o = await switching.refresh();
    const switchUpdates = () => (updates.get('wechsel') ?? []).map((u) => u.status);
    active = D;
    o = await switching.refresh();
    check('Kontowechsel: neue Liste, angemeldet als D', o.me?.uuid === D.uuid && o.friends.length === 0, o);
    check('Kontowechsel: dazwischen „connecting“ ohne alte Freunde', switchUpdates().filter((s) => s === 'connecting').length === 2, switchUpdates());
    check('Kontowechsel: keine Benachrichtigungen beim ersten Laden', (notices.get('wechsel') ?? []).length === 0, notices.get('wechsel'));

    o = await a.removeFriend(B.uuid);
    check('Freund entfernt', !o.friends.some((f) => f.uuid === B.uuid), o.friends);
    check('… und B sieht A nicht mehr, Unterhaltung weg', !(await b.refresh()).friends.some((f) => f.uuid === A.uuid) && (await b.listConversations()).length === 0);

    // ---------- Takt der Abfrage ----------
    const delays: number[] = [];
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return original(() => undefined, 0);
    }) as typeof setTimeout;
    let visible = true;
    const timed = make(B, { visible: () => visible });
    try {
      timed.start();
      check('Abfrage startet sofort', delays[0] === 0, delays);
      globalThis.setTimeout = original;
      await timed.refresh();
      globalThis.setTimeout = ((fn: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        return original(() => undefined, 0);
      }) as typeof setTimeout;
      await timed.refresh();
      visible = false;
      await timed.refresh();
    } finally {
      globalThis.setTimeout = original;
      timed.stop();
    }
    check(`Takt: ${POLL_VISIBLE_MS / 1000} s sichtbar, ${POLL_HIDDEN_MS / 1000} s verborgen`, delays.includes(POLL_VISIBLE_MS) && delays.at(-1) === POLL_HIDDEN_MS, delays);

    socket.close();
  } finally {
    for (const client of clients) client.stop();
    await fake.stop();
    await service?.stop();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  finish('Freunde & Nachrichten');
}

/** Skins über GET /v1/skins/<uuid> gegen einen kleinen Fake-Dienst: Daten-URL, Zwischenspeicher, 404, 401. */
async function skinsAgainstFakeService(tmp: string): Promise<void> {
  const png = makeSkin({ seed: 5 });
  const friend = randomUuid();
  const stranger = randomUuid();
  let skinRequests = 0;
  let tokens = 0;
  let valid = new Set<string>();
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/auth/dev') {
      const token = `t${++tokens}`;
      valid.add(token);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token, uuid: 'a'.repeat(32), name: 'Ich', expiresAt: Date.now() + 7 * 86_400_000 }));
      return;
    }
    const match = /^\/v1\/skins\/([0-9a-f]{32})$/.exec(req.url ?? '');
    if (req.method === 'GET' && match) {
      skinRequests++;
      if (!valid.has((req.headers.authorization ?? '').replace(/^Bearer /, ''))) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Bitte anmelden.' }));
        return;
      }
      if (match[1] !== friend) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Kein Skin gefunden.' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length }).end(png);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const me: SocialAccount = { id: 'ich', type: 'offline', name: 'Ich', uuid: 'a'.repeat(32) };
  const cacheDir = path.join(tmp, 'player-skins');
  const client = () =>
    new SocialClient({ serviceUrl: url, devAuth: true, enabled: async () => true, account: async () => me, accessToken: async () => '', skinCacheDir: cacheDir });
  try {
    const first = client();
    const dataUrl = await first.playerSkin(friend);
    check('Skin über den Dienst: PNG als data:-URL', dataUrl === `data:image/png;base64,${png.toString('base64')}`, dataUrl?.slice(0, 40));
    const [x, y] = await Promise.all([first.playerSkin(friend.toUpperCase()), first.playerSkin(friend)]);
    check('Skin: zweiter Aufruf aus dem Speicher', x === dataUrl && y === dataUrl && skinRequests === 1, skinRequests);
    check('Skin: in der Datei zwischengespeichert', (await readdir(cacheDir)).includes(`${friend}.png`));
    const second = client();
    check('Skin: nach Neustart aus der Datei', (await second.playerSkin(friend)) === dataUrl && skinRequests === 1, skinRequests);
    check('Skin: 404 → null', (await second.playerSkin(stranger)) === null && skinRequests === 2, skinRequests);
    check('Skin: 404 wird kurz gemerkt', (await second.playerSkin(stranger)) === null && skinRequests === 2, skinRequests);
    const third = client();
    await rm(path.join(cacheDir, `${friend}.png`));
    await third.playerSkin(stranger); // meldet third an
    const loginsBefore = tokens;
    valid = new Set(); // Token beim Dienst abgelaufen: erst 401, dann neu anmelden
    check('Skin: nach 401 neu angemeldet und geladen', (await third.playerSkin(friend)) === dataUrl && tokens === loginsBefore + 1, { skinRequests, tokens });
  } finally {
    server.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
