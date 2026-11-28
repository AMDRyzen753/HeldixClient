// Verwaltung für den Betreiber: Meldungen, Sperren und das Team (die ersten Admins werden hier angelegt).
//
//   heldix-dienst-admin meldungen [alle]                  offene (oder alle) Meldungen mit den gemeldeten Nachrichten
//   heldix-dienst-admin meldung-erledigt <nummer>…        Meldung(en) als erledigt markieren
//   heldix-dienst-admin sperren <name|uuid> [grund]       Spieler sperren (Konto beim Dienst wird gelöscht)
//   heldix-dienst-admin entsperren <name|uuid>            Sperre aufheben
//   heldix-dienst-admin gesperrt                          alle Sperren
//   heldix-dienst-admin team <name|uuid> <rolle>          ins Team aufnehmen oder Rolle ändern (admin, developer-team,
//                                                         moderator, supporter, designer, tester)
//   heldix-dienst-admin team-entfernen <name|uuid>        aus dem Team entfernen
//   heldix-dienst-admin team-liste                        alle Team-Mitglieder
//   heldix-dienst-admin team-2fa-reset <name|uuid>        Zwei-Faktor-Anmeldung zurücksetzen
//
// Auf dem Server ruft der Installer-Befehl heldix-dienst-admin dieses Programm als Benutzer des Dienstes auf.
// Von Hand: HELDIX_DIENST_DATA=<datenordner> node dist/admin.js <befehl>. Es darf laufen, während der Dienst läuft
// (SQLite mit WAL). Offene WebSocket-Verbindungen eines Gesperrten trennt der Dienst beim nächsten Lebenszeichen.
// Jede Änderung steht im Protokoll des Teams mit dem Handelnden „CLI“.
import fs from 'node:fs';
import path from 'node:path';
import { Store, type BanRow, type ReportRow, type UserRow } from './db';
import type { SnapshotMessage } from './reports';
import { CLI_ACTOR, isTeamRole, playerLabel, writeAudit } from './team';
import { isName, normalizeUuid } from './validate';

export interface AdminOutput {
  out(line: string): void;
  err(line: string): void;
}

const PROGRAM = 'heldix-dienst-admin';
const DB_FILE = 'heldix-dienst.db';
const MAX_BAN_REASON = 300;

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Belästigung',
  inappropriate: 'Unangemessene Inhalte',
  other: 'Sonstiges',
};

const USAGE = [
  `Aufruf: ${PROGRAM} <befehl>`,
  '',
  '  meldungen [alle]                   offene (mit „alle“ auch erledigte) Meldungen mit den gemeldeten Nachrichten',
  '  meldung-erledigt <nummer>…         Meldung(en) als erledigt markieren',
  '  sperren <name|uuid> [grund]        Spieler sperren: löscht Konto, Freundschaften, Anfragen,',
  '                                     Nachrichten, Blockierungen und Anmeldungen beim Dienst',
  '  entsperren <name|uuid>             Sperre aufheben',
  '  gesperrt                           alle Sperren',
  '  team <name|uuid> <rolle>           ins Team aufnehmen oder Rolle ändern (Spieler muss schon angemeldet gewesen sein);',
  '                                     Rollen: admin, developer-team (Entwickler), moderator, supporter, designer, tester',
  '  team-entfernen <name|uuid>         aus dem Team entfernen',
  '  team-liste                         alle Team-Mitglieder',
  '  team-2fa-reset <name|uuid>         Zwei-Faktor-Anmeldung zurücksetzen (neu einrichten beim nächsten Besuch)',
  '',
  'Datenordner: HELDIX_DIENST_DATA (Standard ./data)',
];

/** Steuerzeichen nie ungefiltert ins Terminal schreiben (Escape-Sequenzen). */
function clean(text: string): string {
  return text.replace(/[\p{Cc}\p{Cs}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu, '\uFFFD');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Datum in Ortszeit des Servers, z. B. `25.11.2026 14:03`. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function who(name: string, uuid: string): string {
  return name === '' ? uuid : `${clean(name)} (${uuid})`;
}

/**
 * Führt einen Befehl aus und liefert den Exit-Code (0 = gut, 1 = Fehler, 2 = falscher Aufruf).
 * `dataDir` ist der Datenordner des Dienstes.
 */
export function runAdmin(args: readonly string[], dataDir: string, io: AdminOutput, now = Date.now()): number {
  const [command, ...rest] = args;
  if (command === undefined || command === 'hilfe' || command === '--help' || command === '-h') {
    for (const line of USAGE) (command === undefined ? io.err : io.out)(line);
    return command === undefined ? 2 : 0;
  }
  const commands: Record<string, (store: Store) => number> = {
    meldungen: (store) => listReports(store, rest, io),
    'meldung-erledigt': (store) => resolveReports(store, rest, io, now),
    sperren: (store) => ban(store, rest, io, now),
    entsperren: (store) => unban(store, rest, io),
    gesperrt: (store) => listBans(store, io),
    team: (store) => setTeam(store, rest, io, now),
    'team-entfernen': (store) => removeTeam(store, rest, io),
    'team-liste': (store) => listTeam(store, io),
    'team-2fa-reset': (store) => resetTeam2fa(store, rest, io),
  };
  const run = Object.hasOwn(commands, command) ? commands[command] : undefined;
  if (!run) {
    io.err(`Unbekannter Befehl: ${clean(command)}`);
    for (const line of USAGE) io.err(line);
    return 2;
  }
  // Nie aus Versehen eine leere Datenbank anlegen (falscher Ordner).
  const dbFile = path.join(dataDir, DB_FILE);
  if (!fs.existsSync(dbFile)) {
    io.err(`Keine Datenbank gefunden: ${dbFile}`);
    io.err('Stimmt HELDIX_DIENST_DATA? Auf dem Server: sudo heldix-dienst-admin … (setzt den Ordner selbst).');
    return 1;
  }
  const store = new Store(dataDir);
  try {
    return run(store);
  } finally {
    store.close();
  }
}

// ---------- Meldungen ----------

function listReports(store: Store, args: readonly string[], io: AdminOutput): number {
  const all = args[0] === 'alle';
  if (args.length > 0 && !all) {
    io.err(`Aufruf: ${PROGRAM} meldungen [alle]`);
    return 2;
  }
  const reports = store.listReports(all ? 'all' : 'open');
  if (reports.length === 0) {
    io.out(all ? 'Keine Meldungen.' : 'Keine offenen Meldungen.');
    return 0;
  }
  const label = all ? 'Meldung' : 'offene Meldung';
  io.out(`${reports.length} ${label}${reports.length === 1 ? '' : 'en'} (älteste zuerst):`);
  for (const report of reports) {
    io.out('');
    for (const line of describeReport(store, report)) io.out(line);
  }
  io.out('');
  io.out(`Erledigt: ${PROGRAM} meldung-erledigt <nummer>   Sperren: ${PROGRAM} sperren <name|uuid> [grund]`);
  return 0;
}

function describeReport(store: Store, report: ReportRow): string[] {
  const banned = store.getBan(report.reported) ? '  [gesperrt]' : '';
  const status =
    report.status === 'done'
      ? ` · erledigt ${report.doneAt === null ? '' : `am ${formatDate(report.doneAt)} `}von ${report.doneBy === null ? 'CLI' : clean(report.doneBy)}`
      : '';
  const lines = [
    `Meldung ${report.id} · ${formatDate(report.at)}${status}`,
    `  Von:    ${who(report.reporterName, report.reporter)}`,
    `  Über:   ${who(report.reportedName, report.reported)}${banned}`,
    `  Grund:  ${REASON_LABELS[report.reason] ?? clean(report.reason)}`,
  ];
  if (report.note !== '') lines.push(`  Notiz:  ${clean(report.note)}`);
  let messages: SnapshotMessage[] = [];
  try {
    const parsed: unknown = JSON.parse(report.messages);
    if (Array.isArray(parsed)) messages = parsed as SnapshotMessage[];
  } catch {
    lines.push('  Nachrichten: (Beleg nicht lesbar)');
    return lines;
  }
  if (messages.length === 0) {
    lines.push('  Nachrichten: keine (nie geschrieben, oder die Unterhaltung war schon gelöscht)');
    return lines;
  }
  const names: Record<string, string> = { [report.reporter]: report.reporterName, [report.reported]: report.reportedName };
  lines.push(`  Nachrichten (letzte ${messages.length}, älteste zuerst):`);
  for (const message of messages) {
    const name = names[String(message.from)] || String(message.from);
    lines.push(`    ${formatDate(Number(message.at))}  ${clean(name)}: ${clean(String(message.text))}`);
  }
  return lines;
}

function resolveReports(store: Store, ids: readonly string[], io: AdminOutput, now: number): number {
  if (ids.length === 0) {
    io.err(`Bitte die Nummer der Meldung angeben: ${PROGRAM} meldung-erledigt <nummer>`);
    return 2;
  }
  let failed = false;
  for (const raw of ids) {
    const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
    const report = Number.isNaN(id) ? undefined : store.getReport(id);
    if (Number.isNaN(id)) {
      io.err(`„${clean(raw)}“ ist keine Nummer einer Meldung.`);
      failed = true;
    } else if (!report) {
      io.err(`Meldung ${id} gibt es nicht (mehr).`);
      failed = true;
    } else if (store.markReportDone(id, now, null)) {
      writeAudit(store, CLI_ACTOR, 'report.done', `Meldung ${id}`);
      io.out(`Meldung ${id} ist als erledigt markiert. Sie bleibt bis zum Ablauf nach 90 Tagen gespeichert.`);
    } else {
      io.out(`Meldung ${id} war schon erledigt.`);
    }
  }
  return failed ? 1 : 0;
}

// ---------- Sperren ----------

/** Spieler zu `name|uuid`: aus der Datenbank, sonst nur die UUID. */
function target(store: Store, raw: string): { uuid: string; name: string } | { error: string } {
  const uuid = normalizeUuid(raw);
  if (uuid !== null) {
    const user = store.getUser(uuid);
    return { uuid, name: user?.name ?? store.getBan(uuid)?.name ?? '' };
  }
  if (!isName(raw)) return { error: `„${clean(raw)}“ ist weder ein Spielername noch eine UUID.` };
  const user = store.findUserByName(raw);
  if (user) return { uuid: user.uuid, name: user.name };
  const banned = store.findBanByName(raw);
  if (banned) return { uuid: banned.uuid, name: banned.name };
  return { error: `Kein Spieler „${raw}“ bekannt. Mit der UUID lässt sich auch jemand sperren, der noch nie online war.` };
}

function ban(store: Store, args: readonly string[], io: AdminOutput, now: number): number {
  const [raw, ...reasonWords] = args;
  if (raw === undefined) {
    io.err(`Bitte Name oder UUID angeben: ${PROGRAM} sperren <name|uuid> [grund]`);
    return 2;
  }
  const found = target(store, raw);
  if ('error' in found) {
    io.err(found.error);
    return 1;
  }
  const existing = store.getBan(found.uuid);
  const member = store.getTeamMember(found.uuid);
  const reason = clean(reasonWords.join(' ').trim()).slice(0, MAX_BAN_REASON) || existing?.reason || '';
  const related = store.ban(found.uuid, found.name, reason, now);
  writeAudit(store, CLI_ACTOR, 'ban', playerLabel(found.name, found.uuid), reason === '' ? null : reason);
  const label = who(found.name, found.uuid);
  if (existing) {
    io.out(`${label} war schon gesperrt (seit ${formatDate(existing.at)}).`);
  } else {
    io.out(`${label} ist jetzt gesperrt.`);
  }
  io.out('Gelöscht: Konto, Freundschaften, Anfragen, Nachrichten, Blockierungen und Anmeldungen (auch auf der Webseite).');
  if (member) io.out(`Er war im Team (${member.role}) und ist es jetzt nicht mehr.`);
  io.out('Eine neue Anmeldung lehnt der Dienst ab („Dieses Konto ist für den Heldix-Dienst gesperrt.“).');
  io.out('Eine noch offene Verbindung aus dem Spiel trennt der Dienst beim nächsten Lebenszeichen (etwa 30 Sekunden).');
  if (related.length > 0) {
    io.out(`Betroffene Freunde und Spieler mit offenen Anfragen: ${related.length}. Sie sehen die Änderung beim nächsten Abruf.`);
  }
  return 0;
}

function unban(store: Store, args: readonly string[], io: AdminOutput): number {
  const [raw] = args;
  if (raw === undefined) {
    io.err(`Bitte Name oder UUID angeben: ${PROGRAM} entsperren <name|uuid>`);
    return 2;
  }
  const uuid = normalizeUuid(raw);
  let entry: BanRow | undefined;
  if (uuid !== null) entry = store.getBan(uuid);
  else if (isName(raw)) entry = store.findBanByName(raw);
  else {
    io.err(`„${clean(raw)}“ ist weder ein Spielername noch eine UUID.`);
    return 1;
  }
  if (!entry || !store.unban(entry.uuid)) {
    io.err(`${clean(raw)} ist nicht gesperrt.`);
    return 1;
  }
  writeAudit(store, CLI_ACTOR, 'unban', playerLabel(entry.name, entry.uuid));
  io.out(`${who(entry.name, entry.uuid)} ist entsperrt. Bei der nächsten Anmeldung legt der Dienst das Konto neu an.`);
  return 0;
}

function listBans(store: Store, io: AdminOutput): number {
  const bans = store.listBans();
  if (bans.length === 0) {
    io.out('Niemand ist gesperrt.');
    return 0;
  }
  io.out(`${bans.length} Sperre${bans.length === 1 ? '' : 'n'} (neueste zuerst):`);
  for (const entry of bans) {
    const reason = entry.reason === '' ? '' : ` – ${clean(entry.reason)}`;
    const by = entry.by === null ? '' : ` (von ${clean(entry.by)})`;
    io.out(`  ${formatDate(entry.at)}  ${who(entry.name, entry.uuid)}${reason}${by}`);
  }
  return 0;
}

// ---------- Team ----------

/** Spieler zu `name|uuid`, der sich schon einmal angemeldet hat. */
function existingUser(store: Store, raw: string | undefined, usage: string, io: AdminOutput): UserRow | number {
  if (raw === undefined) {
    io.err(`Aufruf: ${PROGRAM} ${usage}`);
    return 2;
  }
  const uuid = normalizeUuid(raw);
  if (uuid === null && !isName(raw)) {
    io.err(`„${clean(raw)}“ ist weder ein Spielername noch eine UUID.`);
    return 1;
  }
  const user = uuid !== null ? store.getUser(uuid) : store.findUserByName(raw);
  if (!user) {
    io.err(`Kein Spieler „${clean(raw)}“ bekannt. Er muss sich zuerst einmal im Launcher oder im Spiel beim Dienst anmelden.`);
    return 1;
  }
  return user;
}

function setTeam(store: Store, args: readonly string[], io: AdminOutput, now: number): number {
  const usage = 'team <name|uuid> admin|developer-team|moderator|supporter|designer|tester';
  const [raw, role] = args;
  if (!isTeamRole(role)) {
    io.err(`Aufruf: ${PROGRAM} ${usage}`);
    return 2;
  }
  const user = existingUser(store, raw, usage, io);
  if (typeof user === 'number') return user;
  const label = who(user.name, user.uuid);
  const result = store.setTeamMember(user.uuid, role, now, null);
  if (result === 'same') {
    io.out(`${label} ist schon ${role}.`);
    return 0;
  }
  writeAudit(store, CLI_ACTOR, result === 'added' ? 'team.add' : 'team.role', playerLabel(user.name, user.uuid), role);
  io.out(result === 'added' ? `${label} ist jetzt im Team (${role}).` : `${label} ist jetzt ${role}.`);
  if (store.getTeamMember(user.uuid)?.totpSecret === null) {
    io.out('Beim ersten Besuch des Team-Bereichs auf der Webseite richtet er die Zwei-Faktor-Anmeldung ein.');
  }
  if (store.countAdmins() === 0) io.out('Achtung: Es gibt jetzt keinen Admin mehr.');
  return 0;
}

function removeTeam(store: Store, args: readonly string[], io: AdminOutput): number {
  const user = existingUser(store, args[0], 'team-entfernen <name|uuid>', io);
  if (typeof user === 'number') return user;
  const member = store.getTeamMember(user.uuid);
  if (!member || !store.removeTeamMember(user.uuid)) {
    io.err(`${who(user.name, user.uuid)} ist nicht im Team.`);
    return 1;
  }
  writeAudit(store, CLI_ACTOR, 'team.remove', playerLabel(user.name, user.uuid), member.role);
  io.out(`${who(user.name, user.uuid)} ist nicht mehr im Team.`);
  if (store.countAdmins() === 0) io.out(`Achtung: Es gibt jetzt keinen Admin mehr. Einen neuen anlegen: ${PROGRAM} team <name> admin`);
  return 0;
}

function listTeam(store: Store, io: AdminOutput): number {
  const members = store.listTeam();
  if (members.length === 0) {
    io.out(`Das Team ist leer. Den ersten Admin anlegen: ${PROGRAM} team <name> admin`);
    return 0;
  }
  io.out(`${members.length} Team-Mitglied${members.length === 1 ? '' : 'er'}:`);
  for (const m of members) {
    const twoFactor = m.totpSecret === null ? '2FA nicht eingerichtet' : '2FA aktiv';
    const by = m.addedBy === null ? 'CLI' : clean(m.addedBy);
    io.out(`  ${m.role.padEnd(14)}  ${who(m.name, m.uuid)} · seit ${formatDate(m.addedAt)} (von ${by}) · ${twoFactor}`);
  }
  return 0;
}

function resetTeam2fa(store: Store, args: readonly string[], io: AdminOutput): number {
  const user = existingUser(store, args[0], 'team-2fa-reset <name|uuid>', io);
  if (typeof user === 'number') return user;
  if (!store.getTeamMember(user.uuid)) {
    io.err(`${who(user.name, user.uuid)} ist nicht im Team.`);
    return 1;
  }
  store.resetTotp(user.uuid);
  writeAudit(store, CLI_ACTOR, 'team.reset-2fa', playerLabel(user.name, user.uuid));
  io.out(`Die Zwei-Faktor-Anmeldung von ${who(user.name, user.uuid)} ist zurückgesetzt. Beim nächsten Besuch richtet er sie neu ein.`);
  return 0;
}

if (require.main === module) {
  const dataDir = path.resolve(process.env.HELDIX_DIENST_DATA?.trim() || './data');
  try {
    process.exitCode = runAdmin(process.argv.slice(2), dataDir, {
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } catch (err) {
    console.error(`Fehler: ${(err as Error)?.message ?? String(err)}`);
    process.exitCode = 1;
  }
}
