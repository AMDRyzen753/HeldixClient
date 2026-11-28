// Prüft Freunde & Nachrichten (core/social.ts) und das Heldix-Cape (core/profile.ts) gegen einen lokalen Heldix-Dienst
// im Entwicklungsmodus: Anmeldung (über einen Fake-Mojang-Server bzw. /v1/auth/dev), Anfragen, Online-Status und
// Server, Nachrichten, ungelesene Zähler, Benachrichtigungen, Privatsphäre, Blockieren, Melden, Einladungen (anlegen,
// öffentlich abrufen, annehmen, Freundschaft, Belohnung, widerrufen), Skins anderer Spieler und die Zustände ohne Dienst,
// Konto oder Microsoft-Konto. Dazu Freunde 2.0 (Dienst ab 1.12.0): Echtzeit-Begleiter /v1/ws?client=launcher (zählt
// nicht als online), Nachrichten in Echtzeit, „schreibt …“, Antworten, Karten, Reaktionen, Löschen, Favoriten,
// Spitzname, Notiz, Status, „Nicht stören“, „ist online“, zuletzt online, Profilkarte, Vorschläge und Party (einladen,
// annehmen, Chat, Leitung, Folgen, entfernen).
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
import type { ChatEvent, InviteEvent, SocialOverview } from '../shared/api';
import { isLoopback, serviceLogin, type ServiceToken } from '../main/core/heldixservice';
import { parseUnlocked } from '../main/core/cosmeticcatalog';
import { InviteService, inviteServer, isMissing } from '../main/core/invites';
import { PartyClient, followAction, type PartyEvent } from '../main/core/party';
import { MojangApi, ProfileService, loadHeldixCapes } from '../main/core/profile';
import { POLL_HIDDEN_MS, POLL_VISIBLE_MS, SocialClient, cardFallbackText, checkCard, joinableServer, pickJoinInstance, type SocialAccount, type SocialNotice } from '../main/core/social';
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
  let service2: DevService | null = null;
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

    // ---------- Einladungen (Dienst ab 1.11.0) ----------
    await invitesAgainstService(base, make, { A, B, E: offline('e') }, a, b);

    // ---------- Freunde 2.0, Party, Echtzeit-Begleiter (Dienst ab 1.12.0) ----------
    // eigener Dienst, damit die Anmeldungen nicht an die Grenze von 20 je Minute und Adresse stoßen
    if (!external) service2 = await startDevService(path.join(tmp, 'dienst2'), fake.url);
    await friends2AgainstService(external ?? service2!.url, make, tag, notices);

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
    // Takt der Abfrage als Rückfall (ohne Echtzeit-Verbindung; mit ihr siehe Freunde 2.0 oben)
    const timed = make(B, { visible: () => visible, realtime: false });
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
    await service2?.stop();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  finish('Freunde & Nachrichten');
}

/** WebSocket wie im Spiel (für die Realtime-Nachrichten unlock/invite, die das Spiel bekommt) */
async function gameSocket(base: string, player: SocialAccount): Promise<{ socket: WebSocket; messages: Record<string, unknown>[] }> {
  const token = await serviceLogin(base, { name: player.name, uuid: player.uuid, accessToken: '' }, { devAuth: true });
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/v1/ws`, { headers: { authorization: `Bearer ${token.token}` } } as unknown as string[]);
  const messages: Record<string, unknown>[] = [];
  socket.onmessage = (event) => {
    try {
      messages.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    } catch {
      // ignorieren
    }
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('WebSocket'));
  });
  return { socket, messages };
}

/**
 * Einladungen gegen den lokalen Dienst: Übersicht mit allgemeinem Link, Link für einen Server (wiederverwendet),
 * öffentlich abrufen, annehmen (neu befreundet mit Willkommens-Belohnung, schon befreundet, zweites Mal, eigene),
 * Freischaltung in GET /v1/me/cosmetics, Zähler, Meldung „angenommen“ beim Einladenden (Vergleich statt Realtime),
 * Realtime-Nachrichten fürs Spiel und widerrufen.
 */
async function invitesAgainstService(
  base: string,
  make: (player: Player) => SocialClient<Player>,
  players: { A: Player; B: Player; E: Player },
  a: SocialClient<Player>,
  b: SocialClient<Player>,
): Promise<void> {
  const { A, B, E } = players;
  const e = make(E);
  await e.refresh();
  const seenA: InviteEvent[] = [];
  const seenE: InviteEvent[] = [];
  const service = (client: SocialClient<Player>, seen: InviteEvent[]) => new InviteService({ serviceUrl: base, auth: client, enabled: async () => true, onEvent: (event) => seen.push(event) });
  const invA = service(a, seenA);
  const invE = service(e, seenE);
  const invB = service(b, []);

  let state = await invA.state();
  if (!state.available) {
    check('Einladungen: Dienst kennt sie (GET /v1/invites)', false, 'Dienst ohne Einladungen – service/dist ist älter als 1.11.0');
    return;
  }
  check('Einladungen: allgemeiner Link wird bei Bedarf angelegt', !!state.link && state.link.server === null && state.link.appUrl === `heldixclient://einladung/${state.link.code}` && state.link.url === null, state.link);
  check('Einladungen: Zähler am Anfang 0, Belohnungen Freundesfunken (1) und Freundesband (3)', state.invited === 0 && state.confirmed === 0 && state.pending === 0
    && state.rewards.map((r) => `${r.cosmetic}:${r.friends}:${r.unlocked}`).join() === 'freundesfunken:1:false,freundesband:3:false', state);
  const general = state.link!;
  const again = await invA.state();
  check('Einladungen: derselbe allgemeine Link beim nächsten Abruf', again.link?.code === general.code);
  const serverLink = await invA.create('Play.Example.de:25570');
  check('Link für einen Server: normalisiert, 30 Tage', serverLink.server === 'play.example.de:25570' && serverLink.code !== general.code && serverLink.expires - Date.now() > 29 * 86_400_000, serverLink);
  check('Link für einen Server: offene gleiche Einladung wird wiederverwendet', (await invA.create('play.example.de:25570')).code === serverLink.code);
  await rejects('Link für einen Server: IP-Adresse abgelehnt', () => invA.create('192.168.0.12'), /öffentliche Serveradresse/);
  await rejects('Link für einen Server: Heimnetz-Name vom Dienst abgelehnt', () => invA.create('meinserver.lan'), /.+/);

  const pub = await invE.publicInvite(serverLink.code);
  check('öffentlich abrufen: Einladender, Server, Willkommens-Belohnung', pub.inviter.uuid === A.uuid && pub.inviter.name === A.name && pub.server === 'play.example.de:25570' && pub.welcome === 'freundesfunken' && pub.voice === null && pub.expires > Date.now(), pub);
  const unknown = await invE.publicInvite('mnpqrstuvw').then(() => null, (error: unknown) => error);
  check('öffentlich abrufen: unbekannter Code → 404', isMissing(unknown), unknown);

  // Spiel-Verbindungen für die Realtime-Nachrichten (der Launcher selbst hat keine)
  const gameA = await gameSocket(base, A);
  const gameE = await gameSocket(base, E);
  try {
    state = await invE.state();
    check('Eingeladener: vorher nichts freigeschaltet', state.unlocked.length === 0, state.unlocked);
    let result = await invE.accept(serverLink.code);
    check('annehmen (neu): befreundet, Willkommens-Belohnung', result.friend === 'new' && result.reward === 'freundesfunken' && result.rewardReason === null && result.inviter.uuid === A.uuid && result.server === 'play.example.de:25570', result);
    check('… beide sehen sich in der Freundesliste', (await e.refresh()).friends.some((f) => f.uuid === A.uuid) && (await a.refresh()).friends.some((f) => f.uuid === E.uuid));
    const mine = parseUnlocked(await e.authed<unknown>('/v1/me/cosmetics'));
    check('Freischaltung in GET /v1/me/cosmetics (unlocked)', mine.includes('freundesfunken'), mine);
    await invE.poll();
    check('Eingeladener: keine zweite Meldung für die Belohnung aus dem Dialog', seenE.length === 0, seenE);
    invA.friendsAdded([E.name]);
    await invA.poll();
    check('Einladender: Meldung „angenommen“ mit Namen (Vergleich statt Realtime)', seenA.some((ev) => ev.kind === 'accepted' && ev.name === E.name && ev.count === 1), seenA);
    state = await invA.state();
    check('Zähler: 1 eingeladen, 0 bestätigt, 1 ausstehend; Link 1× angenommen', state.invited === 1 && state.confirmed === 0 && state.pending === 1 && state.invites.find((i) => i.code === serverLink.code)?.accepted === 1, state);
    await delay(300);
    check('Realtime fürs Spiel: unlock an den Eingeladenen', gameE.messages.some((m) => m.type === 'unlock' && m.cosmetic === 'freundesfunken' && m.reason === 'invite'), gameE.messages.map((m) => m.type));
    check('Realtime fürs Spiel: invite accepted an den Einladenden', gameA.messages.some((m) => m.type === 'invite' && m.event === 'accepted' && m.name === E.name), gameA.messages.map((m) => m.type));

    result = await invE.accept(general.code);
    check('zweite Einladung: schon befreundet, keine zweite Belohnung', result.friend === 'already' && result.reward === null && result.rewardReason === 'already-invited', result);
    result = await invB.accept(general.code);
    check('schon befreundeter Spieler nimmt an: Freundschaft bleibt', result.friend === 'already', result);
    await rejects('eigene Einladung annehmen: klare Meldung', () => invA.accept(general.code), /eigene Einladung/);
    await rejects('ungültiger Code geht nicht raus', () => invA.accept('../x'), /Ungültiger Einladungslink/);

    // widerrufen
    state = await invA.revoke(serverLink.code);
    check('widerrufen: Link weg', !state.invites.some((i) => i.code === serverLink.code), state.invites.map((i) => i.code));
    check('widerrufen: öffentlich 404', isMissing(await invE.publicInvite(serverLink.code).then(() => null, (error: unknown) => error)));
    await rejects('widerrufen: annehmen geht nicht mehr', () => invB.accept(serverLink.code), /gibt es nicht \(mehr\)/);
  } finally {
    gameA.socket.close();
    gameE.socket.close();
  }
}

async function waitUntil(label: string, condition: () => boolean, ms = 5000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (condition()) return true;
    await delay(25);
  }
  check(label, false, 'Zeitüberschreitung');
  return false;
}

type MakeClient = (player: Player, extra?: Partial<ConstructorParameters<typeof SocialClient<Player>>[0]>) => SocialClient<Player>;

/**
 * Freunde 2.0 gegen den lokalen Dienst (ab 1.12.0) mit eigenen Spielern P, Q, R, S (Freundschaften P–Q, P–R, Q–R, Q–S,
 * R–S): Begleiter-Verbindung (zählt nicht als online), Nachrichten und „schreibt …“ in Echtzeit, Antworten, Karten,
 * Reaktionen, Löschen, Favorit/Spitzname/Notiz, Status und „Nicht stören“, „ist online“ (nur Favoriten), zuletzt online,
 * Profilkarte, Vorschläge, Party (einladen, annehmen, Chat, Leitung, Folgen, entfernen, auflösen).
 */
async function friends2AgainstService(base: string, make: MakeClient, tag: string, notices: Map<string, SocialNotice[]>): Promise<void> {
  const player = (letter: string): Player => ({ id: `konto2-${letter}`, type: 'offline', name: `Frd${letter.toUpperCase()}_${tag}`, uuid: randomUuid(), token: '' });
  const P = player('p');
  const Q = player('q');
  const R = player('r');
  const S = player('s');
  const chatP: ChatEvent[] = [];
  const chatQ: ChatEvent[] = [];
  const eventsP: PartyEvent[] = [];
  const eventsQ: PartyEvent[] = [];
  let partyP: PartyClient | null = null;
  let partyQ: PartyClient | null = null;
  const p = make(P, { serviceUrl: base, onChatEvent: (e) => chatP.push(e), onRealtime: (m) => void partyP?.handle(m) });
  const q = make(Q, { serviceUrl: base, onChatEvent: (e) => chatQ.push(e), onRealtime: (m) => void partyQ?.handle(m) });
  const r = make(R, { serviceUrl: base });
  const s = make(S, { serviceUrl: base });
  for (const client of [p, q, r, s]) await client.refresh();
  const befriend = async (x: SocialClient<Player>, X: Player, y: SocialClient<Player>, Y: Player) => {
    await x.sendFriendRequest(Y.name);
    await y.acceptFriendRequest(X.uuid);
  };
  await befriend(p, P, q, Q);
  await befriend(p, P, r, R);
  await befriend(q, Q, r, R);
  await befriend(q, Q, s, S);
  await befriend(r, R, s, S);
  check('Freunde 2.0: Freundschaften angelegt', (await p.refresh()).friends.length === 2 && (await q.refresh()).friends.length === 3);
  const games: WebSocket[] = [];
  try {
    // ---------- Privatsphäre: neue Schalter ----------
    let privacy = await p.getPrivacy();
    check('Privatsphäre 2.0: Standard (zuletzt online an, nicht in Vorschlägen, Vorschläge zeigen, „ist online“ für alle)',
      privacy.showLastOnline && !privacy.suggestable && privacy.showSuggestions && privacy.onlineNotify === 'all', privacy);
    privacy = await p.setPrivacy({ onlineNotify: 'favorites', suggestable: 'ja', bogus: true });
    check('Privatsphäre 2.0: onlineNotify gesetzt, ungültige Werte nicht', privacy.onlineNotify === 'favorites' && !privacy.suggestable, privacy);
    check('Eigenes Profil: Abzeichen null (normaler Spieler), kein Status', p.current.me?.badge === null && p.current.me.statusText === null && !p.current.me.dnd && p.current.me.onlineNotify === 'favorites', p.current.me);

    // ---------- Echtzeit-Begleiter ----------
    p.start();
    q.start();
    await waitUntil('Begleiter-Verbindung steht', () => p.realtime === 'live' && q.realtime === 'live');
    check('Begleiter-Verbindung /v1/ws?client=launcher steht, Übersicht meldet „live“', p.realtime === 'live' && p.current.realtime === 'live', p.current.realtime);
    let o = await r.refresh();
    check('Begleiter zählt nicht als online: R sieht P und Q offline', o.friends.find((f) => f.uuid === P.uuid)?.online === false && o.friends.find((f) => f.uuid === Q.uuid)?.online === false, o.friends);

    // ---------- Nachrichten in Echtzeit, „schreibt …“ ----------
    const m1 = await q.sendMessage(P.uuid, 'Hallo P, live!');
    await waitUntil('Echtzeit: Nachricht kommt an', () => chatP.some((e) => e.kind === 'message' && e.message.id === m1.id));
    check('Echtzeit: neue Nachricht sofort in der Unterhaltung (ohne Abfrage)', chatP.some((e) => e.kind === 'message' && e.uuid === Q.uuid && e.message.text === 'Hallo P, live!' && !e.message.mine));
    check('Echtzeit: ungelesen ohne Abfrage gezählt', p.current.friends.find((f) => f.uuid === Q.uuid)?.unread === 1, p.current.friends);
    check('Echtzeit: Benachrichtigung mit Text', (notices.get('konto2-p') ?? []).some((n) => n.kind === 'message' && n.uuid === Q.uuid && n.text === 'Hallo P, live!'), notices.get('konto2-p'));
    check('Echtzeit: eigene Nachricht kommt auch beim Absender an (mine)', chatQ.some((e) => e.kind === 'message' && e.message.id === m1.id && e.message.mine && e.uuid === P.uuid));
    await q.typing(P.uuid);
    await waitUntil('„schreibt …“ über die Echtzeit-Verbindung', () => chatP.some((e) => e.kind === 'typing' && e.uuid === Q.uuid));
    await r.typing(P.uuid);
    await waitUntil('„schreibt …“ ohne Echtzeit (POST …/typing)', () => chatP.some((e) => e.kind === 'typing' && e.uuid === R.uuid));
    const typed = chatP.filter((e) => e.kind === 'typing' && e.uuid === R.uuid).length;
    await r.typing(P.uuid);
    await delay(400);
    check('„schreibt …“ gedrosselt: höchstens alle 3 s', typed === 1 && chatP.filter((e) => e.kind === 'typing' && e.uuid === R.uuid).length === 1);
    await p.markRead(Q.uuid);
    check('gelesen: Zähler 0', p.current.friends.find((f) => f.uuid === Q.uuid)?.unread === 0);

    // ---------- Antworten, Karten ----------
    const reply = await p.sendMessage(Q.uuid, 'Antwort von P', { replyTo: m1.id });
    check('Antwort: replyTo mit Absender und Text', reply.replyTo?.id === m1.id && reply.replyTo.from === Q.uuid && reply.replyTo.text === 'Hallo P, live!', reply);
    const other = await r.sendMessage(P.uuid, 'von R');
    await rejects('Antwort auf eine Nachricht aus einer anderen Unterhaltung', () => p.sendMessage(Q.uuid, 'falsch', { replyTo: other.id }), /nicht antworten/);
    const card = checkCard({ kind: 'server', target: 'Play.Example.de:25570', title: 'Unser Survival' }, inviteServer);
    const withCard = await p.sendMessage(Q.uuid, cardFallbackText(card), { card });
    check('Karte: Server normalisiert, Titel, Rückfall-Text', withCard.card?.kind === 'server' && withCard.card.target === 'play.example.de:25570' && withCard.card.title === 'Unser Survival' && withCard.text === 'Komm auf play.example.de:25570', withCard);
    const worldCard = await p.sendMessage(Q.uuid, 'Komm in meine Welt', { card: checkCard({ kind: 'world', target: 'ABC234', title: 'Insel' }, inviteServer) });
    check('Karte: Welt-Code klein gespeichert', worldCard.card?.kind === 'world' && worldCard.card.target === 'abc234', worldCard.card);
    const seen = await q.getMessages(P.uuid);
    check('Karte und Antwort beim Empfänger', seen.messages.some((m) => m.id === withCard.id && m.card?.kind === 'server') && seen.messages.some((m) => m.id === reply.id && m.replyTo?.id === m1.id));
    await rejects('Karte mit ungültigem Welt-Code: Meldung des Dienstes', () => p.sendMessage(Q.uuid, 'x', { card: { kind: 'world', target: 'abc', title: '' } }), /.+/);

    // ---------- Reaktionen ----------
    let reacted = await q.react(P.uuid, reply.id, 'fire');
    check('Reaktion setzen', reacted.reactions[Q.uuid] === 'fire', reacted.reactions);
    await waitUntil('Reaktion in Echtzeit beim Gegenüber', () => chatP.some((e) => e.kind === 'reaction' && e.id === reply.id && e.reactions[Q.uuid] === 'fire'));
    reacted = await q.react(P.uuid, reply.id, 'love');
    check('Reaktion ersetzen (höchstens eine je Person)', reacted.reactions[Q.uuid] === 'love' && Object.keys(reacted.reactions).length === 1, reacted.reactions);
    reacted = await p.react(Q.uuid, reply.id, 'party');
    check('Reaktionen von beiden', Object.keys(reacted.reactions).length === 2 && reacted.reactions[P.uuid] === 'party');
    reacted = await q.react(P.uuid, reply.id, null);
    check('Reaktion entfernen', !(Q.uuid in reacted.reactions) && reacted.reactions[P.uuid] === 'party', reacted.reactions);
    await rejects('unbekannte Reaktion (geht nicht raus)', () => q.react(P.uuid, reply.id, 'kaiser'), /gibt es nicht/);
    await rejects('Reaktion in einer fremden Unterhaltung', () => r.react(Q.uuid, reply.id, 'like'), /.+/);

    // ---------- Löschen ----------
    await rejects('fremde Nachricht löschen', () => q.deleteMessage(P.uuid, reply.id), /nur deine eigenen/);
    await p.deleteMessage(Q.uuid, reply.id);
    await waitUntil('Löschen in Echtzeit an beide', () => chatQ.some((e) => e.kind === 'deleted' && e.id === reply.id) && chatP.some((e) => e.kind === 'deleted' && e.id === reply.id));
    check('… für beide weg', !(await q.getMessages(P.uuid)).messages.some((m) => m.id === reply.id));
    await rejects('gelöschte Nachricht noch einmal löschen', () => p.deleteMessage(Q.uuid, reply.id), /gibt es nicht/);

    // ---------- Favorit, Spitzname, Notiz ----------
    o = await p.updateFriend(R.uuid, { favorite: true, nickname: '  Robbie  ', note: 'aus dem Bauprojekt' });
    const robbie = o.friends.find((f) => f.uuid === R.uuid);
    check('Favorit, Spitzname, Notiz gespeichert', robbie?.favorite === true && robbie.nickname === 'Robbie' && robbie.note === 'aus dem Bauprojekt', robbie);
    check('Favorit steht oben', o.friends[0].uuid === R.uuid, o.friends.map((f) => f.name));
    const seenByR = (await r.refresh()).friends.find((f) => f.uuid === P.uuid);
    check('Der Freund erfährt nichts davon', seenByR?.favorite === false && seenByR.nickname === null && seenByR.note === null, seenByR);
    await rejects('Spitzname zu lang (geht nicht raus)', () => p.updateFriend(R.uuid, { nickname: 'x'.repeat(25) }), /24 Zeichen/);
    o = await p.updateFriend(R.uuid, { nickname: '' });
    check('Spitzname löschen, Favorit bleibt', o.friends.find((f) => f.uuid === R.uuid)?.nickname === null && o.friends.find((f) => f.uuid === R.uuid)?.favorite === true);
    await rejects('Angaben zu einem Nicht-Freund: Meldung des Dienstes', () => p.updateFriend(S.uuid, { favorite: true }), /nicht in deiner Freundesliste/);
    await p.updateFriend(Q.uuid, { favorite: true });

    // ---------- Status, „Nicht stören“, „ist online“, zuletzt online ----------
    await q.setStatus({ statusText: '  Baue eine Burg  ', dnd: true });
    check('eigener Status und „Nicht stören“ gespeichert', q.current.me?.statusText === 'Baue eine Burg' && q.current.me.dnd === true, q.current.me);
    check('„Nicht stören“ an: keine Toasts mehr (doNotDisturb)', q.doNotDisturb);
    await rejects('Status zu lang (geht nicht raus)', () => q.setStatus({ statusText: 'x'.repeat(41) }), /40 Zeichen/);
    await waitUntil('Freund sieht den Status in Echtzeit', () => p.current.friends.find((f) => f.uuid === Q.uuid)?.statusText === 'Baue eine Burg');
    let qf = p.current.friends.find((f) => f.uuid === Q.uuid);
    check('Status auch offline sichtbar, „Nicht stören“ nur online', qf?.statusText === 'Baue eine Burg' && qf.dnd === false && !qf.online, qf);
    const onlineBefore = (notices.get('konto2-p') ?? []).filter((n) => n.kind === 'online').length;
    const gameQ = await gameSocket(base, Q);
    games.push(gameQ.socket);
    gameQ.socket.send(JSON.stringify({ type: 'status', state: 'multiplayer', server: 'play.example.de' }));
    await waitUntil('Freund kommt ins Spiel (Echtzeit friend)', () => p.current.friends.find((f) => f.uuid === Q.uuid)?.server === 'play.example.de');
    qf = p.current.friends.find((f) => f.uuid === Q.uuid);
    check('Freund im Spiel: online, Server, „Nicht stören“', qf?.online === true && qf.activity === 'multiplayer' && qf.dnd === true && qf.lastOnline === null, qf);
    const onlineNotices = (notices.get('konto2-p') ?? []).filter((n) => n.kind === 'online');
    check('„ist online“ für Favoriten (onlineNotify: favorites)', onlineNotices.length === onlineBefore + 1 && onlineNotices.at(-1)?.uuid === Q.uuid, onlineNotices);
    gameQ.socket.close();
    await waitUntil('Freund verlässt das Spiel', () => p.current.friends.find((f) => f.uuid === Q.uuid)?.online === false);
    qf = p.current.friends.find((f) => f.uuid === Q.uuid);
    check('zuletzt online: gerundet gesetzt (höchstens 5 Minuten zurück)', typeof qf?.lastOnline === 'number' && qf.lastOnline <= Date.now() && qf.lastOnline > Date.now() - 6 * 60_000, qf);
    await q.setPrivacy({ showLastOnline: false });
    await waitUntil('„Zuletzt online zeigen“ aus', () => p.current.friends.find((f) => f.uuid === Q.uuid)?.lastOnline === null);
    await q.setPrivacy({ showLastOnline: true });
    await q.setStatus({ dnd: false });

    // ---------- Profilkarte ----------
    const profile = await p.friendProfile(Q.uuid);
    check('Profilkarte: Freund, gemeinsame Freunde (nur R), Cape', profile.friend.uuid === Q.uuid && profile.mutual.map((m) => m.uuid).join() === R.uuid && profile.mutual[0].name === R.name && typeof profile.cape === 'string', profile);
    check('Profilkarte: Status und eigene Angaben (Favorit)', profile.friend.statusText === 'Baue eine Burg' && profile.friend.favorite && profile.friend.badge === null, profile.friend);
    await rejects('Profilkarte eines Nicht-Freunds', () => p.friendProfile(S.uuid), /.+/);

    // ---------- Vorschläge ----------
    let suggestions = await p.suggestions();
    check('Vorschläge: ohne „In Vorschlägen erscheinen“ niemand', suggestions.enabled && !suggestions.suggestions.some((x) => x.uuid === S.uuid), suggestions);
    await s.setPrivacy({ suggestable: true });
    suggestions = await p.suggestions();
    const suggested = suggestions.suggestions.find((x) => x.uuid === S.uuid);
    check('Vorschläge: Freund von Freunden mit Zahl der gemeinsamen (2), ohne deren Namen', suggested?.mutual === 2 && suggested.name === S.name && Object.keys(suggested).sort().join() === 'mutual,name,uuid', suggestions);
    check('Vorschläge: keine eigenen Freunde', !suggestions.suggestions.some((x) => x.uuid === Q.uuid || x.uuid === R.uuid));
    o = await p.requestSuggestion(S.uuid);
    check('Vorschlag: Anfrage gesendet', o.outgoing.some((x) => x.uuid === S.uuid), o.outgoing);
    check('Vorschlag mit offener Anfrage fällt weg', !(await p.suggestions()).suggestions.some((x) => x.uuid === S.uuid));
    await p.removeFriendRequest(S.uuid);
    await p.setPrivacy({ showSuggestions: false });
    suggestions = await p.suggestions();
    check('„Vorschläge zeigen“ aus: enabled false', !suggestions.enabled && suggestions.suggestions.length === 0, suggestions);
    await p.setPrivacy({ showSuggestions: true });

    // ---------- Party ----------
    partyP = new PartyClient({ auth: p, enabled: async () => true, onEvent: (e) => eventsP.push(e) });
    partyQ = new PartyClient({ auth: q, enabled: async () => true, onEvent: (e) => eventsQ.push(e) });
    let party = await partyP.refresh();
    await partyQ.refresh();
    check('Party: anfangs keine', party.status === 'ok' && party.party === null && party.invites.length === 0 && party.me === P.uuid, party);
    await rejects('Party: nur Freunde einladen', () => partyP!.invite(S.uuid), /nur Freunde/);
    party = await partyP.invite(Q.uuid);
    check('Party: einladen legt eine Party an, P leitet', party.party?.leader === P.uuid && party.party.members.length === 1 && party.party.invites[0]?.uuid === Q.uuid, party.party);
    await waitUntil('Party-Einladung in Echtzeit', () => partyQ!.current.invites.length === 1);
    check('Party-Einladung: Ereignis mit Einladendem', eventsQ.some((e) => e.kind === 'invite' && e.invite.from.uuid === P.uuid && !e.invite.quiet));
    party = await partyQ.accept(partyQ.current.invites[0].party);
    check('Party: angenommen, zwei Mitglieder, keine offene Einladung', party.party?.members.length === 2 && party.invites.length === 0, party);
    await waitUntil('Party: Leiter sieht das neue Mitglied in Echtzeit', () => partyP!.current.party?.members.length === 2);
    await partyP.chat('Hallo Party');
    await waitUntil('Party-Chat in Echtzeit', () => partyQ!.current.party?.chat.some((m) => m.text === 'Hallo Party' && !m.mine) === true);
    check('Party-Chat: Ereignis beim anderen, eigene als mine', eventsQ.some((e) => e.kind === 'chat' && e.message.text === 'Hallo Party') && partyP.current.party?.chat.some((m) => m.text === 'Hallo Party' && m.mine) === true);
    party = await partyP.transfer(Q.uuid);
    check('Party: Leitung übergeben', party.party?.leader === Q.uuid && party.party.members.find((m) => m.uuid === Q.uuid)?.leader === true);
    await rejects('Party: einladen nur durch den Leiter', () => partyP!.invite(R.uuid), /nur der Leiter/);
    const gameQ2 = await gameSocket(base, Q);
    games.push(gameQ2.socket);
    gameQ2.socket.send(JSON.stringify({ type: 'status', state: 'multiplayer', server: 'play.example.de' }));
    await waitUntil('Folgen: party-follow in Echtzeit', () => eventsP.some((e) => e.kind === 'follow'));
    const follow = eventsP.find((e) => e.kind === 'follow');
    check('Folgen: Leiter wechselt den Server → Ziel mit Adresse', follow?.kind === 'follow' && follow.target.kind === 'server' && follow.target.address === 'play.example.de' && follow.leader.uuid === Q.uuid, follow);
    if (follow?.kind === 'follow') {
      check('Folgen: automatisch nur ohne laufendes Spiel', followAction({ autoFollow: true, gameRunning: false, here: partyP.myLocation()?.address ?? null, target: follow.target }) === 'join'
        && followAction({ autoFollow: true, gameRunning: true, here: null, target: follow.target }) === 'notify');
    }
    await waitUntil('Party: Ort des Leiters sichtbar', () => partyP!.current.party?.target?.address === 'play.example.de');
    gameQ2.socket.close();
    party = await partyQ.kick(P.uuid);
    await waitUntil('Party: entfernt (Echtzeit)', () => partyP!.current.party === null);
    check('Party: entfernt → ended „removed“ mit Ereignis', partyP.current.ended === 'removed' && eventsP.some((e) => e.kind === 'ended' && e.reason === 'removed'), partyP.current);
    check('Party: allein ohne Einladung löst sich auf', party.party === null, party);
    await rejects('Party verlassen ohne Party', () => partyP!.leave(), /keiner Party/);
  } finally {
    for (const socket of games) socket.close();
    p.stop();
    q.stop();
  }
  check('Begleiter nach stop() aus', p.realtime === 'off' && q.realtime === 'off');
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
