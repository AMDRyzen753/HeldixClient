// Prüft die Logik von Freunde 2.0 im Launcher ohne Netz: Echtzeit-Begleiter (core/realtime.ts, mit nachgebautem
// WebSocket: Anmeldung im Header, Zustände, Ping, Neuverbinden mit Backoff, 4001/4003, Stopp), Freunde (Favoriten,
// Spitzname, Notiz, Status, „Nicht stören“, zuletzt online, Abzeichen, Sortierung, „ist online“, „Im Launcher“), Nachrichten
// (Antworten, Karten, Reaktionen, Rückfall-Text), Party (core/party.ts: Stand, Einladungen, Chat, Folgen, Ende),
// Welten in Echtzeit (core/worlds.ts) und die neuen Arten der Glocke (core/notifications.ts).
//
// Aufruf: npm run test:freunde

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Friend, PartyState } from '../shared/api';
import { inviteServer } from '../main/core/invites';
import { NotificationStore } from '../main/core/notifications';
import { PartyClient, followAction, locationText, mapLocation, mapParty, mapPartyChat, mapPartyInvite, mapPartyMember, mergeChat, type PartyEvent } from '../main/core/party';
import { BACKOFF_MS, BLOCKED_RETRY_MS, CompanionSocket, backoffDelay, companionUrl, parseMessage, type CompanionState, type SocketLike } from '../main/core/realtime';
import { BADGES, cameOnline, cardFallbackText, checkCard, cleanLine, displayName, joinableServer, mapCard, mapFriend, mapFriends, mapMessage, presenceRank, sortFriends } from '../main/core/social';
import { WorldClient, mapOwnWorld, mapWorldInvite } from '../main/core/worlds';
import { check, delay, finish, rejects } from './testkit';

const U = (c: string) => c.repeat(32);
const ME = U('e');
const LENA = U('1');
const MAX = U('2');
const PARTY = 'a'.repeat(32);

/** Nachgebauter WebSocket: merkt sich Adresse, Header und Gesendetes; open/message/close von außen */
class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: string[] = [];
  closedWith: number | null = null;
  constructor(readonly url: string, readonly headers: Record<string, string>) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(value: unknown): void {
    this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) });
  }
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

async function waitFor(label: string, condition: () => boolean, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (condition()) return true;
    await delay(10);
  }
  check(label, false, 'Zeitüberschreitung');
  return false;
}

async function realtimeTests(): Promise<void> {
  // ---------- Hilfen ----------
  check('Backoff: 1 s beim ersten Versuch (ohne Zufall)', backoffDelay(0, () => 0) === 1000);
  check('Backoff: höchstens 20 % Zufall obendrauf', backoffDelay(0, () => 1) === 1200 && backoffDelay(2, () => 0.5) === 5500);
  check('Backoff: steigt bis 60 s und bleibt dort', backoffDelay(5, () => 0) === 60_000 && backoffDelay(99, () => 0) === 60_000 && BACKOFF_MS.length === 6);
  check('Adresse: http → ws, https → wss, mit ?client=launcher', companionUrl('http://127.0.0.1:8787') === 'ws://127.0.0.1:8787/v1/ws?client=launcher'
    && companionUrl('https://api.heldixclient.com/') === 'wss://api.heldixclient.com/v1/ws?client=launcher');
  check('Nachricht lesen: JSON-Objekt mit type', parseMessage('{"type":"friend","friend":{}}')?.type === 'friend' && parseMessage(Buffer.from('{"type":"x"}'))?.type === 'x');
  check('Nachricht lesen: Unsinn, Arrays und ohne type fallen weg', parseMessage('kein json') === null && parseMessage('[1]') === null && parseMessage('{"a":1}') === null && parseMessage(42) === null);

  // ---------- Verbindung mit Attrappe ----------
  const sockets: FakeSocket[] = [];
  const states: CompanionState[] = [];
  const messages: Record<string, unknown>[] = [];
  const retries: boolean[] = [];
  let opens = 0;
  const companion = new CompanionSocket({
    base: 'http://127.0.0.1:8787',
    token: async (retry) => {
      retries.push(retry);
      return 'geheim';
    },
    socket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    onMessage: (message) => messages.push(message),
    onState: (state) => states.push(state),
    onOpen: () => opens++,
    pingMs: 30,
    random: () => 0,
  });
  check('Begleiter: vor dem Start aus', companion.state === 'off');
  companion.start();
  await waitFor('Begleiter: verbindet', () => sockets.length === 1);
  const first = sockets[0];
  check('Begleiter: Adresse mit ?client=launcher, Token nur im Header', first.url === 'ws://127.0.0.1:8787/v1/ws?client=launcher' && first.headers.authorization === 'Bearer geheim' && !first.url.includes('geheim'));
  check('Begleiter: erst „connecting“', companion.state === 'connecting' && states[0] === 'connecting');
  check('Begleiter: senden ohne Verbindung geht nicht', companion.send({ type: 'typing', to: LENA }) === false);
  first.open();
  check('Begleiter: nach dem Öffnen „live“, onOpen gerufen', companion.state === 'live' && opens === 1);
  check('Begleiter: senden mit Verbindung', companion.send({ type: 'typing', to: LENA }) && first.sent.includes(JSON.stringify({ type: 'typing', to: LENA })));
  first.message({ type: 'friend', friend: { uuid: LENA } });
  first.message({ type: 'pong' });
  first.message('kaputt');
  check('Begleiter: Nachrichten kommen an, pong und Unsinn nicht', messages.length === 1 && messages[0].type === 'friend', messages);
  await waitFor('Begleiter: ping alle 30 s (hier 30 ms)', () => first.sent.includes('{"type":"ping"}'));
  check('Begleiter: ping geschickt', first.sent.includes('{"type":"ping"}'));
  first.drop(1006);
  check('Begleiter: Verbindung weg → wieder „connecting“', companion.state === 'connecting');
  await waitFor('Begleiter: neu verbunden nach Backoff (1 s)', () => sockets.length === 2, 2500);
  check('Begleiter: neuer Versuch nach Abbruch einer stehenden Verbindung prüft das Token nicht', retries.at(-1) === false, retries);
  sockets[1].drop(1006);
  await waitFor('Begleiter: nächster Versuch', () => sockets.length === 3, 2500);
  check('Begleiter: kam die Verbindung gar nicht zustande, wird das Token geprüft (token(true))', retries.at(-1) === true, retries);
  sockets[2].open();
  check('Begleiter: wieder live, onOpen erneut (Party, Welten frisch holen)', companion.state === 'live' && opens === 2);
  sockets[2].drop(4003);
  await delay(1300);
  check(`Begleiter: nach 4003 (gesperrt) kein schneller Neuversuch (${BLOCKED_RETRY_MS / 60_000} Minuten)`, sockets.length === 3 && companion.state === 'connecting');
  companion.stop();
  check('Begleiter: gestoppt = aus', companion.state === 'off' && states.at(-1) === 'off');
  // nach dem Stopp kommen späte Ereignisse alter Verbindungen nicht mehr an
  sockets[2].message({ type: 'friend' });
  check('Begleiter: nach dem Stopp keine Nachrichten mehr', messages.length === 1);

  // Token geht nicht (Anmeldung fehlgeschlagen): später erneut, ohne Absturz
  let calls = 0;
  const failing = new CompanionSocket({
    base: 'http://127.0.0.1:1',
    token: async () => {
      calls++;
      throw new Error('keine Anmeldung');
    },
    socket: () => {
      throw new Error('darf nicht verbinden');
    },
    onMessage: () => undefined,
    random: () => 0,
  });
  failing.start();
  await waitFor('Begleiter: ohne Token wird es später wieder versucht', () => calls >= 2, 2500);
  failing.stop();
}

function friendTests(): void {
  const raw = {
    uuid: LENA, name: 'Lena', online: true, state: 'multiplayer', server: 'play.example.de', since: 1000,
    favorite: true, nickname: '  Lena\u0007 die Große  ', note: 'aus dem Bauprojekt', statusText: 'Baue an meiner Burg', dnd: true, lastOnline: 12345, badge: 'moderator',
  };
  const lena = mapFriend(raw, 3);
  check('Freund: eigene Angaben (Favorit, Spitzname bereinigt, Notiz)', lena.favorite && lena.nickname === 'Lena die Große' && lena.note === 'aus dem Bauprojekt' && lena.unread === 3, lena);
  check('Freund: Status, „Nicht stören“ (online), Abzeichen', lena.statusText === 'Baue an meiner Burg' && lena.dnd && lena.badge === 'moderator', lena);
  check('Freund: online → kein „zuletzt online“', lena.lastOnline === null);
  const offline = mapFriend({ ...raw, online: false, nickname: '', note: null, badge: 'kaiser' });
  check('Freund offline: „zuletzt online“, kein „Nicht stören“, leerer Spitzname = null, unbekanntes Abzeichen = null', offline.lastOnline === 12345 && !offline.dnd && offline.nickname === null && offline.note === null && offline.badge === null && offline.activity === null && offline.server === null, offline);
  check('Freund: Spitzname höchstens 24 Zeichen, Status höchstens 40', [...(mapFriend({ ...raw, nickname: 'x'.repeat(40) }).nickname ?? '')].length === 24 && [...(mapFriend({ ...raw, statusText: 'y'.repeat(60) }).statusText ?? '')].length === 40);
  check('Abzeichen: elf Werte (developer-team ≠ developer) plus null', BADGES.length === 10 && BADGES.includes('developer-team') && BADGES.includes('developer') && BADGES.includes('ambassador'));
  check('Anzeige-Name: Spitzname vor Spielername', displayName(lena) === 'Lena die Große' && displayName(offline) === 'Lena');

  const f = (name: string, online: boolean, favorite: boolean, nickname: string | null = null): Friend => ({ ...mapFriend({ uuid: name.charAt(0).repeat(32), name, online }), favorite, nickname });
  const sorted = sortFriends([f('Zoe', true, false), f('anna', false, true), f('Bert', false, false), f('Carl', true, true), f('Dora', true, false, 'Aaa')]);
  check('Sortierung: Favoriten oben (online zuerst), dann online, dann nach (Spitz-)Name', sorted.map((x) => x.name).join() === 'Carl,anna,Dora,Zoe,Bert', sorted.map((x) => x.name));
  const overview = mapFriends({ friends: [raw, { uuid: MAX, name: 'Max' }], unread: { [LENA]: 2 } }, { uuid: ME, name: 'Ich' });
  check('Übersicht: me mit Standardwerten (kein Abzeichen, „ist online“ für alle)', overview.me?.badge === null && overview.me?.onlineNotify === 'all' && !overview.me?.dnd && overview.realtime === 'off', overview.me);
  check('Übersicht: ungelesene je Freund und gesamt', overview.unread === 2 && overview.friends[0].uuid === LENA);

  const friends = [f('Lena', true, true), f('Max', true, false), f('Nora', false, true)];
  const before = new Set<string>();
  check('„ist online“: alle → alle neu online', cameOnline(before, friends, 'all').map((x) => x.name).join() === 'Lena,Max');
  check('„ist online“: nur Favoriten', cameOnline(before, friends, 'favorites').map((x) => x.name).join() === 'Lena');
  check('„ist online“: keine', cameOnline(before, friends, 'none').length === 0);
  check('„ist online“: wer schon online war, nicht noch einmal', cameOnline(new Set([friends[0].uuid]), friends, 'all').map((x) => x.name).join() === 'Max');
  check('Text wie Nachrichten: Steuer- und Schreibrichtungs-Zeichen weg, eine Zeile', cleanLine(' a‮b\nc\u0000 ') === 'ab c');
}

/** „Im Launcher“ (Dienst 1.14.0): Launcher offen, nicht im Spiel – eigener Zustand zwischen im Spiel und offline */
function launcherTests(): void {
  const base = { uuid: LENA, name: 'Lena', since: 1000, lastOnline: 12345, state: 'multiplayer', server: 'play.example.de' };
  const inLauncher = mapFriend({ ...base, online: false, launcher: true });
  check('Im Launcher: eigener Zustand, nicht online, kein Server, kein „zuletzt online“', inLauncher.launcher && !inLauncher.online && inLauncher.activity === null && inLauncher.server === null && inLauncher.lastOnline === null, inLauncher);
  check('Im Launcher: „Nicht stören“ gilt auch hier', mapFriend({ ...base, online: false, launcher: true, dnd: true }).dnd);
  check('Im Spiel hat Vorrang vor „Im Launcher“', (() => {
    const both = mapFriend({ ...base, online: true, launcher: true });
    return both.online && !both.launcher;
  })());
  check('Offline: weder Launcher noch „Nicht stören“', (() => {
    const off = mapFriend({ ...base, online: false, launcher: false, dnd: true });
    return !off.launcher && !off.dnd && off.lastOnline === 12345;
  })());
  check('Alter Dienst ohne Feld: nicht im Launcher', !mapFriend({ ...base, online: false }).launcher && !mapFriend({ ...base, online: false, launcher: 'ja' }).launcher);
  check('Rang: im Spiel > Launcher > offline', presenceRank({ online: true, launcher: false }) > presenceRank({ online: false, launcher: true }) && presenceRank({ online: false, launcher: true }) > presenceRank({ online: false, launcher: false }));

  const f = (name: string, state: 'spiel' | 'launcher' | 'offline', favorite = false): Friend => ({ ...mapFriend({ uuid: name.charAt(0).repeat(32), name, online: state === 'spiel', launcher: state === 'launcher' }), favorite });
  const sorted = sortFriends([f('Anna', 'offline'), f('Bert', 'launcher'), f('Carl', 'spiel'), f('Dora', 'launcher', true), f('Emil', 'offline', true), f('Finn', 'spiel', true), f('Gina', 'launcher')]);
  check('Sortierung: Favoriten (Spiel, Launcher, offline), dann im Spiel, im Launcher, offline', sorted.map((x) => x.name).join() === 'Finn,Dora,Emil,Carl,Bert,Gina,Anna', sorted.map((x) => x.name));
  check('„ist online“ nur beim Wechsel ins Spiel, nicht für „Im Launcher“', cameOnline(new Set(), [f('Bert', 'launcher'), f('Carl', 'spiel')], 'all').map((x) => x.name).join() === 'Carl');
  check('Beitreten nur im Spiel', joinableServer(inLauncher) === null && joinableServer(mapFriend({ ...base, online: true })) === 'play.example.de');

  const member = mapPartyMember({ uuid: MAX, name: 'Max', online: false, launcher: true });
  check('Party-Mitglied im Launcher', member?.launcher === true && member.online === false);
  check('Party-Mitglied im Spiel: Launcher-Feld aus', mapPartyMember({ uuid: MAX, name: 'Max', online: true, launcher: true })?.launcher === false);
  check('Party-Mitglied ohne Feld (alter Dienst)', mapPartyMember({ uuid: MAX, name: 'Max', online: false })?.launcher === false);
  check('Begleiter-Verbindung meldet sich als Launcher', /\/v1\/ws\?client=launcher$/.test(companionUrl('https://api.heldixclient.com')));
}

function messageTests(): void {
  const message = mapMessage({
    id: 7, from: LENA, to: ME, text: 'Komm auf play.example.de', at: 5, read: false,
    replyTo: { id: 3, from: ME, text: 'Wo seid ihr?' },
    card: { kind: 'server', target: 'Play.Example.de', title: 'Unser Survival' },
    reactions: { [ME]: 'fire', [LENA]: 'love', [MAX]: 'unbekannt', kaputt: 'like' },
  }, ME);
  check('Nachricht: Antwort, Karte (klein), Reaktionen (nur gültige)', message.replyTo?.id === 3 && message.replyTo.from === ME && message.card?.target === 'play.example.de'
    && message.card.title === 'Unser Survival' && Object.keys(message.reactions).length === 2 && message.reactions[ME] === 'fire' && !message.mine, message);
  const deleted = mapMessage({ id: 8, from: ME, to: LENA, text: 'x', replyTo: { id: 3, from: null, text: null } }, ME);
  check('Nachricht: Antwort auf gelöschte (from/text null), eigene', deleted.replyTo?.from === null && deleted.replyTo.text === null && deleted.mine && deleted.card === null);
  check('Karte vom Dienst: Welt klein, ungültige weg', mapCard({ kind: 'world', target: 'ABC234' })?.target === 'abc234' && mapCard({ kind: 'world', target: 'abc1de' }) === null && mapCard({ kind: 'invite', target: 'zu kurz' }) === null && mapCard({ kind: 'party', target: 'x' }) === null);

  const server = checkCard({ kind: 'server', target: 'Play.Example.de:25565', title: '' }, inviteServer);
  check('Karte senden: Server normalisiert (25565 fällt weg), Titel = Adresse', server.target === 'play.example.de' && server.title === 'play.example.de', server);
  check('Karte senden: Port ≠ 25565 bleibt', checkCard({ kind: 'server', target: 'mc.example.de:25570' }, inviteServer).target === 'mc.example.de:25570');
  let error = '';
  try {
    checkCard({ kind: 'server', target: '192.168.0.2' }, inviteServer);
  } catch (e) {
    error = (e as Error).message;
  }
  check('Karte senden: IP-Adresse abgelehnt (deutsch)', /öffentliche Serveradresse/.test(error), error);
  check('Karte senden: Welt-Code klein, Einladung 10 Zeichen', checkCard({ kind: 'world', target: 'K7M2XQ', title: 'Insel' }, inviteServer).target === 'k7m2xq' && checkCard({ kind: 'invite', target: 'abcdefghjk' }, inviteServer).kind === 'invite');
  let long = '';
  try {
    checkCard({ kind: 'world', target: 'k7m2xq', title: 'x'.repeat(61) }, inviteServer);
  } catch (e) {
    long = (e as Error).message;
  }
  check('Karte senden: Titel höchstens 60 Zeichen', /60 Zeichen/.test(long), long);
  check('Rückfall-Text: „Komm auf …“, Welt mit Adresse, Einladung als Link', cardFallbackText(server) === 'Komm auf play.example.de'
    && cardFallbackText({ kind: 'world', target: 'k7m2xq', title: 'Insel' }, 'k7m2xq.welt.example.de') === 'Komm in meine Welt „Insel“: k7m2xq.welt.example.de'
    && cardFallbackText({ kind: 'invite', target: 'abcdefghjk', title: '' }).includes('heldixclient://einladung/abcdefghjk'));
}

async function partyTests(): Promise<void> {
  const location = mapLocation({ kind: 'world', target: 'K7M2XQ', address: 'k7m2xq.welt.example.de', title: 'Insel der Ruhe' });
  check('Ort: Welt mit Code und Adresse', location?.kind === 'world' && location.target === 'k7m2xq' && location.title === 'Insel der Ruhe', location);
  check('Ort: Server, Titel = Adresse, ungültige weg', mapLocation({ kind: 'server', target: 'play.example.de', address: 'play.example.de' })?.title === 'play.example.de'
    && mapLocation({ kind: 'server', address: 'evil host/../' }) === null && mapLocation({ kind: 'world', target: 'zu-lang', address: 'x.de' }) === null);
  check('Ort als Text', locationText(location) === 'In „Insel der Ruhe“' && locationText(mapLocation({ kind: 'server', target: 'a.de', address: 'a.de' })) === 'Auf a.de' && /nicht/.test(locationText(null)));

  const rawParty = {
    id: PARTY, leader: LENA, created: 1, max: 8,
    members: [
      { uuid: LENA, name: 'Lena', leader: true, online: true, away: false, state: 'multiplayer', location: { kind: 'server', target: 'play.example.de', address: 'play.example.de', title: 'play.example.de' }, joined: 1 },
      { uuid: ME, name: 'Ich', leader: false, online: false, away: true, awayUntil: 99, state: null, location: null, joined: 2 },
      { uuid: 'kaputt' },
    ],
    invites: [{ uuid: MAX, name: 'Max', by: LENA, at: 3, expires: 600_003 }],
    target: { kind: 'server', target: 'play.example.de', address: 'play.example.de', title: 'play.example.de' },
    voice: { group: 'f'.repeat(64), server: 'play.example.de' },
    chat: [{ id: 2, from: LENA, name: 'Lena', text: 'Hallo', at: 4 }, { id: 1, from: ME, name: 'Ich', text: 'Hi', at: 3 }],
  };
  const party = mapParty(rawParty, ME);
  check('Party: Mitglieder (ungültige weg), Leiter, Einladungen, Ziel, Voice', party !== null && party.members.length === 2 && party.members[0].leader && !party.members[1].leader
    && party.members[1].away && party.members[1].awayUntil === 99 && party.invites[0].uuid === MAX && party.target?.address === 'play.example.de' && party.voice, party);
  check('Party: Chat nach ID, eigene markiert', party?.chat.map((m) => `${m.id}:${m.mine}`).join() === '1:true,2:false', party?.chat);
  check('Party: ohne gültige ID oder Mitglieder = keine', mapParty({ ...rawParty, id: 'x' }, ME) === null && mapParty({ ...rawParty, members: [] }, ME) === null);
  const invite = mapPartyInvite({ party: PARTY, from: { uuid: LENA, name: 'Lena' }, leader: { uuid: LENA, name: 'Lena' }, members: 3, at: 1, expires: 2, quiet: true });
  check('Einladung: von, Leiter, Mitglieder, still', invite?.from.name === 'Lena' && invite.members === 3 && invite.quiet, invite);
  const chat = mergeChat(Array.from({ length: 50 }, (_, i) => mapPartyChat({ id: i + 1, from: LENA, name: 'Lena', text: `n${i}`, at: i }, ME)!), [mapPartyChat({ id: 51, from: ME, name: 'Ich', text: 'neu', at: 60 }, ME)!, mapPartyChat({ id: 50, from: LENA, name: 'Lena', text: 'n49', at: 49 }, ME)!]);
  check('Party-Chat: ohne Doppelte, die letzten 50', chat.length === 50 && chat[0].id === 2 && chat.at(-1)?.id === 51 && chat.at(-1)?.mine === true);
  const target = party!.target!;
  check('Folgen: schon dort → nichts', followAction({ autoFollow: true, gameRunning: false, here: 'play.example.de', target }) === 'none');
  check('Folgen: automatisch nur ohne laufendes Spiel', followAction({ autoFollow: true, gameRunning: false, here: null, target }) === 'join'
    && followAction({ autoFollow: true, gameRunning: true, here: null, target }) === 'notify' && followAction({ autoFollow: false, gameRunning: false, here: 'a.de', target }) === 'notify');

  // Client mit nachgebautem Dienst: Stand, Echtzeit, Ende, Aktionen
  const routes: string[] = [];
  let response: unknown = { party: rawParty, invites: [] };
  const events: PartyEvent[] = [];
  const states: PartyState[] = [];
  const client = new PartyClient({
    auth: {
      authed: async <T>(route: string, init?: { method?: string; body?: unknown }) => {
        routes.push(`${init?.method ?? 'GET'} ${route}${init?.body ? ` ${JSON.stringify(init.body)}` : ''}`);
        return response as T;
      },
      accountId: async () => 'konto',
      canAuthenticate: async () => true,
      myServiceUuid: async () => ME,
    },
    enabled: async () => true,
    onUpdate: (state) => states.push(state),
    onEvent: (event) => events.push(event),
  });
  let state = await client.refresh();
  check('Party-Client: GET /v1/party → Stand mit me', state.status === 'ok' && state.party?.id === PARTY && state.me === ME && routes.at(-1) === 'GET /v1/party', state);
  check('Party-Client: eigener Ort (für „schon dort?“)', client.myLocation() === null);
  client.handle({ type: 'party-chat', party: PARTY, message: { id: 3, from: LENA, name: 'Lena', text: 'Kommt ihr?', at: 9 } });
  check('Echtzeit party-chat: angehängt, Ereignis für fremde Nachricht', client.current.party?.chat.at(-1)?.text === 'Kommt ihr?' && events.at(-1)?.kind === 'chat');
  client.handle({ type: 'party-chat', party: 'b'.repeat(32), message: { id: 4, from: LENA, name: 'Lena', text: 'falsche Party', at: 10 } });
  check('Echtzeit party-chat: andere Party wird ignoriert', client.current.party?.chat.at(-1)?.id === 3);
  client.handle({ type: 'party', party: { ...rawParty, chat: undefined, members: rawParty.members.slice(0, 2).map((m) => ({ ...m, away: false })) } });
  check('Echtzeit party: neuer Stand, Chat bleibt (gleiche Party)', client.current.party?.members[1].away === false && client.current.party.chat.length === 3);
  client.handle({ type: 'party-follow', party: PARTY, leader: { uuid: LENA, name: 'Lena' }, target: { kind: 'world', target: 'k7m2xq', address: 'k7m2xq.welt.example.de', title: 'Insel' } });
  const follow = events.at(-1);
  check('Echtzeit party-follow: Ereignis mit Leiter und Ziel', follow?.kind === 'follow' && follow.leader.name === 'Lena' && follow.target.kind === 'world', follow);
  client.handle({ type: 'party-invite', invite: { party: 'c'.repeat(32), from: { uuid: MAX, name: 'Max' }, leader: { uuid: MAX, name: 'Max' }, members: 1, at: 1, expires: 2, quiet: false }, invites: [{ party: 'c'.repeat(32), from: { uuid: MAX, name: 'Max' }, leader: { uuid: MAX, name: 'Max' }, members: 1, at: 1, expires: 2 }] });
  check('Echtzeit party-invite: offene Einladungen, Ereignis für die neue', client.current.invites.length === 1 && events.at(-1)?.kind === 'invite');
  client.handle({ type: 'party-invite', invite: null, invites: [] });
  check('Echtzeit party-invite ohne neue: nur Liste, kein Ereignis', client.current.invites.length === 0 && events.at(-1)?.kind === 'invite' && events.filter((e) => e.kind === 'invite').length === 1);
  client.handle({ type: 'party', party: null, reason: 'removed' });
  check('Echtzeit party null (entfernt): weg, ended, Ereignis', client.current.party === null && client.current.ended === 'removed' && events.at(-1)?.kind === 'ended');
  check('Fremde Echtzeit-Typen gehen nicht an die Party', client.handle({ type: 'friend' }) === false);
  response = { party: rawParty };
  state = await client.invite(MAX);
  check('Aktion einladen: POST /v1/party/invite mit UUID, Stand übernommen, ended zurück', routes.at(-1) === `POST /v1/party/invite {"uuid":"${MAX}"}` && state.party?.id === PARTY && state.ended === null, routes.at(-1));
  await rejects('Aktion einladen: ungültige UUID geht nicht raus', () => client.invite('../x'), /Ungültige Spieler-ID/);
  response = { party: null };
  state = await client.leave();
  check('Aktion verlassen: party null, ended „left“', routes.at(-1) === 'POST /v1/party/leave' && state.party === null && state.ended === 'left');
  await rejects('Party-Chat: leer', () => client.chat('   '), /leer/);
  await rejects('Party-Chat: höchstens 500 Zeichen', () => client.chat('x'.repeat(501)), /500 Zeichen/);
  await rejects('annehmen: ungültige Party-ID', () => client.accept('nein'), /Ungültige Party/);
  check('Party-Client: Stand je Änderung gemeldet', states.length >= 5);
}

async function worldTests(): Promise<void> {
  const invite = mapWorldInvite({ id: 'd'.repeat(32), name: 'Insel', address: 'K7M2XQ.welt.example.de', host: { uuid: LENA, name: 'Lena' } });
  check('world-invite: Code aus der Adresse, Gastgeber', invite?.code === 'k7m2xq' && invite.host.name === 'Lena' && invite.address === 'k7m2xq.welt.example.de', invite);
  check('world-invite: ungültig = null', mapWorldInvite({ id: 'x', address: 'k7m2xq.welt.example.de', host: { uuid: LENA } }) === null);
  check('eigene Welt: Code, Name, Adresse, offen', mapOwnWorld({ code: 'k7m2xq', name: 'Meine', address: 'k7m2xq.welt.example.de', online: true })?.online === true && mapOwnWorld({ name: 'ohne' }) === null);
  const opened: string[] = [];
  const client = new WorldClient({
    serviceUrl: 'http://127.0.0.1:1',
    auth: { authed: async <T>() => ({ mine: [{ code: 'ab3cde', name: 'Burg', address: 'ab3cde.welt.example.de', online: false }], friends: [] }) as T, accountId: async () => 'konto', canAuthenticate: async () => true },
    enabled: async () => true,
    onEvent: (event) => opened.push(event.world.name),
  });
  await client.refresh();
  check('Welten: eigene aus GET /v1/worlds → mine', client.ownWorlds().map((w) => w.code).join() === 'ab3cde');
  const world = { id: 'd'.repeat(32), name: 'Insel', address: 'k7m2xq.welt.example.de', host: { uuid: LENA, name: 'Lena' }, players: 2, maxPlayers: 8, version: '26.3', online: true };
  check('Echtzeit world-open: in der Liste, Ereignis', client.handleRealtime({ type: 'world-open', world }) && client.current.friends.length === 1 && opened.join() === 'Insel');
  client.handleRealtime({ type: 'world-open', world: { ...world, players: 3 } });
  check('Echtzeit world-open (Änderung): kein zweites Ereignis', client.current.friends[0].players === 3 && opened.length === 1);
  check('Echtzeit world-closed: weg', client.handleRealtime({ type: 'world-closed', world: { id: world.id } }) && client.current.friends.length === 0);
  check('andere Typen gehen nicht an die Welten', client.handleRealtime({ type: 'party' }) === false);
}

async function notificationTests(tmp: string): Promise<void> {
  const store = new NotificationStore(path.join(tmp, 'notifications.json'), { writeDelayMs: 1 });
  await store.add({ kind: 'party-invite', title: 'Lena lädt dich in die Party ein', target: { view: 'party' }, account: 'konto', key: `party-invite:${PARTY}` });
  await store.add({ kind: 'party-follow', title: 'Lena ist auf play.example.de', target: { view: 'party' }, account: 'konto' });
  await store.add({ kind: 'message', title: 'Neue Nachricht von Lena', target: { view: 'friends', uuid: LENA }, account: 'konto', key: `message:${LENA}` });
  await store.add({ kind: 'world-invite', title: 'Lena lädt dich in eine Welt ein', target: { view: 'world', code: 'k7m2xq' }, account: 'konto' });
  let list = await store.list('konto');
  check('Glocke: Party-Einladung, Folgen und Welt-Einladung mit Ziel', list.items.some((n) => n.kind === 'party-invite' && n.target?.view === 'party') && list.items.some((n) => n.kind === 'party-follow') && list.items.some((n) => n.kind === 'world-invite' && n.target?.code === 'k7m2xq') && list.unread === 4, list);
  await store.markKeyRead(`message:${LENA}`, 'konto');
  list = await store.list('konto');
  check('Glocke: Unterhaltung gelesen → „Neue Nachricht“ gelesen, der Rest bleibt', list.unread === 3 && list.items.find((n) => n.kind === 'message')?.read === true);
  await store.markKeyRead(`message:${LENA}`, 'anderes-konto');
  await store.flush();
  const reloaded = await new NotificationStore(path.join(tmp, 'notifications.json')).list('konto');
  check('Glocke: neue Arten überstehen das Speichern', reloaded.items.filter((n) => n.kind.startsWith('party-')).length === 2 && reloaded.unread === 3);
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-freunde2-'));
  try {
    await realtimeTests();
    friendTests();
    launcherTests();
    messageTests();
    await partyTests();
    await worldTests();
    await notificationTests(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  finish('Freunde 2.0 (ohne Netz)');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
