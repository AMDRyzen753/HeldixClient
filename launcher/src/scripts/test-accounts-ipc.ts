// Tests für den Konto-Wechsel im Spiel (core/accountipc.ts, core/sessions.ts, startGame in core/launch.ts):
// Marker-Zeilen aus der Ausgabe schneiden, Anfragen streng prüfen, Sitzungen erneuern (Microsoft nachgebaut),
// Grenzen für Anfragen, Offline-Konten nur in der Entwicklungsversion – und ein nachgebautes Spiel als echter
// Kindprozess, das das Protokoll über stdin/stdout spricht. Spricht mit niemandem im Netz.
// Gibt nie Tokens aus: Prüfungen zeigen bei Fehlern nur Codes und Längen.
//   npm run test:accounts-ipc

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AccountInfo, LogLine } from '../shared/api';
import { AuthError, type MicrosoftTokens, type MinecraftSession } from '../main/core/auth';
import {
  AccountBridge,
  DEFAULT_LIMITS,
  IPC_MARKER,
  IPC_MAX_LINE,
  IpcLineFilter,
  parseRequest,
  safeMessage,
  type AccountBridgeDeps,
  type BridgeLimits,
} from '../main/core/accountipc';
import { startGame } from '../main/core/launch';
import { OFFLINE_LOCKED, SessionManager, type SessionAccount } from '../main/core/sessions';
import { check, delay, finish } from './testkit';
import type { FakeResult, FakeStep } from './fake-game-ipc';

// ---------- nachgebaute Konten ----------

/** Tokens nur zum Testen; jeder Lauf eigene, damit eine Prüfung „kommt nirgends vor“ etwas taugt */
const fakeToken = (label: string) => `eyJ${label}.${randomBytes(24).toString('base64url')}.${randomBytes(16).toString('base64url')}`;

interface FakeAccount extends SessionAccount {
  accessToken: string;
  refreshToken: string;
  skinUrl?: string;
}

class FakeStore {
  accounts: FakeAccount[] = [];
  activeId: string | null = null;
  saves: MinecraftSession[] = [];

  constructor(private readonly offline: boolean) {}

  private usable(): FakeAccount[] {
    return this.offline ? this.accounts : this.accounts.filter((a) => a.type !== 'offline');
  }

  list(): AccountInfo[] {
    const usable = this.usable();
    const activeId = usable.find((a) => a.id === this.activeId)?.id ?? usable[0]?.id ?? null;
    return usable.map((a) => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid, skinUrl: a.skinUrl, active: a.id === activeId }));
  }

  get(id: string): FakeAccount | null {
    return this.usable().find((a) => a.id === id) ?? null;
  }
}

interface Harness {
  bridge: AccountBridge;
  deps: AccountBridgeDeps;
  store: FakeStore;
  written: string[];
  logs: string[];
  tokens: string[];
  refreshCalls: number;
  clock: { now: number };
  alice: FakeAccount;
  bob: FakeAccount;
  carol: FakeAccount;
  offline: FakeAccount;
  signIn: { impl: () => Promise<AccountInfo> };
  setActiveCalls: string[];
  /** Einstellung „Kontowechsel im Spiel erlauben“ */
  allowed: { value: boolean };
  /** Bestätigungsfenster (Standard: „Wechseln“) */
  confirm: { impl: (account: AccountInfo) => Promise<boolean> };
  /** Namen der Konten, für die gefragt wurde, und was das Fenster bekam */
  confirmCalls: string[];
  confirmArgs: string[];
  /** weiteres gültiges Microsoft-Konto anlegen */
  addValid(name: string): FakeAccount;
}

function harness(options: { dev: boolean; limits?: BridgeLimits }): Harness {
  const clock = { now: 1_800_000_000_000 };
  const store = new FakeStore(options.dev);
  const tokens: string[] = [];
  const token = (label: string) => {
    const value = fakeToken(label);
    tokens.push(value);
    return value;
  };
  const account = (name: string, type: 'microsoft' | 'offline', valid: boolean): FakeAccount => ({
    id: randomUUID(),
    type,
    name,
    uuid: randomBytes(16).toString('hex'),
    xuid: type === 'microsoft' ? '2535400000000001' : undefined,
    accessToken: type === 'microsoft' ? token(`${name}-access`) : '',
    refreshToken: type === 'microsoft' ? token(`${name}-refresh`) : '',
    expiresAt: valid ? clock.now + 20 * 60 * 60 * 1000 : clock.now - 1000,
    skinUrl: type === 'microsoft' ? `https://textures.minecraft.net/texture/${randomBytes(8).toString('hex')}` : undefined,
  });
  // alice: Token gültig; bob: Token abgelaufen (Erneuerung); carol: abgelaufen, Microsoft lehnt die Erneuerung ab
  const alice = account('Alice', 'microsoft', true);
  const bob = account('Bob', 'microsoft', false);
  const carol = account('Carol', 'microsoft', false);
  const offline = account('Offi', 'offline', true);
  store.accounts = [alice, bob, carol, offline];
  store.activeId = alice.id;

  const h = { refreshCalls: 0 } as Harness;
  const sessions = new SessionManager<FakeAccount>({
    secrets: (a) => ({ accessToken: a.accessToken, refreshToken: a.refreshToken }),
    save: async (session) => {
      store.saves.push(session);
      const stored = store.accounts.find((a) => a.uuid === session.uuid);
      if (stored) {
        stored.accessToken = session.accessToken;
        stored.refreshToken = session.refreshToken;
        stored.expiresAt = session.expiresAt;
      }
    },
    clientId: 'test-client-id',
    refreshMicrosoft: async (_clientId, refreshToken): Promise<MicrosoftTokens> => {
      h.refreshCalls++;
      await delay(30);
      const owner = store.accounts.find((a) => a.refreshToken === refreshToken);
      if (!owner || owner === carol) {
        // Fehlermeldung mit etwas, das wie ein Token aussieht: darf weder ins Spiel noch in die Konsole
        throw new AuthError(`Microsoft-Anmeldung fehlgeschlagen: invalid_grant ${refreshToken}`);
      }
      return { accessToken: token('ms-access'), refreshToken: `${owner.id}:${token('ms-refresh')}` };
    },
    loginMinecraft: async (ms): Promise<MinecraftSession> => {
      const owner = store.accounts.find((a) => ms.refreshToken.startsWith(`${a.id}:`))!;
      return { name: owner.name, uuid: owner.uuid, accessToken: token('mc-new'), expiresAt: clock.now + 24 * 60 * 60 * 1000, xuid: owner.xuid, refreshToken: ms.refreshToken };
    },
    offlineAllowed: () => options.dev,
    log: () => undefined,
    now: () => clock.now,
  });

  const written: string[] = [];
  const logs: string[] = [];
  const signIn = { impl: async (): Promise<AccountInfo> => { throw new AuthError('Anmeldung abgebrochen.'); } };
  const setActiveCalls: string[] = [];
  const allowed = { value: true };
  const confirm = { impl: async (_account: AccountInfo) => true };
  const confirmCalls: string[] = [];
  const confirmArgs: string[] = [];
  const addValid = (name: string) => {
    const created = account(name, 'microsoft', true);
    store.accounts.push(created);
    return created;
  };
  const deps: AccountBridgeDeps = {
    allowed: async () => allowed.value,
    confirmSwitch: async (info) => {
      confirmCalls.push(info.name);
      confirmArgs.push(JSON.stringify(info));
      return confirm.impl(info);
    },
    launchedAccountId: alice.id,
    listAccounts: async () => store.list(),
    session: async (id) => {
      const found = store.get(id);
      if (!found) throw new Error('Dieses Konto gibt es im Launcher nicht (mehr).');
      return sessions.sessionFor(found);
    },
    signIn: () => signIn.impl(),
    setActive: async (id) => {
      setActiveCalls.push(id);
      store.activeId = id;
    },
    offlineAllowed: () => options.dev,
    launcherVersion: '0.0.0-test',
    log: (text, level = 'INFO') => logs.push(`${level} ${text}`),
    now: () => clock.now,
  };
  const bridge = new AccountBridge(deps, (line) => {
    written.push(line);
    return true;
  }, options.limits);
  return Object.assign(h, { bridge, deps, store, written, logs, tokens, clock, alice, bob, carol, offline, signIn, setActiveCalls, allowed, confirm, confirmCalls, confirmArgs, addValid });
}

interface Reply {
  v: number;
  id: number | null;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  event?: string;
}

let nextId = 100;

/** Anfrage stellen und auf die Antwort mit derselben ID warten */
async function call(h: Harness, op: string, params?: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<Reply> {
  const id = nextId++;
  const before = h.written.length;
  h.bridge.handle(JSON.stringify({ v: 1, id, op, ...(params ? { params } : {}), ...extra }));
  return waitFor(h, (r) => r.id === id, before);
}

async function waitFor(h: Harness, match: (reply: Reply) => boolean, from = 0, timeoutMs = 2000): Promise<Reply> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const line of h.written.slice(from)) {
      const reply = JSON.parse(line) as Reply;
      if (match(reply)) return reply;
    }
    if (Date.now() > deadline) throw new Error('keine Antwort');
    await delay(5);
  }
}

/** Antwort per Rohzeile (für kaputte Anfragen) */
async function raw(h: Harness, line: string): Promise<Reply | null> {
  const before = h.written.length;
  h.bridge.handle(line);
  await delay(20);
  const reply = h.written.slice(before)[0];
  return reply ? (JSON.parse(reply) as Reply) : null;
}

const code = (reply: Reply | null) => (reply ? (reply.ok ? 'ok' : reply.error?.code ?? '?') : 'keine Antwort');

/** Prüft, dass keins der Tokens im Text vorkommt (zeigt bei Fehlern nur, wie viele) */
function noTokens(label: string, text: string, tokens: string[]): void {
  const leaked = tokens.filter((t) => text.includes(t)).length;
  check(label, leaked === 0, `${leaked} Token(s) gefunden`);
}

// ---------- Marker-Zeilen aus der Ausgabe ----------

function testFilter(): void {
  const collect = () => {
    const messages: string[] = [];
    let oversized = 0;
    const filter = new IpcLineFilter((json) => messages.push(json), () => oversized++);
    return { filter, messages, oversized: () => oversized };
  };

  {
    const { filter, messages } = collect();
    const text = filter.push('Zeile 1\nZeile 2\n') + filter.flush();
    check('Filter: normale Ausgabe bleibt unverändert', text === 'Zeile 1\nZeile 2\n' && messages.length === 0);
  }
  {
    const { filter, messages } = collect();
    const text = filter.push(`vorher\n${IPC_MARKER}{"v":1,"id":1,"op":"hello"}\nnachher\n`) + filter.flush();
    check('Filter: Marker-Zeile ausgeschnitten, Rest bleibt', text === 'vorher\nnachher\n' && messages.length === 1 && messages[0] === '{"v":1,"id":1,"op":"hello"}', text);
  }
  {
    // jede mögliche Blockgrenze
    const input = `a\n${IPC_MARKER}{"id":1}\r\nb${IPC_MARKER}{"id":2}\n\u0001kein Marker\n${IPC_MARKER}{"id":3}\n`;
    let allGood = true;
    for (let cut = 0; cut <= input.length; cut++) {
      for (const second of [cut, Math.min(input.length, cut + 7)]) {
        const { filter, messages } = collect();
        const text = filter.push(input.slice(0, cut)) + filter.push(input.slice(cut, second)) + filter.push(input.slice(second)) + filter.flush();
        if (text !== 'a\nb\u0001kein Marker\n' || messages.join('|') !== '{"id":1}|{"id":2}|{"id":3}') allGood = false;
      }
    }
    check('Filter: Marker über jede Blockgrenze verteilt', allGood);
  }
  {
    const { filter, messages } = collect();
    const event = '<log4j:Event level="INFO"><log4j:Message><![CDATA[Hallo Welt]]></log4j:Message></log4j:Event>\n';
    const text = filter.push(event.slice(0, 40)) + filter.push(`${IPC_MARKER}{"id":9}\n`) + filter.push(event.slice(40)) + filter.flush();
    check('Filter: Marker mitten im Log-Ereignis – Ereignis bleibt ganz', text === event && messages.length === 1);
  }
  {
    const { filter, messages, oversized } = collect();
    const text = filter.push(`x\n${IPC_MARKER}${'a'.repeat(IPC_MAX_LINE + 1)}\ny\n`) + filter.flush();
    check('Filter: zu lange Marker-Zeile verworfen', text === 'x\ny\n' && messages.length === 0 && oversized() === 1, text.length);
  }
  {
    const { filter, messages, oversized } = collect();
    let text = filter.push(`${IPC_MARKER}`);
    for (let i = 0; i < 50; i++) text += filter.push('b'.repeat(1000));
    const carried = (filter as unknown as { carry: string }).carry.length;
    text += filter.push(`\n${IPC_MARKER}{"id":4}\nok\n`) + filter.flush();
    check('Filter: zu lange Zeile ohne Ende wird nicht gepuffert', carried === 0 && oversized() === 1 && messages.join() === '{"id":4}' && text === 'ok\n', { carried, text });
  }
  {
    const { filter, messages } = collect();
    const text = filter.push(`${IPC_MARKER}{"id":5}`) + filter.flush();
    check('Filter: angefangene Marker-Zeile am Ende verworfen', text === '' && messages.length === 0);
  }
}

// ---------- Anfragen prüfen ----------

async function testValidation(): Promise<void> {
  const h = harness({ dev: false });
  const bad = async (label: string, line: string, expected: string, id: number | null) => {
    const reply = await raw(h, line);
    check(`Prüfung: ${label}`, reply !== null && !reply.ok && reply.error?.code === expected && reply.id === id, { code: code(reply), id: reply?.id });
  };
  await bad('kein JSON', 'das ist kein json', 'bad_request', null);
  await bad('Liste statt Objekt', '[1,2,3]', 'bad_request', null);
  await bad('ohne ID', '{"v":1,"op":"hello"}', 'bad_request', null);
  await bad('ID 0', '{"v":1,"id":0,"op":"hello"}', 'bad_request', null);
  await bad('negative ID', '{"v":1,"id":-4,"op":"hello"}', 'bad_request', null);
  await bad('Kommazahl als ID', '{"v":1,"id":1.5,"op":"hello"}', 'bad_request', null);
  await bad('ID als Text', '{"v":1,"id":"7","op":"hello"}', 'bad_request', null);
  await bad('ID zu groß', '{"v":1,"id":2147483648,"op":"hello"}', 'bad_request', null);
  await bad('falsche Protokollversion', '{"v":2,"id":11,"op":"hello"}', 'bad_request', 11);
  await bad('unbekanntes Feld', '{"v":1,"id":12,"op":"hello","token":"x"}', 'bad_request', 12);
  await bad('unbekannte Operation', '{"v":1,"id":13,"op":"accounts.tokens"}', 'unknown_op', 13);
  await bad('Prototyp-Name als Operation', '{"v":1,"id":14,"op":"constructor"}', 'unknown_op', 14);
  await bad('params kein Objekt', '{"v":1,"id":15,"op":"accounts.list","params":[]}', 'bad_request', 15);
  await bad('unbekannter Parameter', '{"v":1,"id":16,"op":"accounts.list","params":{"all":true}}', 'bad_request', 16);
  await bad('Sitzung ohne Konto', '{"v":1,"id":17,"op":"accounts.session","params":{}}', 'bad_request', 17);
  await bad('Konto-ID mit Pfad', '{"v":1,"id":18,"op":"accounts.session","params":{"account":"../../launcher-accounts.json"}}', 'bad_request', 18);
  await bad('Konto-ID als Zahl', '{"v":1,"id":19,"op":"accounts.setActive","params":{"account":42}}', 'bad_request', 19);
  await bad('__proto__ in params', '{"v":1,"id":20,"op":"accounts.list","params":{"__proto__":{"x":1}}}', 'bad_request', 20);

  let reply = await call(h, 'accounts.session', { account: randomUUID() });
  check('Prüfung: unbekanntes Konto → not_found', code(reply) === 'not_found', code(reply));
  reply = await call(h, 'accounts.setActive', { account: randomUUID() });
  check('Prüfung: unbekanntes Konto aktiv machen → not_found', code(reply) === 'not_found' && h.setActiveCalls.length === 0, code(reply));
  check('Prüfung: parseRequest lehnt zu lange Zeilen ab', !parseRequest(`{"v":1,"id":1,"op":"hello","x":"${'a'.repeat(IPC_MAX_LINE)}"}`).ok);

  // dieselbe ID zweimal gleichzeitig
  let release!: (info: AccountInfo) => void;
  h.signIn.impl = () => new Promise((resolve) => (release = resolve));
  const before = h.written.length;
  h.bridge.handle('{"v":1,"id":30,"op":"accounts.add"}');
  h.bridge.handle('{"v":1,"id":30,"op":"hello"}');
  const dup = await waitFor(h, (r) => r.id === 30, before);
  check('Prüfung: doppelte Anfrage-ID abgelehnt', code(dup) === 'bad_request', code(dup));
  await delay(20);
  release(h.store.list()[0]);
  await waitFor(h, (r) => r.id === 30 && r.ok, before);
}

// ---------- Operationen ----------

async function testOperations(): Promise<void> {
  const h = harness({ dev: false });

  let reply = await call(h, 'hello');
  check('hello: Protokoll 1, keine Offline-Konten in der fertigen App, Wechsel erlaubt', reply.ok && reply.result?.protocol === 1 && reply.result?.offline === false && reply.result?.launcher === '0.0.0-test' && reply.result?.allowed === true, reply.result);

  reply = await call(h, 'accounts.list');
  const accounts = (reply.result?.accounts ?? []) as Record<string, unknown>[];
  const names = accounts.map((a) => a.name).join(',');
  check('Liste: Microsoft-Konten ohne Offline-Konto', reply.ok && names === 'Alice,Bob,Carol', names);
  check('Liste: nur id, name, uuid, type, active, skinUrl', accounts.every((a) => Object.keys(a).every((k) => ['id', 'name', 'uuid', 'type', 'active', 'skinUrl'].includes(k))), Object.keys(accounts[0] ?? {}));
  check('Liste: aktives Konto markiert', accounts.find((a) => a.active)?.name === 'Alice');
  noTokens('Liste: keine Tokens', JSON.stringify(reply), h.tokens);

  // gültiges Token: ohne Erneuerung
  reply = await call(h, 'accounts.session', { account: h.alice.id });
  const session = reply.result ?? {};
  check('Sitzung (Token gültig): ohne Erneuerung', reply.ok && h.refreshCalls === 0 && session.accessToken === h.alice.accessToken, { code: code(reply), refreshCalls: h.refreshCalls });
  check('Sitzung: Name, UUID ohne Bindestriche, xuid, userType msa', session.name === 'Alice' && session.uuid === h.alice.uuid && session.xuid === h.alice.xuid && session.userType === 'msa');
  check('Sitzung: nie ein Refresh-Token', !JSON.stringify(reply).includes(h.alice.refreshToken) && !('refreshToken' in session));

  // abgelaufenes Token: erneuern (Microsoft nachgebaut), gleichzeitige Anfragen teilen sich eine Erneuerung
  const oldBobToken = h.bob.accessToken;
  const [first, second] = await Promise.all([call(h, 'accounts.session', { account: h.bob.id }), call(h, 'accounts.session', { account: h.bob.id })]);
  check('Sitzung (Token abgelaufen): erneuert, einmal für zwei Anfragen', first.ok && second.ok && h.refreshCalls === 1, { first: code(first), second: code(second), refreshCalls: h.refreshCalls });
  check('Sitzung: erneuertes Token im Spiel und gespeichert', first.result?.accessToken === h.bob.accessToken && h.bob.accessToken !== oldBobToken && h.store.saves.length === 1);
  check('Sitzung: Erneuerung ändert das aktive Konto nicht', h.store.list().find((a) => a.active)?.id === h.alice.id);

  // Microsoft lehnt ab: verständlicher Fehler, ohne Token im Text
  reply = await call(h, 'accounts.session', { account: h.carol.id });
  check('Sitzung: abgelehnte Erneuerung → session_failed', code(reply) === 'session_failed', code(reply));
  noTokens('Sitzung: Fehlertext ohne Token', JSON.stringify(reply), h.tokens);
  check('Sitzung: Fehlertext bleibt lesbar', /Microsoft-Anmeldung fehlgeschlagen/.test(reply.error?.message ?? ''));

  // aktiv machen
  reply = await call(h, 'accounts.setActive', { account: h.bob.id.toUpperCase() });
  const active = ((reply.result?.accounts ?? []) as Record<string, unknown>[]).find((a) => a.active);
  check('setActive: Launcher wechselt, Liste kommt mit', reply.ok && h.setActiveCalls.join() === h.bob.id && active?.name === 'Bob', { code: code(reply), active: active?.name });

  // Anmeldung aus dem Spiel
  reply = await call(h, 'accounts.add');
  check('add: abgebrochen → cancelled', code(reply) === 'cancelled', code(reply));
  let release!: () => void;
  h.signIn.impl = async () => {
    await new Promise<void>((resolve) => (release = resolve));
    const dave: FakeAccount = { id: randomUUID(), type: 'microsoft', name: 'Dave', uuid: randomBytes(16).toString('hex'), accessToken: fakeToken('dave'), refreshToken: fakeToken('dave-r'), expiresAt: h.clock.now + 3_600_000 };
    h.tokens.push(dave.accessToken, dave.refreshToken);
    h.store.accounts.push(dave);
    return h.store.list().find((a) => a.id === dave.id)!;
  };
  const before = h.written.length;
  h.bridge.handle('{"v":1,"id":500,"op":"accounts.add"}');
  await delay(20);
  reply = await call(h, 'accounts.add');
  check('add: zweite Anmeldung gleichzeitig → busy', code(reply) === 'busy', code(reply));
  release();
  reply = await waitFor(h, (r) => r.id === 500, before);
  check('add: neues Konto in der Antwort, nicht aktiv', reply.ok && (reply.result?.account as Record<string, unknown>)?.name === 'Dave' && (reply.result?.account as Record<string, unknown>)?.active === false, code(reply));
  check('add: Liste mit dem neuen Konto', ((reply.result?.accounts ?? []) as unknown[]).length === 4);
  h.signIn.impl = async () => { throw new Error('Xbox-Anmeldung abgelehnt (XErr 2148916233)'); };
  reply = await call(h, 'accounts.add');
  check('add: Fehler → sign_in_failed mit Text', code(reply) === 'sign_in_failed' && /Xbox/.test(reply.error?.message ?? ''), code(reply));

  // Ereignisse: erst nach hello, gebündelt
  const fresh = harness({ dev: false });
  fresh.bridge.notifyChanged();
  await delay(250);
  check('Ereignis: vor hello nichts', fresh.written.length === 0, fresh.written.length);
  await call(fresh, 'hello');
  const count = fresh.written.length;
  fresh.bridge.notifyChanged();
  fresh.bridge.notifyChanged();
  fresh.bridge.notifyChanged();
  await delay(250);
  const events = fresh.written.slice(count).map((l) => JSON.parse(l) as Reply);
  check('Ereignis: accounts.changed, gebündelt', events.length === 1 && events[0].event === 'accounts.changed' && events[0].v === 1, events.length);
  fresh.bridge.dispose();
  fresh.bridge.notifyChanged();
  fresh.bridge.handle('{"v":1,"id":1,"op":"hello"}');
  await delay(250);
  check('dispose: danach keine Zeile mehr', fresh.written.length === count + 1);

  noTokens('Konsole: keine Tokens in den Protokollzeilen', h.logs.join('\n'), h.tokens);
  check('Konsole: Kontowechsel protokolliert', h.logs.some((l) => /Sitzung für „Alice“ an das Spiel übergeben/.test(l)) && h.logs.some((l) => /„Bob“ ist jetzt das aktive Konto/.test(l)));
  check('safeMessage: JWT und lange Zeichenketten geschwärzt', !/eyJ|abcdefghij/.test(safeMessage(new Error(`x eyJabc.def.ghi y ${'abcdefghij'.repeat(5)} z\u0007`))));
}

// ---------- Grenzen ----------

async function testRateLimits(): Promise<void> {
  const h = harness({ dev: false });
  const results: string[] = [];
  for (let i = 0; i < DEFAULT_LIMITS.sessions[0].max + 1; i++) results.push(code(await call(h, 'accounts.session', { account: h.alice.id })));
  check(`Grenze: ${DEFAULT_LIMITS.sessions[0].max} Sitzungen pro Minute, dann rate_limited`, results.slice(0, -1).every((c) => c === 'ok') && results.at(-1) === 'rate_limited', results);
  check('Grenze: Liste geht trotzdem', code(await call(h, 'accounts.list')) === 'ok');
  h.clock.now += DEFAULT_LIMITS.sessions[0].ms + 1;
  check('Grenze: nach einer Minute wieder erlaubt', code(await call(h, 'accounts.session', { account: h.alice.id })) === 'ok');
  check('Grenze: Ablehnung protokolliert', h.logs.some((l) => /WARN .*zu viele Kontowechsel/.test(l)));

  // Stunde: 20
  let hourly = 0;
  for (let i = 0; i < 30; i++) {
    h.clock.now += DEFAULT_LIMITS.sessions[0].ms + 1;
    if (code(await call(h, 'accounts.session', { account: h.alice.id })) === 'ok') hourly++;
  }
  // in der ersten Minute schon 5 erlaubt, also bleiben 15 für den Rest der Stunde
  check(`Grenze: höchstens ${DEFAULT_LIMITS.sessions[1].max} Sitzungen pro Stunde`, hourly === DEFAULT_LIMITS.sessions[1].max - 5, hourly);

  // alle Anfragen: eigene, kleine Grenze
  const small = harness({ dev: false, limits: { ...DEFAULT_LIMITS, requests: { max: 5, ms: 1000 } } });
  const codes: string[] = [];
  for (let i = 0; i < 6; i++) codes.push(code(await call(small, 'hello')));
  check('Grenze: alle Anfragen zusammen (5 pro Sekunde)', codes.slice(0, 5).every((c) => c === 'ok') && codes[5] === 'rate_limited', codes);
  check('Grenze: kaputte Zeilen über der Grenze bekommen keine Antwort', (await raw(small, 'kaputt')) === null);
  for (let i = 0; i < 100; i++) small.bridge.handle('kaputt');
  const warnings = small.logs.filter((l) => l.startsWith('WARN')).length;
  check('Grenze: Flut füllt die Konsole nicht', warnings <= 10, warnings);
  small.clock.now += 1001;
  check('Grenze: danach wieder Antworten', code(await call(small, 'hello')) === 'ok');

  // gleichzeitig offene Anfragen: 4 hängende Sitzungen, die fünfte Anfrage muss warten
  const busy = harness({ dev: false });
  busy.deps.session = () => new Promise(() => undefined);
  for (let i = 0; i < DEFAULT_LIMITS.inFlight; i++) {
    busy.bridge.handle(JSON.stringify({ v: 1, id: 900 + i, op: 'accounts.session', params: { account: busy.alice.id } }));
  }
  await delay(20);
  check(`Grenze: höchstens ${DEFAULT_LIMITS.inFlight} offene Anfragen, dann busy`, code(await call(busy, 'accounts.list')) === 'busy');
}

// ---------- Einstellung und Bestätigung im Launcher ----------

async function testSetting(): Promise<void> {
  const h = harness({ dev: false });
  h.allowed.value = false;
  let reply = await call(h, 'hello');
  check('Einstellung aus: hello meldet allowed = false', reply.ok && reply.result?.allowed === false, reply.result);
  reply = await call(h, 'accounts.list');
  check('Einstellung aus: Liste geht, mit allowed = false', reply.ok && reply.result?.allowed === false && ((reply.result?.accounts ?? []) as unknown[]).length === 3);
  let signInCalled = false;
  h.signIn.impl = async () => {
    signInCalled = true;
    return h.store.list()[0];
  };
  const codes = [
    code(await call(h, 'accounts.session', { account: h.alice.id })),
    code(await call(h, 'accounts.session', { account: h.bob.id })),
    code(await call(h, 'accounts.add')),
    code(await call(h, 'accounts.setActive', { account: h.alice.id })),
  ];
  check('Einstellung aus: session, add, setActive → not_allowed', codes.every((c) => c === 'not_allowed'), codes);
  check('Einstellung aus: kein Fenster, keine Anmeldung, kein Token geholt', h.confirmCalls.length === 0 && !signInCalled && h.refreshCalls === 0 && h.setActiveCalls.length === 0);
  check('Einstellung aus: Text verweist auf die Einstellungen', /Einstellungen/.test(((await call(h, 'accounts.session', { account: h.alice.id })).error?.message) ?? ''));
  h.allowed.value = true;
  reply = await call(h, 'accounts.session', { account: h.alice.id });
  check('Einstellung wieder an: Wechsel geht sofort', reply.ok, code(reply));
}

async function testConfirmation(): Promise<void> {
  const h = harness({ dev: false });

  let reply = await call(h, 'accounts.session', { account: h.alice.id });
  check('Bestätigung: Startkonto ohne Nachfrage', reply.ok && h.confirmCalls.length === 0, code(reply));

  const dora = h.addValid('Dora');
  reply = await call(h, 'accounts.session', { account: dora.id });
  check('Bestätigung: erstes Mal für ein anderes Konto → Fenster, dann Sitzung', reply.ok && h.confirmCalls.join() === 'Dora' && reply.result?.accessToken === dora.accessToken, { code: code(reply), calls: h.confirmCalls });
  reply = await call(h, 'accounts.session', { account: dora.id });
  check('Bestätigung: danach für dieses Spiel ohne Nachfrage', reply.ok && h.confirmCalls.length === 1);
  noTokens('Bestätigung: Fenster bekommt keine Tokens', h.confirmArgs.join('\n'), h.tokens);

  // Abbrechen (Uhr jeweils weiter, damit die Grenzen für Sitzungen und Fenster hier nicht greifen)
  const later = () => (h.clock.now += 11 * 60_000);
  later();
  const eve = h.addValid('Eve');
  h.confirm.impl = async () => false;
  const refreshBefore = h.refreshCalls;
  reply = await call(h, 'accounts.session', { account: eve.id });
  check('Bestätigung: „Abbrechen“ → cancelled, kein Token', code(reply) === 'cancelled' && !JSON.stringify(reply).includes(eve.accessToken) && h.refreshCalls === refreshBefore, code(reply));
  check('Bestätigung: Ablehnung protokolliert', h.logs.some((l) => /WARN Wechsel zu „Eve“ abgelehnt/.test(l)));
  reply = await call(h, 'accounts.setActive', { account: eve.id });
  check('Bestätigung: abgelehntes Konto nicht aktiv setzbar → not_allowed', code(reply) === 'not_allowed' && h.setActiveCalls.length === 0, code(reply));
  h.confirm.impl = async () => true;
  later();
  reply = await call(h, 'accounts.session', { account: eve.id });
  check('Bestätigung: nach Ablehnung wird wieder gefragt', reply.ok && h.confirmCalls.filter((n) => n === 'Eve').length === 2, code(reply));
  check('Bestätigung: Zusage protokolliert', h.logs.some((l) => /INFO Wechsel zu „Eve“ bestätigt/.test(l)));
  reply = await call(h, 'accounts.setActive', { account: eve.id });
  check('Bestätigung: bestätigtes Konto aktiv setzbar', reply.ok && h.setActiveCalls.join() === eve.id, code(reply));
  reply = await call(h, 'accounts.setActive', { account: h.alice.id });
  check('Bestätigung: Startkonto aktiv setzbar', reply.ok, code(reply));

  // ein Fenster zur Zeit: gleiches Konto wartet mit, anderes Konto → busy
  const finn = h.addValid('Finn');
  const gina = h.addValid('Gina');
  let answer!: (ok: boolean) => void;
  h.confirm.impl = () => new Promise((resolve) => (answer = resolve));
  later();
  const before = h.written.length;
  h.bridge.handle(JSON.stringify({ v: 1, id: 700, op: 'accounts.session', params: { account: finn.id } }));
  h.bridge.handle(JSON.stringify({ v: 1, id: 701, op: 'accounts.session', params: { account: finn.id } }));
  await delay(20);
  reply = await call(h, 'accounts.session', { account: gina.id });
  check('Bestätigung: zweites Konto während offener Frage → busy', code(reply) === 'busy', code(reply));
  answer(true);
  const [first, second] = [await waitFor(h, (r) => r.id === 700, before), await waitFor(h, (r) => r.id === 701, before)];
  check('Bestätigung: zwei Anfragen für dasselbe Konto, ein Fenster', first.ok && second.ok && h.confirmCalls.filter((n) => n === 'Finn').length === 1, { first: code(first), second: code(second) });

  // im Spiel angemeldet: das Anmeldefenster ist die Bestätigung
  h.confirm.impl = async () => true;
  const hank: { id: string } = { id: randomUUID() };
  h.signIn.impl = async () => {
    const created = h.addValid('Hank');
    hank.id = created.id;
    return h.store.list().find((a) => a.id === created.id)!;
  };
  later();
  reply = await call(h, 'accounts.add');
  const confirmsBefore = h.confirmCalls.length;
  reply = await call(h, 'accounts.session', { account: hank.id });
  check('Bestätigung: gerade angemeldetes Konto ohne Nachfrage', reply.ok && h.confirmCalls.length === confirmsBefore, code(reply));
  noTokens('Bestätigung: Konsole ohne Tokens', h.logs.join('\n'), h.tokens);

  // Grenze für Nachfragen
  const spam = harness({ dev: false });
  spam.confirm.impl = async () => false;
  const results: string[] = [];
  for (let i = 0; i < DEFAULT_LIMITS.confirms.max + 1; i++) {
    const target = spam.addValid(`Spam${i}`);
    results.push(code(await call(spam, 'accounts.session', { account: target.id })));
  }
  check(`Bestätigung: höchstens ${DEFAULT_LIMITS.confirms.max} Fenster in 10 Minuten`, results.slice(0, -1).every((c) => c === 'cancelled') && results.at(-1) === 'rate_limited' && spam.confirmCalls.length === DEFAULT_LIMITS.confirms.max, results);
}

// ---------- Offline-Konten ----------

async function testOffline(): Promise<void> {
  const packaged = harness({ dev: false });
  let reply = await call(packaged, 'accounts.session', { account: packaged.offline.id });
  check('Offline (fertige App): Sitzung → not_found', code(reply) === 'not_found', code(reply));
  reply = await call(packaged, 'accounts.setActive', { account: packaged.offline.id });
  check('Offline (fertige App): aktiv machen → not_found', code(reply) === 'not_found', code(reply));

  const dev = harness({ dev: true });
  reply = await call(dev, 'hello');
  check('Offline (Entwicklung): hello meldet offline = true', reply.result?.offline === true);
  reply = await call(dev, 'accounts.list');
  check('Offline (Entwicklung): in der Liste', ((reply.result?.accounts ?? []) as Record<string, unknown>[]).some((a) => a.type === 'offline' && a.name === 'Offi'));
  reply = await call(dev, 'accounts.session', { account: dev.offline.id });
  check('Offline (Entwicklung): Sitzung mit Token 0, userType legacy', reply.ok && reply.result?.accessToken === '0' && reply.result?.userType === 'legacy' && !('xuid' in (reply.result ?? {})), code(reply));

  // SessionManager selbst: Offline nur, wenn erlaubt
  const locked = new SessionManager<FakeAccount>({
    secrets: () => ({ accessToken: '', refreshToken: '' }), save: async () => undefined, clientId: 'c',
    refreshMicrosoft: async () => ({ accessToken: '', refreshToken: '' }), loginMinecraft: async () => { throw new Error('nein'); },
    offlineAllowed: () => false, log: () => undefined,
  });
  try {
    await locked.sessionFor(packaged.offline);
    check('Offline: SessionManager sperrt in der fertigen App', false);
  } catch (error) {
    check('Offline: SessionManager sperrt in der fertigen App', (error as Error).message === OFFLINE_LOCKED);
  }
}

// ---------- echtes Kindprozess-Spiel ----------

async function testChildProcess(): Promise<void> {
  const h = harness({ dev: false });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'heldix-ipc-'));
  try {
    const stepsFile = path.join(dir, 'schritte.json');
    const resultFile = path.join(dir, 'ergebnis.json');
    const event = (text: string) => `<log4j:Event logger="test" timestamp="1800000000000" level="INFO" thread="Render thread">\n<log4j:Message><![CDATA[${text}]]></log4j:Message>\n</log4j:Event>\n`;
    const halfEvent = event('Halbes Ereignis');
    const steps: FakeStep[] = [
      { kind: 'log', text: '[12:00:00] [main/INFO]: Setting user: Tester\n' },
      { kind: 'log', text: event('Loading 42 mods') },
      { kind: 'request', body: { v: 1, id: 1, op: 'hello' }, split: true },
      { kind: 'wait', id: 1 },
      { kind: 'request', body: { v: 1, id: 2, op: 'accounts.list' } },
      { kind: 'wait', id: 2 },
      // Anfrage mitten in einem Log-Ereignis (zweiter Thread schreibt dazwischen)
      { kind: 'chunks', parts: [halfEvent.slice(0, 120), `${IPC_MARKER}${JSON.stringify({ v: 1, id: 3, op: 'accounts.session', params: { account: h.bob.id } })}\n`, halfEvent.slice(120)] },
      { kind: 'wait', id: 3 },
      { kind: 'request', body: 'nicht json' },
      { kind: 'wait', id: null },
      { kind: 'request', body: { v: 1, id: 0, op: 'hello' } },
      { kind: 'wait', id: null },
      { kind: 'request', body: { v: 1, id: 5, op: 'accounts.session', params: { account: '../../etc/passwd' } } },
      { kind: 'wait', id: 5 },
      { kind: 'request', body: { v: 1, id: 6, op: 'accounts.session', params: { account: randomUUID() } } },
      { kind: 'wait', id: 6 },
      { kind: 'log', text: `${IPC_MARKER}{"v":1,"id":7,"op":"hello","x":"${'a'.repeat(IPC_MAX_LINE * 3)}"}\n` },
      { kind: 'wait', id: 7, timeoutMs: 400 },
      { kind: 'stderr', text: `${IPC_MARKER}{"v":1,"id":8,"op":"hello"}\n` },
      { kind: 'wait', id: 8, timeoutMs: 400 },
      { kind: 'request', body: { v: 1, id: 9, op: 'hello' } },
      { kind: 'wait', id: 9 },
      { kind: 'log', text: 'Zeile mit \u0001 Steuerzeichen\n' },
      { kind: 'sleep', ms: 300 },
      { kind: 'log', text: 'Letzte Zeile\n' },
    ];
    await writeFile(stepsFile, JSON.stringify(steps));

    const consoleLines: LogLine[] = [];
    const rejected: string[] = [];
    let writeToGame: (line: string) => boolean = () => false;
    const bridge = new AccountBridge({
      ...h.deps,
      signIn: () => Promise.reject(new Error('nicht im Test')),
      setActive: async () => undefined,
    }, (line) => {
      const sent = writeToGame(line);
      // nach der Antwort auf hello ein Ereignis auslösen (Konten im Launcher geändert)
      if (line.includes('"id":1,') && line.includes('"protocol"')) bridge.notifyChanged();
      return sent;
    });
    const running = startGame(process.execPath, [path.join(__dirname, 'fake-game-ipc.js'), stepsFile, resultFile], dir, (lines) => consoleLines.push(...lines), {
      message: (json) => bridge.handle(json),
      rejected: (reason) => {
        rejected.push(reason);
        bridge.rejected(reason);
      },
    });
    writeToGame = (line) => running.send(line);
    const exitCode = await Promise.race([running.exited, delay(30_000).then(() => 'timeout' as const)]);
    if (exitCode === 'timeout') running.process.kill();
    bridge.dispose();
    check('Kindprozess: Spiel läuft durch', exitCode === 0, String(exitCode));
    check('Kindprozess: send nach dem Ende → false', running.send('{"v":1}') === false);

    const result = JSON.parse(await readFile(resultFile, 'utf8')) as FakeResult;
    const replies = result.lines.map((l) => JSON.parse(l) as Reply);
    const byId = (id: number | null) => replies.filter((r) => r.id === id && !r.event);
    const waits = result.waits.map((w) => `${w.id}:${w.received ? 'ja' : 'nein'}`).join(' ');
    check('Kindprozess: Antworten auf 1, 2, 3, null, null, 5, 6, 9 – keine auf 7 (zu lang) und 8 (stderr)', waits === '1:ja 2:ja 3:ja null:ja null:ja 5:ja 6:ja 7:nein 8:nein 9:ja', waits);
    check('Kindprozess: hello', byId(1)[0]?.ok === true && byId(1)[0]?.result?.protocol === 1);
    check('Kindprozess: Liste', ((byId(2)[0]?.result?.accounts ?? []) as unknown[]).length === 3);
    const session = byId(3)[0];
    check('Kindprozess: Sitzung (erneuert) aus einer Anfrage mitten im Log-Ereignis', session?.ok === true && session.result?.accessToken === h.bob.accessToken && h.refreshCalls === 1, code(session ?? null));
    check('Kindprozess: erster Wechsel zu Bob wurde im Launcher bestätigt', h.confirmCalls.join() === 'Bob', h.confirmCalls);
    check('Kindprozess: hello meldet allowed', byId(1)[0]?.result?.allowed === true);
    check('Kindprozess: kaputte Zeilen → bad_request ohne ID', byId(null).length === 2 && byId(null).every((r) => r.error?.code === 'bad_request'));
    check('Kindprozess: ungültige Konto-ID → bad_request', byId(5)[0]?.error?.code === 'bad_request');
    check('Kindprozess: unbekanntes Konto → not_found', byId(6)[0]?.error?.code === 'not_found');
    check('Kindprozess: Ereignis accounts.changed kam an', replies.some((r) => r.event === 'accounts.changed'));
    check('Kindprozess: zu lange Zeile und stderr gemeldet', rejected.includes('oversized') && rejected.includes('stderr'), rejected);

    const texts = consoleLines.map((l) => l.text);
    const all = texts.join('\n');
    check('Konsole: keine Marker-Zeile', !all.includes('heldix-ipc') && !all.includes('"op"'), texts.filter((t) => t.includes('heldix-ipc')).length);
    noTokens('Konsole: keine Tokens', all, h.tokens);
    noTokens('Protokoll: keine Tokens', h.logs.join('\n'), h.tokens);
    const expected = ['Setting user: Tester', 'Loading 42 mods', 'Halbes Ereignis', 'Steuerzeichen', 'Letzte Zeile', 'fake game: fertig'];
    const positions = expected.map((e) => texts.findIndex((t) => t.includes(e)));
    check('Konsole: normale Ausgabe vollständig und in Reihenfolge', positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), positions);
    check('Konsole: Log-Ereignis mit Marker dazwischen bleibt ein Ereignis', texts.some((t) => /\[Render thread\/INFO\]: Halbes Ereignis$/.test(t)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  testFilter();
  await testValidation();
  await testOperations();
  await testRateLimits();
  await testSetting();
  await testConfirmation();
  await testOffline();
  await testChildProcess();
  finish('test:accounts-ipc');
}

main().catch((error) => {
  // nur die Meldung: kein Objekt, das Tokens enthalten könnte
  console.error(`test:accounts-ipc abgebrochen: ${safeMessage(error)}`);
  process.exit(1);
});
