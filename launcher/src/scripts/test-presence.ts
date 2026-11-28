// Prüft den Discord-Status ohne Discord (npm run test:presence):
// - core/presence.ts: Statuszeile der Mod, Texte für alle Lagen (Launcher, Start, Hauptmenü, Einzelspieler, Server,
//   geteilte Welt als Gastgeber und Mitspieler, Realms, LAN, AFK, Voice), Schalter, Bilder, Knöpfe, Datenschutz
//   (keine IPs, Heimnetz-Namen, Welt-Adressen, Weltnamen nur mit Schalter), Längen (Texte ≤ 128, Knöpfe ≤ 32),
//   Zeit „seit“ und Party-ID je Ziel, Vorschau für die Einstellungen
// - core/discord.ts gegen einen nachgebauten Discord (eigene Named Pipe, nie die echte von Discord): später gestartetes
//   Discord wird gefunden, Bündelung (höchstens ein Update je Intervall, nur bei Änderung), Neuverbinden nach Abbruch,
//   Löschen beim Beenden
// - core/discordheads.ts: Kopf nur, wenn der Dienst ihn liefert (Fake-Fetch)

import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { DiscordRpc, MIN_SEND_INTERVAL_MS, RETRY_MS, type DiscordActivity } from '../main/core/discord';
import { PublicHeads, publicHeadUrl } from '../main/core/discordheads';
import {
  FALLBACK_IMAGE,
  GET_BUTTON,
  JOIN_BUTTON,
  MAX_TEXT,
  PresenceTracker,
  buildActivity,
  clampText,
  parseStatusLine,
  presenceButtons,
  presenceJoinServer,
  presenceJoinWorld,
  presenceTargetKey,
  previewOf,
  publicServerName,
  voiceText,
  type GameStatus,
  type PresenceInput,
} from '../main/core/presence';
import { check, delay, finish } from './testkit';

const SITE = 'https://heldixclient.com';
const HEAD = `https://api.heldixclient.com/v1/public/heads/${'a'.repeat(32)}.png?size=64`;
const WORLD = 'k7m2xq.welt.heldixclient.com';
const line = (json: unknown) => `[12:00:00] [Render thread/INFO]: HELDIX-STATUS ${JSON.stringify(json)}`;
const status = (json: Record<string, unknown>): GameStatus => {
  const parsed = parseStatusLine(line(json));
  if (!parsed) throw new Error(`Statuszeile nicht lesbar: ${JSON.stringify(json)}`);
  return parsed;
};
const base: PresenceInput = { phase: 'running', minecraft: '26.3', loader: 'heldix', heldixClient: true, startedAt: 1_000, since: 5_000, showServer: true, clientVersion: '0.13.8', imageBase: SITE, partyId: 'party-1234' };
const json = (activity: DiscordActivity) => JSON.stringify(activity);

function statusLine(): void {
  check('Statuszeile: alte Mod (nur Modus und Server)', JSON.stringify(parseStatusLine(line({ mode: 'multiplayer', server: 'mc.hypixel.net' }))) === JSON.stringify({ mode: 'multiplayer', server: 'mc.hypixel.net' }));
  const full = status({
    mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'nether', gameMode: 'survival', players: 1234, maxPlayers: 5000,
    voice: { inGroup: true, others: 3 }, afk: false, unbekannt: 'egal',
  });
  check('Statuszeile: neue Felder (Dimension, Spielmodus, Spieler, Voice)', full.dimension === 'nether' && full.gameMode === 'survival' && full.players === 1234 && full.maxPlayers === 5000
    && full.voice?.inGroup === true && full.voice.others === 3 && full.afk === undefined && !('unbekannt' in full), full);
  check('Statuszeile: Dimension als Minecraft-ID, unbekannte = andere', status({ mode: 'singleplayer', dimension: 'minecraft:the_end' }).dimension === 'end'
    && status({ mode: 'singleplayer', dimension: 'aether:the_aether' }).dimension === 'other');
  const world = status({ mode: 'singleplayer', world: { address: 'K7M2XQ.welt.heldixclient.com:25565', host: true, players: 3, max: 8 } });
  check('Statuszeile: geteilte Welt (Adresse normalisiert)', world.world?.address === WORLD && world.world.host && world.world.players === 3 && world.world.max === 8, world);
  check('Statuszeile: ungültige Welt-Adresse fällt weg', status({ mode: 'singleplayer', world: { address: '192.168.0.2', host: true } }).world === undefined);
  check('Statuszeile: ungültige Werte fallen weg', JSON.stringify(status({ mode: 'menu', gameMode: 'hardcore', players: -1, maxPlayers: 1.5, voice: 'ja', afk: 'ja' })) === JSON.stringify({ mode: 'menu' }));
  check('Statuszeile: AFK', status({ mode: 'menu', afk: true }).afk === true);
  check('Statuszeile: Weltname ohne Farbcodes und Steuerzeichen, gekürzt', status({ mode: 'singleplayer', worldName: '§aMeine\u0007 Welt' }).worldName === 'Meine Welt'
    && [...(status({ mode: 'singleplayer', worldName: 'x'.repeat(200) }).worldName ?? '')].length === 40);
  check('Statuszeile: kaputt oder unbekannter Modus = null', parseStatusLine(line({ mode: 'kino' })) === null && parseStatusLine('HELDIX-STATUS {kaputt') === null
    && parseStatusLine('HELDIX-STATUS [1,2]') === null && parseStatusLine('normale Logzeile') === null);
  // Heldix-Party (0.13.8): leader ist ein Wahrheitswert (bin ich Leiter?), kein Name
  const party = status({ mode: 'menu', party: { size: 2, max: 8, leader: true } });
  check('Statuszeile: Party (Größe, höchstens, Leiter als Wahrheitswert)', party.party?.size === 2 && party.party.max === 8 && party.party.leader === true, party);
  check('Statuszeile: Party – leader als Name zählt nicht als Leiter, Unsinn fällt weg', status({ mode: 'menu', party: { size: 3, max: 8, leader: 'Lena' } }).party?.leader === false
    && status({ mode: 'menu', party: { size: 9, max: 8, leader: true } }).party === undefined && status({ mode: 'menu', party: [2, 8] }).party === undefined
    && status({ mode: 'menu', party: { size: 0, max: 8 } }).party === undefined);
}

function heldixParty(): void {
  const onServer = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'overworld', players: 1234, maxPlayers: 5000, party: { size: 2, max: 8, leader: false } }) });
  check('Party: „(2 von 8)“ der Party statt der Spielerzahl des Servers, „In einer Party“', JSON.stringify(onServer.party?.size) === '[2,8]' && /In einer Party/.test(onServer.state ?? ''), onServer);
  check('Party: Discord-Party-ID bleibt die zufällige je Ziel (nie die der Heldix-Party)', onServer.party?.id === 'party-1234');
  const leading = buildActivity({ ...base, status: status({ mode: 'menu', party: { size: 3, max: 8, leader: true } }) });
  check('Party im Hauptmenü: „Leitet eine Party“ mit (3 von 8)', leading.state === 'Leitet eine Party' && JSON.stringify(leading.party?.size) === '[3,8]', leading);
  const alone = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', players: 10, maxPlayers: 100, party: { size: 1, max: 8, leader: true } }) });
  check('Party allein: wie ohne Party (Spielerzahl des Servers)', JSON.stringify(alone.party?.size) === '[10,100]' && !/Party/.test(alone.state ?? ''), alone);
  const inWorld = buildActivity({ ...base, status: status({ mode: 'singleplayer', world: { address: WORLD, host: true, players: 3, max: 8 }, party: { size: 2, max: 8, leader: true } }) });
  check('Party in der eigenen geteilten Welt: Party-Größe', JSON.stringify(inWorld.party?.size) === '[2,8]', inWorld);
  const off = buildActivity({ ...base, options: { showParty: false }, status: status({ mode: 'menu', party: { size: 2, max: 8, leader: false } }) });
  check('Party: Schalter „Spielerzahl“ aus → keine Party, kein Text', !off.party && !/Party/.test(off.state ?? ''), off);
  const single = buildActivity({ ...base, status: status({ mode: 'singleplayer', dimension: 'nether', party: { size: 4, max: 8, leader: false } }) });
  check('Party im Einzelspieler: Größe und Text', JSON.stringify(single.party?.size) === '[4,8]' && single.state === 'Im Nether · In einer Party', single);
}

function privacy(): void {
  const cases: [string, string | null][] = [
    ['mc.hypixel.net', 'mc.hypixel.net'],
    ['Hypixel.net:25565', 'hypixel.net'],
    ['192.168.0.12', null],
    ['192.168.0.12:25565', null],
    ['localhost', null],
    ['[::1]:25565', null],
    ['meinserver.local', null],
    ['nas.fritz.box', null],
    ['router.home.arpa', null],
    ['minecraft', null],
    [WORLD, null],
    ['abcdef.welt.heldixclient.com:25565', null],
  ];
  for (const [input, expected] of cases) check(`Servername „${input}“ → ${expected ?? 'nicht zeigen'}`, publicServerName(input) === expected, publicServerName(input));

  const ip = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: '10.0.0.5:25565', dimension: 'overworld' }) });
  check('Datenschutz: IP-Server → „Spielt Mehrspieler“, keine IP im Status', ip.details === 'Spielt Mehrspieler' && !json(ip).includes('10.0.0.5'), ip);
  const hidden = buildActivity({ ...base, showServer: false, status: status({ mode: 'multiplayer', server: 'mc.hypixel.net' }) });
  check('Datenschutz: Server aus → kein Servername', hidden.details === 'Spielt Mehrspieler' && !json(hidden).includes('hypixel'), hidden);
  const guest = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: WORLD, world: { address: WORLD, host: false } }) });
  check('Datenschutz: Welt-Adresse steht nie im Status', !json(guest).includes('k7m2xq'), guest);
  const oldGuest = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: WORLD }) });
  check('Datenschutz: ältere Mod in einer Welt (ohne Feld world) → als Welt erkannt', oldGuest.details === 'In einer geteilten Welt' && !json(oldGuest).includes('k7m2xq'), oldGuest);
  const named = status({ mode: 'singleplayer', dimension: 'overworld', worldName: 'Geheimbasis' });
  check('Datenschutz: Weltname nur mit Schalter (Standard aus)', !json(buildActivity({ ...base, status: named })).includes('Geheimbasis')
    && buildActivity({ ...base, status: named, options: { showWorldName: true } }).details === 'Spielt in „Geheimbasis“');
}

function texts(): void {
  const launcher = buildActivity({ ...base, phase: 'launcher', view: 'store' });
  check('Launcher: „Im Launcher“ – „Stöbert im Addon-Store“', launcher.details === 'Im Launcher' && launcher.state === 'Stöbert im Addon-Store' && !launcher.timestamps && !launcher.party, launcher);
  check('Launcher: Cosmetics, Einrichtung, verborgenes Fenster', buildActivity({ ...base, phase: 'launcher', view: 'profile' }).state === 'Richtet Cosmetics ein'
    && buildActivity({ ...base, phase: 'launcher', view: 'setup' }).state === 'Richtet HeldixClient ein'
    && buildActivity({ ...base, phase: 'launcher', view: null }).state === 'Sucht sich eine Instanz aus');
  const preparing = buildActivity({ ...base, phase: 'preparing' });
  check('Start: „Startet Minecraft 26.3 …“', preparing.details === 'Startet Minecraft 26.3 …' && preparing.state === 'Mit HeldixClient', preparing);
  check('Start: Fabric ohne HeldixClient', buildActivity({ ...base, phase: 'preparing', loader: 'fabric', heldixClient: false }).state === 'Mit Fabric');
  const noStatus = buildActivity({ ...base, status: null });
  check('Spiel ohne Statuszeile (Vanilla, alte Mod)', noStatus.details === 'Spielt Minecraft 26.3' && noStatus.timestamps?.start === 5_000, noStatus);
  const menu = buildActivity({ ...base, status: status({ mode: 'menu' }) });
  check('Hauptmenü', menu.details === 'Im Hauptmenü' && menu.state === 'Minecraft 26.3 · HeldixClient' && menu.assets?.large_image === `${SITE}/discord/hauptmenue.png`, menu);
  const nether = buildActivity({ ...base, status: status({ mode: 'singleplayer', dimension: 'nether', gameMode: 'survival' }) });
  check('Einzelspieler: „Im Nether · Überleben“ mit Nether-Bild', nether.details === 'Spielt Einzelspieler' && nether.state === 'Im Nether · Überleben' && nether.assets?.large_image === `${SITE}/discord/nether.png`, nether);
  check('Einzelspieler: End, Oberwelt, andere Dimension', buildActivity({ ...base, status: status({ mode: 'singleplayer', dimension: 'end', gameMode: 'creative' }) }).state === 'Im End · Kreativ'
    && buildActivity({ ...base, status: status({ mode: 'singleplayer', dimension: 'overworld', gameMode: 'adventure' }) }).assets?.large_image === `${SITE}/discord/oberwelt.png`
    && buildActivity({ ...base, status: status({ mode: 'singleplayer', dimension: 'other', gameMode: 'spectator' }) }).state === 'In einer anderen Dimension · Zuschauer');
  const noDetails = buildActivity({ ...base, options: { showDetails: false }, status: status({ mode: 'singleplayer', dimension: 'nether', gameMode: 'survival' }) });
  check('Schalter Dimension/Spielmodus aus: weder Text noch Nether-Bild', noDetails.state === 'Minecraft 26.3' && noDetails.assets?.large_image === `${SITE}/discord/spiel.png`, noDetails);
  const server = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'overworld', gameMode: 'survival', players: 1234, maxPlayers: 5000, voice: { inGroup: false, others: 3 } }) });
  check('Server: „Spielt auf mc.hypixel.net“, Oberwelt · Überleben · Voice, Spielerzahl', server.details === 'Spielt auf mc.hypixel.net'
    && server.state === 'In der Oberwelt · Überleben · Im Voice mit 3 anderen' && JSON.stringify(server.party?.size) === '[1234,5000]' && server.party?.id === 'party-1234'
    && server.assets?.large_image === `${SITE}/discord/server.png`, server);
  check('Voice: allein, zu zweit, Gruppe', voiceText({ inGroup: false, others: 0 }) === 'Im Voice' && voiceText({ inGroup: false, others: 1 }) === 'Im Voice zu zweit'
    && voiceText({ inGroup: true, others: 5 }) === 'In der Voice-Gruppe mit 5 anderen');
  const noVoice = buildActivity({ ...base, options: { showVoice: false, showParty: false }, status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'nether', players: 3, maxPlayers: 8, voice: { inGroup: false, others: 3 } }) });
  check('Schalter Voice und Spielerzahl aus', noVoice.state === 'Im Nether' && !noVoice.party, noVoice);
  const afk = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'nether', afk: true }) });
  check('AFK: „Abwesend“', afk.details === 'Spielt auf mc.hypixel.net' && afk.state === 'Abwesend', afk);
  const host = buildActivity({ ...base, status: status({ mode: 'singleplayer', dimension: 'overworld', gameMode: 'survival', world: { address: WORLD, host: true, players: 3, max: 8 } }) });
  check('Geteilte Welt (Gastgeber): „Teilt seine Welt“, (3 von 8), Bild geteilte Welt', host.details === 'Teilt seine Welt' && host.state === 'In der Oberwelt · Überleben'
    && JSON.stringify(host.party?.size) === '[3,8]' && host.assets?.large_image === `${SITE}/discord/geteilte-welt.png`, host);
  const world = { code: 'k7m2xq', hostName: 'Lena', online: true, players: 4, maxPlayers: 8, access: 'closed' as const };
  const guestStatus = status({ mode: 'multiplayer', server: WORLD, dimension: 'nether', world: { address: WORLD, host: false } });
  const guest = buildActivity({ ...base, world, status: guestStatus });
  check('Geteilte Welt (Mitspieler): „In der Welt von Lena“ (4 von 8)', guest.details === 'In der Welt von Lena' && guest.state === 'Im Nether' && JSON.stringify(guest.party?.size) === '[4,8]', guest);
  check('Geteilte Welt ohne Welt-Info bzw. Server aus: „In einer geteilten Welt“', buildActivity({ ...base, status: guestStatus }).details === 'In einer geteilten Welt'
    && buildActivity({ ...base, world, showServer: false, status: guestStatus }).details === 'In einer geteilten Welt');
  check('Realms und LAN', buildActivity({ ...base, status: status({ mode: 'realms' }) }).details === 'Spielt auf Realms' && buildActivity({ ...base, status: status({ mode: 'lan' }) }).details === 'Spielt im LAN');
  const invalidParty = buildActivity({ ...base, status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', players: 9, maxPlayers: 8 }) });
  check('Spielerzahl größer als Maximum → keine Party', !invalidParty.party);
  check('Zeit: ab Betreten des Ziels, sonst Spielstart', buildActivity({ ...base, status: status({ mode: 'menu' }) }).timestamps?.start === 5_000
    && buildActivity({ ...base, since: undefined, status: status({ mode: 'menu' }) }).timestamps?.start === 1_000);
}

function images(): void {
  const withHead = buildActivity({ ...base, player: { name: 'Lena', head: HEAD, cape: 'Freundesband' }, status: status({ mode: 'menu' }) });
  check('Kleines Bild: eigener Kopf mit Name und Cape', withHead.assets?.small_image === HEAD && withHead.assets.small_text === 'Lena · Cape: Freundesband', withHead.assets);
  const headOff = buildActivity({ ...base, options: { showHead: false }, player: { name: 'Lena', head: HEAD }, status: status({ mode: 'menu' }) });
  check('Kopf aus: Loader-Symbol, kein Name', headOff.assets?.small_image === `${SITE}/discord/loader-heldix.png` && !json(headOff).includes('Lena'), headOff.assets);
  const noHead = buildActivity({ ...base, player: { name: 'Lena', head: null }, loader: 'vanilla', status: null });
  check('Kein Kopf vom Dienst: Loader-Symbol (Vanilla)', noHead.assets?.small_image === `${SITE}/discord/loader-vanilla.png` && noHead.assets.small_text === 'Vanilla', noHead.assets);
  const fabric = buildActivity({ ...base, loader: 'fabric', heldixClient: false, status: null });
  check('Loader-Symbol Fabric', fabric.assets?.small_image === `${SITE}/discord/loader-fabric.png`);
  check('Kopf nur als https-Link', buildActivity({ ...base, player: { name: 'Lena', head: 'http://127.0.0.1/kopf.png' }, status: null }).assets?.small_image !== 'http://127.0.0.1/kopf.png');
  const launcher = buildActivity({ ...base, phase: 'launcher' });
  check('Launcher ohne Kopf: kein kleines Bild', launcher.assets?.large_image === `${SITE}/discord/launcher.png` && !launcher.assets.small_image, launcher.assets);
  const fallback = buildActivity({ ...base, imageBase: null, status: status({ mode: 'singleplayer', dimension: 'nether' }) });
  check('Ohne https-Webseite: Asset-Schlüssel discord-logo, kein Loader-Symbol', fallback.assets?.large_image === FALLBACK_IMAGE && !fallback.assets.small_image, fallback.assets);
  check('Http-Webseite zählt nicht', buildActivity({ ...base, imageBase: 'http://heldixclient.com', status: null }).assets?.large_image === FALLBACK_IMAGE);
  check('Hover groß: Minecraft- und HeldixClient-Version', buildActivity({ ...base, status: null }).assets?.large_text === 'Minecraft 26.3 · HeldixClient 0.13.8');
  check('Kopf-Link vom Dienst (nur https)', publicHeadUrl('https://api.heldixclient.com/', 'AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaaa'.replace(/-/g, '')) === HEAD
    && publicHeadUrl('http://127.0.0.1:8787', 'a'.repeat(32)) === null && publicHeadUrl('https://x.de', 'kaputt') === null);
}

function buttons(): void {
  const general = 'https://heldixclient.com/einladung#aaaaaaaaaa';
  const serverLink = 'https://heldixclient.com/einladung#bbbbbbbbbb';
  const worldLink = 'https://heldixclient.com/welt#k7m2xq';
  const guestStatus = status({ mode: 'multiplayer', server: WORLD, world: { address: WORLD, host: false } });
  const open = { code: 'k7m2xq', hostName: 'Lena', online: true, players: 2, maxPlayers: 8, access: 'open' as const };
  check('Mitspielen (Welt): nur offen, online und passender Code', presenceJoinWorld({ ...base, status: guestStatus, world: open }) === 'k7m2xq'
    && presenceJoinWorld({ ...base, status: guestStatus, world: { ...open, access: 'closed' } }) === null
    && presenceJoinWorld({ ...base, status: guestStatus, world: { ...open, online: false } }) === null
    && presenceJoinWorld({ ...base, status: guestStatus, world: { ...open, code: 'abcdef' } }) === null
    && presenceJoinWorld({ ...base, status: guestStatus, world: open, showServer: false }) === null
    && presenceJoinWorld({ ...base, phase: 'launcher', status: guestStatus, world: open }) === null);
  check('Mitspielen (Server): nie für Welt-Adressen', presenceJoinServer({ ...base, status: guestStatus }) === null
    && presenceJoinServer({ ...base, status: status({ mode: 'multiplayer', server: 'play.example.de:25570' }) }) === 'play.example.de:25570');
  const worldButtons = presenceButtons({ ...base, status: guestStatus, world: open }, { general, server: serverLink, world: worldLink });
  check('Knöpfe in offener Welt: Mitspielen (Welt-Seite) + HeldixClient holen', worldButtons.map((b) => `${b.label}=${b.url}`).join() === `${JOIN_BUTTON}=${worldLink},${GET_BUTTON}=${general}`, worldButtons);
  check('Knöpfe in geschlossener Welt: nur HeldixClient holen', presenceButtons({ ...base, status: guestStatus, world: { ...open, access: 'closed' } }, { general, server: serverLink, world: worldLink }).map((b) => b.label).join() === GET_BUTTON);
  check('Schalter Knöpfe aus bzw. nur „Spielt HeldixClient“: keine Knöpfe', presenceButtons({ ...base, options: { buttons: false }, status: guestStatus, world: open }, { general, server: null, world: worldLink }).length === 0
    && presenceButtons({ ...base, options: { minimal: true }, status: guestStatus, world: open }, { general, server: null, world: worldLink }).length === 0);
  check('Knöpfe: Welt-Link nur https', presenceButtons({ ...base, status: guestStatus, world: open }, { general: null, server: null, world: 'heldixclient://welt/k7m2xq' }).length === 0);
  const long = buildActivity({ ...base, status: null, buttons: [{ label: 'x'.repeat(40), url: general }, { label: 'ok', url: 'heldixclient://x' }, { label: 'gut', url: general }, { label: 'dritter', url: general }] });
  check('Knöpfe im Status: höchstens 2, Beschriftung ≤ 32, nur https', long.buttons?.map((b) => b.label).join() === 'gut,dritter', long.buttons);
}

function minimalAndLengths(): void {
  const minimal = buildActivity({ ...base, options: { minimal: true }, player: { name: 'Lena', head: HEAD }, buttons: [{ label: 'Mitspielen', url: 'https://x.de' }], status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'nether', players: 3, maxPlayers: 8 }) });
  check('Nur „Spielt HeldixClient“: kein Text, kein Server, kein Kopf, keine Knöpfe, Zeit seit Spielstart', !minimal.details && !minimal.state && !minimal.party && !minimal.buttons
    && !minimal.assets?.small_image && minimal.assets?.large_image === `${SITE}/discord/launcher.png` && minimal.timestamps?.start === 1_000 && !json(minimal).includes('hypixel'), minimal);
  const longServer = `${'a'.repeat(70)}.example.de`;
  const longs = buildActivity({
    ...base,
    clientVersion: 'v'.repeat(200),
    player: { name: 'N'.repeat(16), head: HEAD, cape: 'C'.repeat(200) },
    options: { showWorldName: true },
    status: status({ mode: 'singleplayer', dimension: 'other', gameMode: 'spectator', worldName: 'W'.repeat(39) + '😀', voice: { inGroup: true, others: 9999 } }),
  });
  const fields = [longs.details, longs.state, longs.assets?.large_text, longs.assets?.small_text];
  check('Längen: alle Texte 2–128 Zeichen', fields.every((f) => !f || (f.length >= 2 && f.length <= MAX_TEXT)), fields.map((f) => f?.length));
  check('Lange Servernamen gekürzt', (buildActivity({ ...base, status: status({ mode: 'multiplayer', server: longServer }) }).details?.length ?? 999) <= MAX_TEXT && publicServerName(longServer)!.endsWith('…'));
  check('clampText: zu kurz weg, Emoji nicht zerschnitten', clampText('a') === undefined && clampText('  ') === undefined
    && clampText(`${'x'.repeat(126)}😀😀`)!.length <= MAX_TEXT && !/[\ud800-\udbff]…$/.test(clampText(`${'x'.repeat(126)}😀😀`)!));
}

function tracker(): void {
  let now = 100;
  let n = 0;
  const t = new PresenceTracker(() => now, () => `party-${++n}`);
  const menu = status({ mode: 'menu' });
  const first = t.next('running', menu);
  now = 200;
  const same = t.next('running', status({ mode: 'menu', voice: { inGroup: false, others: 1 } }));
  check('Ziel gleich (Hauptmenü, nur Voice anders): Zeit und Party bleiben', first.since === 100 && same.since === 100 && same.partyId === first.partyId);
  now = 300;
  const server = t.next('running', status({ mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'overworld' }));
  now = 400;
  const nether = t.next('running', status({ mode: 'multiplayer', server: 'MC.hypixel.net:25565', dimension: 'nether' }));
  check('Server betreten: neue Zeit und Party; Dimension wechseln: bleibt', server.since === 300 && server.partyId !== first.partyId && nether.since === 300 && nether.partyId === server.partyId);
  now = 500;
  const sharing = t.next('running', status({ mode: 'singleplayer', world: { address: WORLD, host: true } }));
  check('Welt teilen beginnt: neue Zeit', sharing.since === 500);
  check('Zielschlüssel', presenceTargetKey('launcher', null) === 'launcher' && presenceTargetKey('running', status({ mode: 'multiplayer', server: WORLD })) === `world:${WORLD}`
    && presenceTargetKey('running', status({ mode: 'multiplayer', server: 'a.de:25565' })) === 'server:a.de');
}

function preview(): void {
  const activity = buildActivity({ ...base, player: { name: 'Lena', head: HEAD }, buttons: [{ label: JOIN_BUTTON, url: 'https://heldixclient.com/welt#k7m2xq' }], status: status({ mode: 'multiplayer', server: 'mc.hypixel.net', dimension: 'nether', players: 3, maxPlayers: 8 }) });
  const view = previewOf(activity, false, { uuid: 'a'.repeat(32), name: 'Lena' });
  check('Vorschau: Texte, Bildnamen, Kopf, Party, Knöpfe, aus', view.details === 'Spielt auf mc.hypixel.net' && view.largeImage === 'server' && view.smallImage === 'head'
    && JSON.stringify(view.party) === '[3,8]' && view.buttons.join() === JOIN_BUTTON && view.enabled === false && view.since === 5_000, view);
  check('Vorschau: Asset-Schlüssel = Logo', previewOf(buildActivity({ ...base, imageBase: null, status: null }), true, null).largeImage === null);
}

// ---------- Discord-IPC gegen einen nachgebauten Discord ----------

interface FakeDiscord {
  activities: (DiscordActivity | null)[];
  handshakes: number;
  stop(): Promise<void>;
  dropClients(): void;
}

function pipeName(id: string, index: number): string {
  return process.platform === 'win32' ? `\\\\?\\pipe\\heldix-test-${id}-${index}` : path.join(os.tmpdir(), `heldix-test-${id}-${index}.sock`);
}

function frame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

async function fakeDiscord(file: string): Promise<FakeDiscord> {
  const activities: (DiscordActivity | null)[] = [];
  const sockets = new Set<net.Socket>();
  let handshakes = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const op = buffer.readInt32LE(0);
        const length = buffer.readInt32LE(4);
        if (buffer.length < 8 + length) return;
        const payload = JSON.parse(buffer.subarray(8, 8 + length).toString('utf8')) as { cmd?: string; nonce?: string; args?: { activity?: DiscordActivity | null } };
        buffer = buffer.subarray(8 + length);
        if (op === 0) {
          handshakes++;
          socket.write(frame(1, { cmd: 'DISPATCH', evt: 'READY', data: { user: { username: 'Testnutzer' } } }));
        } else if (op === 1 && payload.cmd === 'SET_ACTIVITY') {
          activities.push(payload.args?.activity ?? null);
          socket.write(frame(1, { cmd: 'SET_ACTIVITY', data: payload.args?.activity ?? null, evt: null, nonce: payload.nonce }));
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(file, () => resolve());
  });
  return {
    activities,
    get handshakes() {
      return handshakes;
    },
    dropClients: () => sockets.forEach((s) => s.destroy()),
    stop: () => new Promise<void>((resolve) => {
      sockets.forEach((s) => s.destroy());
      server.close(() => resolve());
    }),
  } as FakeDiscord;
}

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (condition()) return true;
    await delay(20);
  }
  return condition();
}

async function ipc(): Promise<void> {
  check('Bündelung: höchstens alle 15 Sekunden, still neu verbinden alle 15 Sekunden', MIN_SEND_INTERVAL_MS === 15_000 && RETRY_MS === 15_000);
  const id = randomBytes(6).toString('hex');
  const pipe = (index: number) => pipeName(id, index);
  const states: string[] = [];
  const rpc = new DiscordRpc('123456789', () => undefined, { pipePath: pipe, minIntervalMs: 400, retryMs: 150 });
  rpc.onStatus = (s) => states.push(s.state);
  const a: DiscordActivity = { details: 'Im Launcher', state: 'Sucht sich eine Instanz aus' };
  rpc.setActivity(a);
  rpc.start();
  check('Discord läuft nicht: „unavailable“', await waitFor(() => rpc.connection.state === 'unavailable', 3000), states);

  // Discord startet später: der Launcher findet es von selbst und setzt den Status sofort
  const discord = await fakeDiscord(pipe(0));
  check('Discord später gestartet: verbindet von selbst', await waitFor(() => rpc.connection.state === 'connected', 3000), states);
  check('… und setzt den Status sofort', await waitFor(() => discord.activities.length === 1, 1500) && JSON.stringify(discord.activities[0]) === JSON.stringify(a), discord.activities);

  // viele Änderungen schnell hintereinander: nur die letzte kommt an, frühestens nach dem Intervall
  const sentAt = Date.now();
  for (let i = 1; i <= 5; i++) rpc.setActivity({ details: 'Spielt Einzelspieler', state: `Stand ${i}` });
  await delay(150);
  check('Bündelung: innerhalb des Intervalls nichts Neues', discord.activities.length === 1, discord.activities.length);
  check('Bündelung: danach genau ein Update mit dem neuesten Stand', await waitFor(() => discord.activities.length === 2, 2000)
    && discord.activities[1]?.state === 'Stand 5' && Date.now() - sentAt >= 300, discord.activities);
  await delay(600);
  check('Bündelung: keine weiteren Updates ohne Änderung', discord.activities.length === 2, discord.activities.length);
  rpc.setActivity({ details: 'Spielt Einzelspieler', state: 'Stand 5' });
  await delay(700);
  check('Gleicher Stand noch einmal: nichts gesendet', discord.activities.length === 2, discord.activities.length);

  // Discord startet neu (Verbindung bricht ab): still neu verbinden, Status erneut setzen
  discord.dropClients();
  check('Abbruch: neu verbunden', await waitFor(() => discord.handshakes >= 2 && rpc.connection.state === 'connected', 3000), { handshakes: discord.handshakes, state: rpc.connection.state });
  check('Abbruch: Status nach dem Neuverbinden erneut gesetzt', await waitFor(() => discord.activities.length === 3, 2000) && discord.activities[2]?.state === 'Stand 5', discord.activities);

  // Beenden: Status löschen und warten, bis es raus ist
  await rpc.stop();
  check('Beenden: Status gelöscht (null)', await waitFor(() => discord.activities.length === 4, 1500) && discord.activities[3] === null, discord.activities);
  check('Beenden: Verbindungszustand „disabled“', rpc.connection.state === 'disabled');
  await discord.stop();
}

async function heads(): Promise<void> {
  let calls = 0;
  let changes = 0;
  const okFetch = (async () => {
    calls++;
    return new Response(new Uint8Array([0x89, 0x50]), { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  const good = new PublicHeads('https://api.heldixclient.com', () => changes++, okFetch);
  check('Kopf: erst unbekannt (Loader-Symbol), Prüfung im Hintergrund', good.url('a'.repeat(32)) === null);
  await delay(30);
  check('Kopf: danach der Link, einmal gefragt', good.url('a'.repeat(32)) === HEAD && calls === 1 && changes === 1);
  good.url('a'.repeat(32));
  check('Kopf: zwischengespeichert', calls === 1);
  const missing = new PublicHeads('https://api.heldixclient.com', () => undefined, (async () => new Response('nicht da', { status: 404 })) as typeof fetch);
  missing.url('b'.repeat(32));
  await delay(30);
  check('Kopf: älterer Dienst (404) → Loader-Symbol', missing.url('b'.repeat(32)) === null);
  const local = new PublicHeads('http://127.0.0.1:8787', () => undefined, okFetch);
  check('Kopf: Dienst ohne https → nie (Discord kann ihn nicht laden)', local.url('a'.repeat(32)) === null);
}

async function main(): Promise<void> {
  statusLine();
  privacy();
  heldixParty();
  texts();
  images();
  buttons();
  minimalAndLengths();
  tracker();
  preview();
  await heads();
  await ipc();
  finish('Discord-Status');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
