// Voice-Moderation (ab 1.13.0): Voice-Regeln mit Pflicht-Zustimmung (4012), Voice-Sperren (4013), Meldungen mit Kontext,
// Lautstärke-Verlauf und verschlüsseltem Clip, Liste „Voice aus“, Stummschalten und Entfernen durch Gastgeber,
// Operatoren und Party-Leiter, Rechte im Team-Bereich, Datenauskunft und Aufräumen; dazu der Prüfer für Ogg/Opus.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { WebSocket } from 'ws';
import type { ServiceOptions } from '../src/app';
import type { TeamRole } from '../src/db';
import { buildOggOpus, OggError, oggCrc, parseOggOpus } from '../src/ogg';
import { CLIP_MAX_BYTES, DEFAULT_VOICE_RULES } from '../src/voice-moderation';
import { SESSION_COOKIE } from '../src/web';
import { api, befriend, connect, devPlayer, rawUpload, startService, waitFor, type Player, type TestService, type WsClient } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';
import { createWorld, DOMAIN } from './world-helpers';

const SERVER = 'mc.example.net';
const OVERWORLD = 'minecraft:overworld';
const GROUP = createHash('sha256').update('Bande\ngeheim').digest('hex');

type Text = any;

/** WebSocket-Client für /v1/voice: Textnachrichten und Sprach-Rahmen getrennt, dazu der Schließcode. */
class VoiceClient {
  readonly texts: Text[] = [];
  readonly frames: Buffer[] = [];
  private waiters: { match: (m: Text) => boolean; resolve: (m: Text) => void }[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.frames.push(Buffer.from(data as Buffer));
        return;
      }
      const message = JSON.parse(String(data));
      const index = this.waiters.findIndex((w) => w.match(message));
      if (index >= 0) this.waiters.splice(index, 1)[0]!.resolve(message);
      else this.texts.push(message);
    });
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })));
  }

  next(match: string | ((m: Text) => boolean), timeoutMs = 3000): Promise<Text> {
    const fn = typeof match === 'string' ? (m: Text) => m.type === match : match;
    const index = this.texts.findIndex(fn);
    if (index >= 0) return Promise.resolve(this.texts.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        match: fn,
        resolve: (m: Text) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Keine passende Nachricht erhalten. Gepuffert: ${JSON.stringify(this.texts)}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  async join(server: string, group: string | null = null, dimension = OVERWORLD): Promise<{ room: Text; peers: Text }> {
    // Ältere Listen und Raum-Nachrichten verwerfen: geliefert werden die Antworten auf dieses join
    await this.sync();
    this.texts.splice(0, this.texts.length, ...this.texts.filter((m) => m.type !== 'peers' && m.type !== 'room'));
    this.send({ type: 'join', server, dimension, group });
    const peers = await this.next('peers');
    const room = await this.next('room');
    return { room, peers };
  }

  pos(x: number, y = 64, z = 0): void {
    this.send({ type: 'pos', x, y, z });
  }

  speak(seq: number): void {
    const out = Buffer.alloc(7);
    out[0] = 1;
    out.writeUInt16BE(seq, 2);
    out.set([1, 2, 3], 4);
    this.ws.send(out);
  }

  async sync(): Promise<void> {
    this.send({ type: 'ping' });
    await this.next('pong');
  }

  /** Letzte `peers`-Nachricht im Puffer (ältere fallen weg) oder die nächste. */
  async latestPeers(): Promise<Text> {
    await this.sync();
    const all = this.texts.filter((m) => m.type === 'peers');
    if (all.length === 0) return this.next('peers');
    this.texts.splice(0, this.texts.length, ...this.texts.filter((m) => m.type !== 'peers'));
    return all[all.length - 1];
  }

  takeFrames(): Buffer[] {
    return this.frames.splice(0, this.frames.length);
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close();
    await this.closed;
  }
}

/** Uhr des Voice Chats (Entfernen läuft 10 Minuten): mit der echten Zeit, lässt sich vorstellen. */
class VoiceClock {
  private offset = 0;
  readonly read = () => Date.now() + this.offset;
  advance(ms: number): void {
    this.offset += ms;
  }
}

type TeamCall = ((method: string, path: string, body?: unknown) => ReturnType<typeof api>) & { cookie: string };

interface Setup {
  service: TestService;
  clock: Clock;
  voiceClock: VoiceClock;
  player(name: string): Promise<Player>;
  /** Spiel mit Bearer-Token; wartet auf `ready` (oder bei `refused` auf das Schließen) */
  game(player: Player): Promise<{ client: VoiceClient; ready: Text }>;
  /** Verbindet und erwartet die Ablehnung (rules/banned und Schließcode) */
  refused(player: Player): Promise<{ message: Text; close: { code: number; reason: string } }>;
  guestClient(token: string): Promise<VoiceClient>;
  /** Team-Mitglied mit 2FA; die Funktion ruft Routen mit seinem Cookie auf, `cookie` für eigene Anfragen */
  team(player: Player, role: TeamRole): Promise<TeamCall>;
  sql(statement: string, ...params: (string | number | null)[]): void;
}

async function opened(client: VoiceClient): Promise<VoiceClient> {
  await new Promise<void>((resolve, reject) => {
    client.ws.once('open', () => resolve());
    client.ws.once('error', reject);
    client.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return client;
}

async function withModeration(options: Partial<ServiceOptions>, run: (setup: Setup) => Promise<void>): Promise<void> {
  const clock = new Clock();
  const voiceClock = new VoiceClock();
  const service = await startService({
    dev: true,
    website: WEBSITE,
    weltDomain: DOMAIN,
    totpNow: clock.read,
    voiceNow: voiceClock.read,
    guestRateLimit: 1000,
    ...options,
  });
  const voiceUrl = `${service.url.replace('http', 'ws')}/v1/voice`;
  const clients: VoiceClient[] = [];
  const track = (client: VoiceClient) => {
    clients.push(client);
    return client;
  };
  try {
    await run({
      service,
      clock,
      voiceClock,
      player: (name) => devPlayer(service.url, name),
      async game(player) {
        const client = await opened(track(new VoiceClient(new WebSocket(voiceUrl, { headers: { Authorization: `Bearer ${player.token}` } }))));
        return { client, ready: await client.next('ready') };
      },
      async refused(player) {
        const client = await opened(track(new VoiceClient(new WebSocket(voiceUrl, { headers: { Authorization: `Bearer ${player.token}` } }))));
        const message = await client.next((m) => m.type === 'rules' || m.type === 'banned' || m.type === 'ready');
        return { message, close: await client.closed };
      },
      guestClient: async (token) => opened(track(new VoiceClient(new WebSocket(voiceUrl, ['heldix-voice', `gast.${token}`], { origin: WEBSITE })))),
      async team(player, role) {
        const { cookie } = await teamLogin(service, player, role, clock);
        return Object.assign((method: string, p: string, body?: unknown) => webApi(service, method, p, { cookie, body }), { cookie });
      },
      sql(statement, ...params) {
        const db = new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));
        try {
          db.exec('PRAGMA busy_timeout = 5000');
          db.prepare(statement).run(...params);
        } finally {
          db.close();
        }
      },
    });
  } finally {
    for (const client of clients) await client.close();
    await service.close();
  }
}

/** Ogg/Opus wie vom Client: `count` Pakete des Sprechers. */
function clip(speaker: string, count = 10, extra: Record<string, string> = {}): Buffer {
  const packets = Array.from({ length: count }, (_, i) => Buffer.from([0xfc, i & 0xff, 0x11, 0x22]));
  return buildOggOpus(packets, { HELDIX_SPEAKER: speaker, HELDIX_START: String(Date.now() - 60_000), HELDIX_SEGMENTS: `0@${Date.now() - 60_000},120@${Date.now() - 30_000}`, ...extra });
}

async function uploadClip(service: TestService, player: Player, id: number, data: Buffer, type = 'audio/ogg') {
  const res = await rawUpload(service.url, 'PUT', `/v1/voice/reports/${id}/clip`, data, { Authorization: `Bearer ${player.token}`, 'Content-Type': type });
  return { status: res.status, body: res.body };
}

describe('Voice-Moderation: Ogg/Opus prüfen', () => {
  test('gültig: Dauer, Pakete, Kommentare; kaputte Prüfsumme, ohne OpusHead, zu lang und Müll werden abgelehnt', () => {
    const file = clip('a'.repeat(32), 120);
    const info = parseOggOpus(file, 600_000);
    assert.equal(info.packets, 120);
    assert.equal(info.durationMs, 2400);
    assert.equal(info.channels, 1);
    assert.equal(info.vendor, 'HeldixClient');
    assert.equal(info.tags.HELDIX_SPEAKER, 'a'.repeat(32));
    // CRC-32 von Ogg (Prüfwert aus der Spezifikation: "OggS" + Nullen ist nicht 0)
    assert.notEqual(oggCrc(Buffer.from('OggS')), 0);
    const broken = Buffer.from(file);
    broken[broken.length - 1] ^= 0xff;
    assert.throws(() => parseOggOpus(broken, 600_000), (err: unknown) => err instanceof OggError && /Prüfsumme/.test((err as Error).message));
    assert.throws(() => parseOggOpus(file, 1000), /zu lang/);
    assert.throws(() => parseOggOpus(Buffer.from('kein ogg, nur text, lang genug für eine seite'), 600_000), /Keine Ogg-Datei/);
    assert.throws(() => parseOggOpus(file.subarray(0, file.length - 3), 600_000), /endet mitten/);
  });
});

describe('Voice-Moderation: Voice-Regeln und Zustimmung', () => {
  test('Standardtext, veröffentlichen nur Admin, Pflicht-Zustimmung (4012), Annehmen, Aufnahmen-Schalter, Widerruf, Gäste, neue Version, zurückziehen', async () => {
    await withModeration({}, async ({ service, player, game, refused, guestClient, team }) => {
      let res = await api(service.url, 'GET', '/v1/public/voice/rules');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual(
        { published: res.body.published, version: res.body.version, clips: res.body.clips, text: res.body.text },
        { published: false, version: null, clips: false, text: DEFAULT_VOICE_RULES },
      );
      assert.deepEqual(res.body.limits, { clipMs: 600_000, clipBytes: CLIP_MAX_BYTES, deleteAfterDoneDays: 30, deleteAfterDays: 90, kickMinutes: 10 });

      const anna = await player('Anna');
      const ben = await player('Ben');
      const first = await game(anna);
      assert.deepEqual([first.ready.rules, first.ready.clips], [null, null]);
      assert.ok(first.ready.features.includes('moderation'));
      assert.equal((await api(service.url, 'GET', '/v1/voice/me', { token: anna.token })).body.rules.required, false);

      // Ben lädt in seine Voice-Gruppe ein (Gast-Link), ein Gast ist schon da
      const invite = await api(service.url, 'POST', '/v1/invites', { token: ben.token, body: { server: SERVER, voice: { group: GROUP } } });
      const code = invite.body.code as string;
      const early = await api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name: 'Max' }, headers: { Origin: WEBSITE } });
      assert.equal(early.status, 200, 'ohne Regeln braucht der Gast keine Zustimmung');
      const earlyGuest = await guestClient(early.body.token);
      assert.deepEqual((await earlyGuest.next('ready')).rules, null);

      const supporter = await team(await player('Sina'), 'supporter');
      const admin = await team(await player('Chefin'), 'admin');
      assert.equal((await supporter('POST', '/v1/team/voice/rules', { text: 'Hallo' })).status, 403);
      assert.equal((await supporter('GET', '/v1/team/voice')).status, 200, 'ansehen mit voice:moderate');
      res = await admin('POST', '/v1/team/voice/rules', { text: '' });
      assert.equal(res.status, 400);
      res = await admin('POST', '/v1/team/voice/rules', {});
      assert.deepEqual([res.status, res.body], [200, { version: 1 }]);

      // Alle Verbindungen ohne Zustimmung schließen mit `rules` und 4012 (auch der alte Gast, seine Sitzung gilt nicht mehr)
      assert.deepEqual(await first.client.next('rules'), { type: 'rules', status: 'required', version: 1 });
      assert.deepEqual(await first.client.closed, { code: 4012, reason: 'Voice-Regeln' });
      assert.equal((await earlyGuest.closed).code, 4012);
      assert.equal((await api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name: 'Max' }, headers: { Origin: WEBSITE } })).body.code, 'voice-rules');

      const again = await refused(anna);
      assert.deepEqual([again.message, again.close.code], [{ type: 'rules', status: 'required', version: 1 }, 4012]);
      res = await api(service.url, 'GET', '/v1/voice/me', { token: anna.token });
      assert.deepEqual(res.body.rules, { version: 1, accepted: null, acceptedAt: null, required: true });
      assert.equal(res.body.clips, true);

      res = await api(service.url, 'POST', '/v1/voice/rules/accept', { token: anna.token, body: { version: 2 } });
      assert.deepEqual([res.status, res.body.code, res.body.version], [409, 'voice-rules-version', 1]);
      res = await api(service.url, 'POST', '/v1/voice/rules/accept', { token: anna.token, body: { version: 1 } });
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.rules.accepted, res.body.rules.required], [1, false]);
      const accepted = await game(anna);
      assert.deepEqual([accepted.ready.rules, accepted.ready.clips], [{ version: 1 }, { maxMs: 600_000, maxBytes: CLIP_MAX_BYTES }]);

      // Aufnahmen-Schalter (nur Admin): alle bekommen `clips`
      assert.equal((await supporter('PUT', '/v1/team/voice/settings', { clips: false })).status, 403);
      res = await admin('PUT', '/v1/team/voice/settings', { clips: false });
      assert.deepEqual(res.body.clips, { active: false, enabled: false, allowed: true, rulesPublished: true });
      assert.deepEqual(await accepted.client.next('clips'), { type: 'clips', clips: null });
      assert.equal((await api(service.url, 'GET', '/v1/public/voice/rules')).body.clips, false);
      await admin('PUT', '/v1/team/voice/settings', { clips: true });
      assert.deepEqual(await accepted.client.next('clips'), { type: 'clips', clips: { maxMs: 600_000, maxBytes: CLIP_MAX_BYTES } });

      // Gast: mit der richtigen Version
      res = await api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name: 'Max', rulesVersion: 1 }, headers: { Origin: WEBSITE } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const guest = await guestClient(res.body.token);
      assert.deepEqual((await guest.next('ready')).rules, { version: 1 });
      const guestToken = res.body.token as string;

      // Widerruf: Verbindung geht zu (4012), danach wieder Pflicht
      res = await api(service.url, 'DELETE', '/v1/voice/rules/accept', { token: anna.token });
      assert.deepEqual([res.body.rules.accepted, res.body.rules.required], [null, true]);
      assert.equal((await accepted.client.closed).code, 4012);

      // Neue Version: der Gast fliegt raus, seine Sitzung gilt nicht mehr
      res = await admin('POST', '/v1/team/voice/rules', { text: '# Neue Regeln\n- Sei nett.' });
      assert.deepEqual(res.body, { version: 2 });
      assert.equal((await guest.closed).code, 4012);
      const stale = new WebSocket(`${service.url.replace('http', 'ws')}/v1/voice`, ['heldix-voice', `gast.${guestToken}`], { origin: WEBSITE });
      const status = await new Promise<number>((resolve) => stale.once('unexpected-response', (_req, r) => resolve(r.statusCode ?? 0)));
      assert.equal(status, 401);
      assert.equal((await api(service.url, 'GET', '/v1/public/voice/rules')).body.text, '# Neue Regeln\n- Sei nett.');
      res = await admin('GET', '/v1/team/voice/rules/versions');
      assert.deepEqual(res.body.versions.map((v: { version: number }) => v.version), [2, 1]);

      // Zurückziehen: keine Pflicht mehr, keine Aufnahmen
      assert.equal((await supporter('DELETE', '/v1/team/voice/rules')).status, 403);
      res = await admin('DELETE', '/v1/team/voice/rules');
      assert.equal(res.status, 200);
      res = await api(service.url, 'GET', '/v1/public/voice/rules');
      assert.deepEqual([res.body.published, res.body.clips, res.body.text], [false, false, DEFAULT_VOICE_RULES]);
      const free = await game(anna);
      assert.deepEqual([free.ready.rules, free.ready.clips], [null, null]);
      const audit = (await admin('GET', '/v1/team/audit?limit=50')).body.entries.map((e: { action: string }) => e.action);
      for (const action of ['voice.rules.publish', 'voice.clips', 'voice.rules.withdraw']) assert.ok(audit.includes(action), action);
    });
  });

  test('HELDIX_DIENST_VOICE_CLIPS=0: Regeln gelten, Aufnahmen bleiben aus', async () => {
    await withModeration({ voiceClips: false }, async ({ service, player, team }) => {
      const admin = await team(await player('Chefin'), 'admin');
      await admin('POST', '/v1/team/voice/rules', {});
      const anna = await player('Anna');
      await api(service.url, 'POST', '/v1/voice/rules/accept', { token: anna.token, body: { version: 1 } });
      const ben = await player('Ben');
      const res = await api(service.url, 'POST', '/v1/voice/reports', { token: anna.token, body: { uuid: ben.uuid, reason: 'noise' } });
      assert.deepEqual([res.status, res.body.clip], [200, null]);
      assert.deepEqual((await uploadClip(service, anna, res.body.id, clip(ben.uuid))).body.code, 'clip-off');
      assert.deepEqual((await admin('GET', '/v1/team/voice')).body.clips, { active: false, enabled: true, allowed: false, rulesPublished: true });
    });
  });
});

describe('Voice-Moderation: Voice-Sperren', () => {
  test('sperren (sofort 4013 mit Grund), neue Verbindung abgelehnt, Gast-Links ungültig, Rechte, Verlauf, aufheben, Datenauskunft', async () => {
    await withModeration({}, async ({ service, player, game, refused, guestClient, team }) => {
      const ben = await player('Ben');
      const invite = await api(service.url, 'POST', '/v1/invites', { token: ben.token, body: { server: SERVER, voice: { group: GROUP } } });
      const code = invite.body.code as string;
      const guestRes = await api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name: 'Max' }, headers: { Origin: WEBSITE } });
      const guest = await guestClient(guestRes.body.token);
      await guest.next('ready');
      guest.send({ type: 'join', invite: code });
      await guest.next('peers');
      const live = await game(ben);

      const designer = await team(await player('Dina'), 'designer');
      const moderator = await team(await player('Mo'), 'moderator');
      assert.equal((await designer('PUT', `/v1/team/voice/bans/${ben.uuid}`, { duration: '1h', reason: 'x' })).status, 403);
      assert.equal((await moderator('PUT', `/v1/team/voice/bans/${ben.uuid}`, { duration: '2h', reason: 'x' })).status, 400);
      assert.equal((await moderator('PUT', `/v1/team/voice/bans/${ben.uuid}`, { duration: '1h' })).status, 400, 'Grund ist Pflicht');
      const teamMate = await player('Tina');
      await team(teamMate, 'tester');
      assert.equal((await moderator('PUT', `/v1/team/voice/bans/${teamMate.uuid}`, { duration: '1h', reason: 'x' })).status, 409);

      const before = Date.now();
      let res = await moderator('PUT', `/v1/team/voice/bans/${ben.uuid}`, { duration: '1h', reason: 'Beleidigungen' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.ban.reason, 'Beleidigungen');
      assert.ok(res.body.ban.until >= before + 3_600_000 && res.body.ban.until <= Date.now() + 3_600_000);
      const banned = await live.client.next('banned');
      assert.equal(banned.reason, 'Beleidigungen');
      assert.match(banned.message, /^Du bist bis \d\d\.\d\d\.\d{4}, \d\d:\d\d Uhr vom Voice Chat gesperrt\. Grund: Beleidigungen$/);
      assert.match(banned.appeal, /Support-Anfrage/);
      assert.deepEqual(await live.client.closed, { code: 4013, reason: 'Voice-Sperre' });
      // Gast-Links des Gesperrten: Gäste fliegen raus, neue gibt es nicht, die Einladung zeigt keinen Voice Chat
      assert.equal((await guest.closed).code, 4004);
      assert.equal((await api(service.url, 'GET', `/v1/public/invites/${code}`)).body.voice, null);
      assert.equal((await api(service.url, 'POST', `/v1/public/invites/${code}/guest`, { body: { name: 'Eva' }, headers: { Origin: WEBSITE } })).status, 404);

      const again = await refused(ben);
      assert.deepEqual([again.message.type, again.close.code], ['banned', 4013]);
      res = await api(service.url, 'GET', '/v1/voice/me', { token: ben.token });
      assert.equal(res.body.ban.reason, 'Beleidigungen');
      assert.match(res.body.ban.message, /gesperrt\. Grund: Beleidigungen/);

      // Team: Liste, Spieler mit Zeitleiste und Protokoll (Supporter darf das auch)
      const supporter = await team(await player('Sina'), 'supporter');
      res = await supporter('GET', '/v1/team/voice/bans');
      assert.deepEqual(res.body.bans.map((b: { uuid: string }) => b.uuid), [ben.uuid]);
      res = await supporter('GET', `/v1/team/voice/players/${ben.uuid}`);
      assert.equal(res.body.ban.by, 'Mo');
      assert.deepEqual(res.body.timeline.map((e: { kind: string }) => e.kind), ['ban']);
      assert.ok(res.body.audit.some((e: { action: string }) => e.action === 'voice.ban'));

      // Ersetzen (dauerhaft), dann aufheben
      res = await supporter('PUT', `/v1/team/voice/bans/${ben.uuid}`, { duration: 'permanent', reason: 'Wiederholt' });
      assert.equal(res.body.ban.until, null);
      assert.equal(res.body.bans.length, 2);
      res = await api(service.url, 'GET', '/v1/voice/me', { token: ben.token });
      assert.equal(res.body.ban.message, 'Du bist dauerhaft vom Voice Chat gesperrt. Grund: Wiederholt');
      res = await supporter('DELETE', `/v1/team/voice/bans/${ben.uuid}`);
      assert.equal(res.body.ban, null);
      assert.equal((await supporter('DELETE', `/v1/team/voice/bans/${ben.uuid}`)).status, 404);
      const back = await game(ben);
      assert.equal(back.ready.type, 'ready');
      assert.ok((await api(service.url, 'GET', `/v1/public/invites/${code}`)).body.voice !== null, 'der Link lädt wieder in den Voice Chat ein');

      // Datenauskunft: eigene Sperren mit Grund, ohne das Team-Mitglied
      const exported = JSON.parse((await fetch(`${service.url}/v1/me/export`, { headers: { Authorization: `Bearer ${ben.token}` } }).then((r) => r.text())));
      assert.equal(exported.voice.bans.length, 2);
      assert.deepEqual(Object.keys(exported.voice.bans[0]).sort(), ['at', 'liftedAt', 'reason', 'until']);
      assert.equal(JSON.stringify(exported.voice).includes('Mo'), false);
    });
  });
});

describe('Voice-Moderation: Meldungen', () => {
  test('Meldung mit Kontext und Lautstärke-Verlauf, Clip (verschlüsselt, nur Team), Grenzen, Ergebnis und Verlässlichkeit, Gast-Meldung, Datenauskunft', async () => {
    await withModeration({ voiceReportHourly: 3 }, async ({ service, player, game, guestClient, team }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const cara = await player('Cara');
      // Ohne veröffentlichte Regeln: Meldung ja, Clip nein
      let res = await api(service.url, 'POST', '/v1/voice/reports', { token: anna.token, body: { uuid: cara.uuid, reason: 'other' } });
      assert.deepEqual([res.status, res.body.reported, res.body.clip], [200, true, null]);

      const admin = await team(await player('Chefin'), 'admin');
      await admin('POST', '/v1/team/voice/rules', {});
      for (const p of [anna, ben]) await api(service.url, 'POST', '/v1/voice/rules/accept', { token: p.token, body: { version: 1 } });
      const a = (await game(anna)).client;
      const b = (await game(ben)).client;
      await a.join(SERVER);
      await b.join(SERVER);
      a.pos(0);
      b.pos(3);
      await a.sync();
      await b.sync();

      // Ungültiges
      for (const [body, status] of [
        [{ uuid: ben.uuid, reason: 'spam' }, 400],
        [{ uuid: anna.uuid, reason: 'insult' }, 400],
        [{ uuid: 'f'.repeat(32), reason: 'insult' }, 404],
        [{ uuid: ben.uuid, reason: 'insult', note: 'zwei\nZeilen' }, 400],
        [{ uuid: ben.uuid, reason: 'insult', levels: { rms: Array(601).fill(-20) } }, 400],
      ] as const) {
        assert.equal((await api(service.url, 'POST', '/v1/voice/reports', { token: anna.token, body })).status, status, JSON.stringify(body));
      }

      const levels = { end: Date.now(), rms: [-42.4, -38, null, -6], peak: [-20, -12, null, -1.2] };
      res = await api(service.url, 'POST', '/v1/voice/reports', {
        token: anna.token,
        body: {
          uuid: ben.uuid,
          reason: 'insult',
          note: 'hat mich beschimpft',
          context: { server: SERVER, dimension: OVERWORLD, at: Date.now(), group: false, nearby: [{ uuid: ben.uuid, name: 'Ben' }, { uuid: 'kaputt' }] },
          levels,
        },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const id = res.body.id as number;
      assert.equal(res.body.clip.upload, `/v1/voice/reports/${id}/clip`);
      assert.deepEqual([res.body.clip.maxBytes, res.body.clip.maxMs], [CLIP_MAX_BYTES, 600_000]);
      // einmal je Spieler in 24 Stunden, höchstens 3 je Stunde (Test)
      assert.equal((await api(service.url, 'POST', '/v1/voice/reports', { token: anna.token, body: { uuid: ben.uuid, reason: 'noise' } })).status, 429);

      // Clip: nur der Meldende, nur audio/ogg, nur vom Gemeldeten, nur einmal
      const audio = clip(ben.uuid, 100);
      assert.equal((await uploadClip(service, ben, id, audio)).status, 404);
      assert.equal((await uploadClip(service, anna, id, audio, 'application/octet-stream')).status, 415);
      assert.equal((await uploadClip(service, anna, id, Buffer.from('OggS nicht wirklich'))).body.code, 'clip-format');
      assert.equal((await uploadClip(service, anna, id, clip(cara.uuid))).body.code, 'clip-format');
      assert.equal((await uploadClip(service, anna, id, Buffer.alloc(CLIP_MAX_BYTES + 1))).status, 413);
      assert.deepEqual(await uploadClip(service, anna, id, audio), { status: 200, body: { clip: { size: audio.length, durationMs: 2000 } } });
      assert.equal((await uploadClip(service, anna, id, audio)).body.code, 'clip-exists');

      // Auf der Platte verschlüsselt, Schlüssel im Datenordner
      const clipDir = path.join(service.dataDir, 'voice-clips');
      const files = fs.readdirSync(clipDir);
      assert.equal(files.length, 1);
      const stored = fs.readFileSync(path.join(clipDir, files[0]!));
      assert.equal(stored.subarray(0, 4).toString('latin1'), 'HXC1');
      assert.equal(stored.includes(Buffer.from('OggS')), false);
      assert.equal(stored.includes(Buffer.from(ben.uuid)), false);
      assert.match(fs.readFileSync(path.join(service.dataDir, 'voice-clips.key'), 'utf8').trim(), /^[0-9a-f]{64}$/);
      for (const line of service.logs) assert.equal(line.includes(fs.readFileSync(path.join(service.dataDir, 'voice-clips.key'), 'utf8').trim()), false, 'Schlüssel im Log');

      // Team: nur mit voice:moderate; Kontext vom Client und vom Dienst, Lautstärke-Verlauf, gebündelt je Spieler
      const designer = await team(await player('Dina'), 'designer');
      const supporter = await team(await player('Sina'), 'supporter');
      assert.equal((await designer('GET', '/v1/team/voice/reports')).status, 403);
      assert.equal((await designer('GET', `/v1/team/voice/clips/${id}`)).status, 403);
      res = await supporter('GET', '/v1/team/voice/reports');
      assert.equal(res.status, 200);
      const view = res.body.reports.find((r: { id: number }) => r.id === id);
      assert.equal(view.kind, 'voice');
      assert.equal(view.reasonLabel, 'Beleidigung');
      assert.deepEqual(view.context.client, { server: SERVER, dimension: OVERWORLD, at: view.context.client.at, group: false, nearby: [{ uuid: ben.uuid, name: 'Ben' }] });
      assert.equal(view.context.service.server, SERVER);
      assert.equal(view.context.service.dimension, OVERWORLD);
      assert.equal(view.context.service.reportedPresent, true);
      assert.deepEqual(view.context.service.nearby, [{ uuid: ben.uuid, name: 'Ben', guest: false }]);
      assert.deepEqual([view.levels.rms, view.levels.peak], [[-42, -38, null, -6], [-20, -12, null, -1]]);
      assert.equal(view.clip.durationMs, 2000);
      assert.equal(view.clip.segments.length, 2);
      assert.equal(view.clip.url, `/v1/team/voice/clips/${id}`);
      const bundle = res.body.players.find((p: { reported: { uuid: string } }) => p.reported.uuid === ben.uuid);
      assert.deepEqual([bundle.reports, bundle.open, bundle.reporters, bundle.reasons], [1, 1, 1, { insult: 1 }]);
      // In der allgemeinen Liste (moderation) mit Art „voice“
      assert.equal((await admin('GET', '/v1/team/reports')).body.reports.find((r: { id: number }) => r.id === id).kind, 'voice');

      // Abspielen: genau die hochgeladene Datei, nicht zwischengespeichert, steht im Protokoll
      const played = await fetch(`${service.url}/v1/team/voice/clips/${id}`, { headers: { Cookie: `${SESSION_COOKIE}=${(await webLogin(service, await player('Gast'))).cookie}` } });
      assert.equal(played.status, 403, 'ohne Team keine Aufnahme');
      res = await supporter('GET', '/v1/team/voice');
      assert.equal(res.body.stats.openReports, 2);

      // Ergebnis: berechtigt → Verlässlichkeit der Meldenden
      assert.equal((await supporter('POST', `/v1/team/voice/reports/${id}/done`, { outcome: 'vielleicht' })).status, 400);
      res = await supporter('POST', `/v1/team/voice/reports/${id}/done`, { outcome: 'justified' });
      assert.deepEqual([res.body.report.status, res.body.report.outcome, res.body.report.doneBy], ['done', 'justified', 'Sina']);
      assert.deepEqual(res.body.report.reporter.reliability, { justified: 1, unjustified: 0, unclear: 0, share: 1 });
      assert.equal(res.body.report.clip.deleteAt, Math.min(res.body.report.clip.createdAt + 90 * 86_400_000, res.body.report.doneAt + 30 * 86_400_000));

      // Gast meldet Anna (ohne Clip); falsches Token 401
      const invite = await api(service.url, 'POST', '/v1/invites', { token: ben.token, body: { server: SERVER, voice: { group: GROUP } } });
      const guestRes = await api(service.url, 'POST', `/v1/public/invites/${invite.body.code}/guest`, { body: { name: 'Max', rulesVersion: 1 }, headers: { Origin: WEBSITE } });
      const guest = await guestClient(guestRes.body.token);
      await guest.next('ready');
      res = await api(service.url, 'POST', '/v1/public/voice/guest-reports', { body: { token: 'x'.repeat(43), uuid: anna.uuid, reason: 'noise' }, headers: { Origin: WEBSITE } });
      assert.equal(res.status, 401);
      res = await api(service.url, 'POST', '/v1/public/voice/guest-reports', { body: { token: guestRes.body.token, uuid: anna.uuid, reason: 'noise' }, headers: { Origin: 'https://fremd.example' } });
      assert.equal(res.status, 403);
      res = await api(service.url, 'POST', '/v1/public/voice/guest-reports', { body: { token: guestRes.body.token, uuid: anna.uuid, reason: 'noise', note: 'zu laut' }, headers: { Origin: WEBSITE } });
      assert.deepEqual([res.status, Object.keys(res.body).sort()], [200, ['id', 'reported']]);
      // Gäste lassen sich nicht melden
      res = await api(service.url, 'POST', '/v1/voice/reports', { token: anna.token, body: { uuid: guestRes.body.id, reason: 'noise' } });
      assert.deepEqual([res.status, res.body.code], [400, 'voice-guest']);
      const guestView = (await supporter('GET', '/v1/team/voice/reports')).body.reports.find((r: { reporter: { guest: boolean } }) => r.reporter.guest);
      assert.deepEqual([guestView.reporter.name, guestView.reporter.reliability, guestView.clip], ['Max (Gast)', null, null]);

      // Datenauskunft: eigene Meldung mit Kontext und Clip-Angaben (ohne Ton); der Gemeldete sieht sie nicht
      const exportOf = async (p: Player) => JSON.parse(await fetch(`${service.url}/v1/me/export`, { headers: { Authorization: `Bearer ${p.token}` } }).then((r) => r.text()));
      const annaExport = await exportOf(anna);
      const own = annaExport.voice.reports.find((r: { id: number }) => r.id === id);
      assert.deepEqual(own.clip, { size: audio.length, durationMs: 2000 });
      assert.deepEqual(annaExport.voice.consent.version, 1);
      const benExport = await exportOf(ben);
      assert.equal(JSON.stringify(benExport).includes('hat mich beschimpft'), false, 'Meldungen über Ben stehen nicht in seiner Auskunft');
    });
  });

  test('Abspielen und Löschen der Aufnahme; Aufräumen 30 Tage nach Abschluss, 90 Tage nach dem Hochladen und verwaister Dateien', async () => {
    await withModeration({ sweepIntervalMs: 40 }, async ({ service, player, game, team, sql }) => {
      const admin = await team(await player('Chefin'), 'admin');
      await admin('POST', '/v1/team/voice/rules', {});
      const anna = await player('Anna');
      await api(service.url, 'POST', '/v1/voice/rules/accept', { token: anna.token, body: { version: 1 } });
      await game(anna);
      const ids: number[] = [];
      for (const name of ['Ben', 'Cara', 'Dora']) {
        const target = await player(name);
        const res = await api(service.url, 'POST', '/v1/voice/reports', { token: anna.token, body: { uuid: target.uuid, reason: 'noise' } });
        assert.equal((await uploadClip(service, anna, res.body.id, clip(target.uuid, 20))).status, 200);
        ids.push(res.body.id);
      }
      const clipDir = path.join(service.dataDir, 'voice-clips');
      assert.equal(fs.readdirSync(clipDir).length, 3);

      // 1: Meldung vor über 30 Tagen erledigt → weg; 2: vor über 90 Tagen hochgeladen → weg; 3: Meldung gelöscht → Datei weg
      await admin('POST', `/v1/team/voice/reports/${ids[0]}/done`, { outcome: 'unjustified' });
      sql('UPDATE reports SET done_at = ? WHERE id = ?', Date.now() - 31 * 86_400_000, ids[0]!);
      sql('UPDATE voice_clips SET created_at = ? WHERE report = ?', Date.now() - 91 * 86_400_000, ids[1]!);
      sql('DELETE FROM reports WHERE id = ?', ids[2]!);
      await waitFor(() => fs.readdirSync(clipDir).length === 0, 5000);
      for (const id of ids.slice(0, 2)) assert.equal((await admin('GET', `/v1/team/voice/reports/${id}`)).body.report.clip, null);
    });
  });

  test('Abspielen: entschlüsselte Datei mit audio/ogg; Löschen durch das Team', async () => {
    await withModeration({}, async ({ service, player, game, team }) => {
      const admin = await team(await player('Chefin'), 'admin');
      await admin('POST', '/v1/team/voice/rules', {});
      const anna = await player('Anna');
      const ben = await player('Ben');
      await api(service.url, 'POST', '/v1/voice/rules/accept', { token: anna.token, body: { version: 1 } });
      await game(anna);
      const res = await api(service.url, 'POST', '/v1/voice/reports', { token: anna.token, body: { uuid: ben.uuid, reason: 'hate' } });
      const audio = clip(ben.uuid, 30);
      await uploadClip(service, anna, res.body.id, audio);
      const mo = await team(await player('Mo'), 'moderator');
      const { cookie } = mo;
      const played = await fetch(`${service.url}/v1/team/voice/clips/${res.body.id}`, { headers: { Cookie: `${SESSION_COOKIE}=${cookie}` } });
      assert.equal(played.status, 200);
      assert.equal(played.headers.get('content-type'), 'audio/ogg');
      assert.equal(played.headers.get('cache-control'), 'no-store');
      assert.ok(Buffer.from(await played.arrayBuffer()).equals(audio));
      const audit = (await admin('GET', '/v1/team/audit?limit=20')).body.entries;
      assert.ok(audit.some((e: { action: string; actor: { name: string } }) => e.action === 'voice.clip.play' && e.actor.name === 'Mo'));
      assert.equal((await webApi(service, 'DELETE', `/v1/team/voice/clips/${res.body.id}`, { cookie })).status, 200);
      assert.equal((await webApi(service, 'GET', `/v1/team/voice/clips/${res.body.id}`, { cookie })).status, 404);
      assert.equal(fs.readdirSync(path.join(service.dataDir, 'voice-clips')).length, 0);
    });
  });
});

describe('Voice-Moderation: Liste „Voice aus“', () => {
  test('Admin pflegt die Liste, Moderator sieht sie; Server mit Subdomains: kein Raum, keine Gruppe, Hinweis; wieder an nach dem Entfernen', async () => {
    await withModeration({}, async ({ player, game, team }) => {
      const admin = await team(await player('Chefin'), 'admin');
      const moderator = await team(await player('Mo'), 'moderator');
      const anna = await player('Anna');
      const ben = await player('Ben');
      const a = (await game(anna)).client;
      const b = (await game(ben)).client;
      let joined = await a.join(SERVER, GROUP);
      assert.equal(joined.room.voice, 'on');
      await b.join(SERVER, GROUP);

      assert.equal((await moderator('PUT', '/v1/team/voice/servers/example.net', { subdomains: true, reason: 'Wunsch' })).status, 403);
      assert.equal((await admin('PUT', '/v1/team/voice/servers/kein%20server', { reason: 'x' })).status, 400);
      assert.equal((await admin('PUT', '/v1/team/voice/servers/example.net', { subdomains: true })).status, 400, 'Grund ist Pflicht');
      let res = await admin('PUT', '/v1/team/voice/servers/example.net', { subdomains: true, reason: 'Wunsch des Betreibers', contact: 'admin@example.net' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.servers.map((s: { domain: string; subdomains: boolean }) => [s.domain, s.subdomains]), [['example.net', true]]);
      assert.equal((await moderator('GET', '/v1/team/voice/servers')).body.servers[0].contact, 'admin@example.net');

      // Wer dort ist, verliert Raum und Gruppe und bekommt den Hinweis
      const off = await a.next('room');
      assert.deepEqual([off.voice, off.message], ['off', 'Voice ist auf diesem Server aus (auf Wunsch des Server-Betreibers).']);
      joined = await a.join(SERVER, GROUP);
      assert.deepEqual([joined.room.voice, joined.peers.uuids, joined.peers.group], ['off', [], []]);
      joined = await a.join('play.anderer.de', GROUP);
      assert.equal(joined.room.voice, 'on');

      res = await admin('DELETE', '/v1/team/voice/servers/example.net');
      assert.deepEqual(res.body.servers, []);
      joined = await b.join(SERVER, GROUP);
      assert.equal(joined.room.voice, 'on');
      assert.equal((await admin('DELETE', '/v1/team/voice/servers/example.net')).status, 404);
      const audit = (await admin('GET', '/v1/team/audit?limit=20')).body.entries.map((e: { action: string }) => e.action);
      assert.ok(audit.includes('voice.server.add') && audit.includes('voice.server.remove'));
    });
  });
});

describe('Voice-Moderation: Gastgeber, Operatoren und Party-Leiter', () => {
  test('Welt: Rollen in `room`, Operator schaltet für alle stumm, Gastgeber nicht moderierbar, Wiederverbinden bleibt stumm, Welt verlassen hebt auf, Entfernen für 10 Minuten', async () => {
    await withModeration({}, async ({ service, player, game, voiceClock }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const cara = await player('Cara');
      const dora = await player('Dora');
      const world = await createWorld(service, anna, { name: 'Bauwelt' });
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: anna.token, body: { role: 'operator' } });
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Dora`, { token: anna.token, body: { role: 'operator' } });
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Cara`, { token: anna.token, body: {} });
      const address = world.address as string;
      const clients: Record<string, VoiceClient> = {};
      for (const [name, p, x] of [['anna', anna, 0], ['ben', ben, 1], ['cara', cara, 2], ['dora', dora, 3]] as const) {
        clients[name] = (await game(p)).client;
        const { room } = await clients[name]!.join(address);
        assert.deepEqual(room.world, { code: world.code, name: 'Bauwelt', role: name === 'anna' ? 'host' : name === 'cara' ? 'player' : 'operator' });
        assert.equal(room.party, null);
        clients[name]!.pos(x);
      }
      const { anna: a, ben: b, cara: c, dora: d } = clients as Record<'anna' | 'ben' | 'cara' | 'dora', VoiceClient>;
      for (const client of [a, b, c, d]) await client.sync();
      const mod = async (by: VoiceClient, action: string, uuid: string, scope = 'world') => {
        by.send({ type: 'mod', action, uuid, scope });
        return by.next('mod');
      };
      const heard = async (speaker: VoiceClient, listeners: VoiceClient[]) => {
        for (const l of listeners) l.takeFrames();
        speaker.speak(1);
        await speaker.sync();
        const out: boolean[] = [];
        for (const l of listeners) {
          await l.sync();
          out.push(l.takeFrames().length > 0);
        }
        return out;
      };
      assert.deepEqual(await heard(c, [a, b]), [true, true]);

      assert.equal((await mod(c, 'mute', ben.uuid)).status, 'denied', 'Spieler dürfen nicht');
      assert.equal((await mod(b, 'mute', anna.uuid)).status, 'denied', 'Gastgeber nicht');
      assert.equal((await mod(b, 'mute', dora.uuid)).status, 'denied', 'Operator nicht durch Operator');
      assert.equal((await mod(b, 'mute', ben.uuid)).status, 'invalid', 'sich selbst');
      assert.equal((await mod(b, 'mute', 'f'.repeat(32))).status, 'invalid', 'nicht im Voice der Welt');

      let reply = await mod(b, 'mute', cara.uuid);
      assert.deepEqual([reply.status, reply.message], ['ok', 'Cara ist hier jetzt für alle stumm.']);
      const told = await c.next('moderated');
      assert.deepEqual(told, {
        type: 'moderated',
        action: 'muted',
        scope: 'world',
        by: { uuid: ben.uuid, name: 'Ben' },
        world: { code: world.code, name: 'Bauwelt' },
        until: null,
        message: 'Ben hat dich in dieser Welt stummgeschaltet.',
      });
      assert.deepEqual((await a.latestPeers()).silenced, [cara.uuid]);
      assert.deepEqual(await heard(c, [a, b, d]), [false, false, false], 'Caras Stimme geht nicht weiter');
      assert.deepEqual(await heard(a, [c]), [true], 'Cara hört weiter');

      // Neu verbinden hebt nichts auf: wieder `moderated`
      await c.close();
      const c2 = (await game(cara)).client;
      await c2.join(address);
      assert.equal((await c2.next('moderated')).action, 'muted');
      c2.pos(2);
      await c2.sync();
      assert.deepEqual(await heard(c2, [a]), [false]);
      // Welt verlassen (anderer Server) hebt die Stummschaltung auf
      await c2.join(SERVER);
      await c2.join(address);
      c2.pos(2);
      await c2.sync();
      assert.deepEqual((await a.latestPeers()).silenced, []);
      assert.deepEqual(await heard(c2, [a]), [true]);
      assert.equal((await mod(a, 'unmute', cara.uuid)).status, 'invalid', 'ist nicht mehr stumm');

      // Entfernen: Raum weg, 10 Minuten kein Zutritt, Aufheben bringt zurück
      reply = await mod(a, 'kick', cara.uuid);
      assert.equal(reply.status, 'ok');
      const kicked = await c2.next('moderated');
      assert.deepEqual([kicked.action, kicked.message], ['kicked', 'Anna hat dich aus dem Voice dieser Welt entfernt (10 Minuten).']);
      assert.ok(kicked.until > Date.now() + 9 * 60_000);
      const room = await c2.next('room');
      assert.deepEqual([room.voice, room.until], ['kicked', kicked.until]);
      assert.equal((await a.latestPeers()).uuids.includes(cara.uuid), false);
      let again = await c2.join(address);
      assert.deepEqual([again.room.voice, again.peers.uuids], ['kicked', []]);
      assert.equal((await mod(a, 'unkick', cara.uuid)).status, 'ok');
      assert.equal((await c2.next('moderated')).action, 'unkicked');
      assert.equal((await c2.next('room')).voice, 'on');
      assert.ok((await a.latestPeers()).uuids.includes(cara.uuid));

      // Ablauf nach 10 Minuten (Uhr des Voice Chats): beim nächsten ping wieder drin
      await mod(d, 'kick', cara.uuid);
      await c2.next('moderated');
      again = await c2.join(address);
      assert.equal(again.room.voice, 'kicked');
      voiceClock.advance(10 * 60_000 + 1000);
      c2.send({ type: 'ping' });
      await waitFor(() => c2.texts.some((m) => m.type === 'room' && m.voice === 'on'));
    });
  });

  test('Party: Leiter schaltet in der Party-Gruppe stumm und entfernt; Mitglieder dürfen das nicht', async () => {
    await withModeration({}, async ({ service, player, game }) => {
      const kim = await player('Kim');
      const lou = await player('Lou');
      await befriend(service.url, kim, lou);
      const live: WsClient[] = [];
      try {
        for (const p of [kim, lou]) live.push((await connect(service.wsUrl, p.token)).client);
        assert.equal((await api(service.url, 'POST', '/v1/party/invite', { token: kim.token, body: { uuid: lou.uuid } })).status, 200);
        const partyId = (await api(service.url, 'GET', '/v1/party', { token: lou.token })).body.invites[0].party as string;
        assert.equal((await api(service.url, 'POST', `/v1/party/${partyId}/accept`, { token: lou.token })).status, 200);
        for (const ws of live) ws.send({ type: 'status', state: 'multiplayer', server: 'mc.example.de' });
        let voiceGroup: string | null = null;
        await waitFor(async () => {
          voiceGroup = (await api(service.url, 'GET', '/v1/party', { token: kim.token })).body.party?.voice?.group ?? null;
          return voiceGroup !== null;
        });
        const k = (await game(kim)).client;
        const l = (await game(lou)).client;
        // Ohne Positionen: Sprache nur über die Gruppe
        assert.deepEqual((await k.join('mc.example.de', voiceGroup)).room.party, { leader: true });
        assert.deepEqual((await l.join('mc.example.de', voiceGroup)).room.party, { leader: false });
        const speakTo = async (speaker: VoiceClient, listener: VoiceClient) => {
          listener.takeFrames();
          speaker.speak(1);
          await speaker.sync();
          await listener.sync();
          return listener.takeFrames().length > 0;
        };
        assert.equal(await speakTo(l, k), true);
        l.send({ type: 'mod', action: 'mute', uuid: kim.uuid, scope: 'party' });
        assert.equal((await l.next('mod')).status, 'denied');
        k.send({ type: 'mod', action: 'mute', uuid: lou.uuid, scope: 'world' });
        assert.equal((await k.next('mod')).status, 'denied', 'keine Heldix-Welt');
        k.send({ type: 'mod', action: 'mute', uuid: lou.uuid, scope: 'party' });
        assert.equal((await k.next('mod')).status, 'ok');
        assert.equal((await l.next('moderated')).message, 'Kim hat dich in dieser Party stummgeschaltet.');
        assert.deepEqual((await k.latestPeers()).silenced, [lou.uuid]);
        assert.equal(await speakTo(l, k), false);
        assert.equal(await speakTo(k, l), true);
        k.send({ type: 'mod', action: 'unmute', uuid: lou.uuid, scope: 'party' });
        assert.equal((await k.next('mod')).status, 'ok');
        assert.equal(await speakTo(l, k), true);
        // Entfernen: raus aus der Party-Gruppe, beim nächsten join wieder `group: kicked`
        k.send({ type: 'mod', action: 'kick', uuid: lou.uuid, scope: 'party' });
        assert.equal((await k.next('mod')).status, 'ok');
        assert.equal((await l.next('group')).status, 'kicked');
        l.send({ type: 'join', server: 'mc.example.de', dimension: OVERWORLD, group: voiceGroup });
        assert.equal((await l.next('group')).status, 'kicked');
        assert.equal(await speakTo(l, k), false);
      } finally {
        for (const ws of live) await ws.close();
      }
    });
  });
});

describe('Voice-Moderation: Entwicklungs-Routen für den Autotest', () => {
  test('nur im Entwicklungsmodus: Regeln veröffentlichen/zurückziehen, sperren und aufheben', async () => {
    await withModeration({}, async ({ service, player, game, refused }) => {
      const anna = await player('Anna');
      let res = await api(service.url, 'POST', '/v1/dev/voice/rules', { body: { publish: true, clips: true } });
      assert.deepEqual(res.body, { version: 1 });
      assert.equal((await refused(anna)).close.code, 4012);
      res = await api(service.url, 'POST', '/v1/dev/voice/rules', { body: { publish: false } });
      assert.deepEqual(res.body, { version: null });
      const live = await game(anna);
      res = await api(service.url, 'POST', '/v1/dev/voice/ban', { body: { uuid: anna.uuid, minutes: 5, reason: 'Autotest' } });
      assert.equal(res.status, 200);
      assert.equal((await live.client.closed).code, 4013);
      assert.equal((await api(service.url, 'DELETE', `/v1/dev/voice/ban/${anna.uuid}`)).status, 200);
      assert.equal((await game(anna)).ready.type, 'ready');
    });
    const plain = await startService({});
    try {
      assert.equal((await api(plain.url, 'POST', '/v1/dev/voice/rules', { body: { publish: true } })).status, 404);
    } finally {
      await plain.close();
    }
  });
});

