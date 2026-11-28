// Update beim Start des Launchers – die Entscheidungen als reine Funktionen (getestet in scripts/test-update.ts);
// Fenster und Ablauf stehen in main.ts, Prüfen, Laden und Installieren in core/updater.ts.
//
// Ablauf (fertige App, Windows und ab 0.14.0 macOS, Einstellung „Updates automatisch“ an):
//   1. Startfenster „Suche nach Updates …“, GET /v1/launcher/latest mit kurzer Zeitgrenze (STARTUP_CHECK_TIMEOUT_MS).
//      Offline, Fehler oder Zeitüberschreitung: normal starten (nur Log und Einstellungen zeigen den Fehler).
//   2. Neue Version: laden (ein geprüfter Installer im Update-Ordner wird wiederverwendet), prüfen, still installieren
//      (Windows: installerArgs(true) = /S --updated --force-run; Mac: ZIP entpacken, Skript tauscht die App aus,
//      core/mac-update.ts), der Launcher beendet sich sofort, Installer bzw. Skript startet ihn neu.
//   3. Nicht installiert wird, wenn noch ein Spiel aus einer früheren Sitzung läuft (game-running.json) oder derselbe
//      Installationsversuch vor Kurzem schon einmal lief (update-start.json, sonst Schleife bei einem kaputten
//      Installer) – dann normal starten, später erneut (Hinweis „Jetzt neu starten“ oder beim Beenden).
// „Updates automatisch“ aus, unsichtbarer Start (--hidden, Autostart) oder ein System ohne Selbst-Update (Mac aus dem
// DMG, ohne Schreibrechte, Linux – selfUpdate false): kein Startfenster, die Prüfung läuft gleich im Hintergrund, eine
// neue Version zeigt nur einen Hinweis („Jetzt installieren“ bzw. Download über die Webseite).

import { readFile, rm, writeFile } from 'node:fs/promises';
import { compareVersions, type UpdatePhase } from './updater';

/** Zeitgrenze für die Prüfung im Startfenster */
export const STARTUP_CHECK_TIMEOUT_MS = 3500;
/** Kommt beim Laden im Startfenster so lange kein Fortschritt, startet der Launcher normal (das Laden läuft weiter) */
export const STARTUP_STALL_MS = 20_000;
/** Ist ein Installationsversuch derselben Version so kurz her, installiert der Start nicht noch einmal automatisch */
export const RETRY_INSTALL_AFTER_MS = 6 * 60 * 60_000;
/** Marker eines laufenden Spiels gilt höchstens so lange (danach ist die PID sicher eine andere) */
export const GAME_MARKER_MAX_MS = 24 * 60 * 60_000;

/** Dateien im Datenordner (paths.root) */
export const UPDATE_MEMO_FILE = 'update-start.json';
export const GAME_MARKER_FILE = 'game-running.json';

// ---------- Plan und Entscheidung ----------

/** off = gar nicht prüfen; splash = vor dem Hauptfenster prüfen und ggf. installieren; background = nur Hinweis */
export type StartupPlan = 'off' | 'splash' | 'background';

/** Ersetzt sich die App selbst? Ohne Angabe: nur Windows (der Mac sagt es ab 0.14.0 ausdrücklich, siehe main.ts) */
export function selfUpdates(input: { platform: NodeJS.Platform; selfUpdate?: boolean }): boolean {
  return input.selfUpdate ?? input.platform === 'win32';
}

export function startupPlan(input: { enabled: boolean; platform: NodeJS.Platform; autoUpdate: boolean; selfUpdate?: boolean; hidden?: boolean }): StartupPlan {
  if (!input.enabled) return 'off';
  if (!selfUpdates(input) || !input.autoUpdate || input.hidden) return 'background';
  return 'splash';
}

export interface InstallAttempt {
  version: string;
  at: number;
}

export type StartupDecision =
  /** normal starten; current = nichts Neues, error = offline/Fehler/Zeitgrenze, game = Spiel läuft, retry-later = Versuch eben fehlgeschlagen */
  | { action: 'start'; reason: 'current' | 'error' | 'game' | 'retry-later' }
  /** nur Hinweis: install = „Jetzt installieren“ (Einstellung aus), download = Download über die Webseite (kein Selbst-Update) */
  | { action: 'notify'; reason: 'install' | 'download' }
  /** laden (falls nötig), still installieren, neu starten */
  | { action: 'install' };

export interface StartupInput {
  platform: NodeJS.Platform;
  /** ersetzt sich die App selbst (Standard: nur Windows), siehe selfUpdates */
  selfUpdate?: boolean;
  autoUpdate: boolean;
  /** Stand nach der Prüfung */
  state: { phase: UpdatePhase; version?: string };
  /** Spiel aus einer früheren Sitzung läuft noch */
  gameRunning: boolean;
  /** letzter Installationsversuch (update-start.json) */
  attempt: InstallAttempt | null;
  now: number;
}

/** Derselbe Installationsversuch lief vor Kurzem schon (und der Launcher ist noch auf der alten Version)? */
export function installRecentlyTried(attempt: InstallAttempt | null, version: string, now: number): boolean {
  return attempt !== null && attempt.version === version && attempt.at <= now && now - attempt.at < RETRY_INSTALL_AFTER_MS;
}

export function decideStartupUpdate(input: StartupInput): StartupDecision {
  const { phase, version } = input.state;
  if (phase === 'error') return { action: 'start', reason: 'error' };
  if ((phase !== 'available' && phase !== 'downloading' && phase !== 'ready') || !version) return { action: 'start', reason: 'current' };
  if (!selfUpdates(input)) return { action: 'notify', reason: 'download' };
  if (!input.autoUpdate) return { action: 'notify', reason: 'install' };
  if (input.gameRunning) return { action: 'start', reason: 'game' };
  if (installRecentlyTried(input.attempt, version, input.now)) return { action: 'start', reason: 'retry-later' };
  return { action: 'install' };
}

/** Texte im Startfenster */
export function splashText(state: { phase: UpdatePhase; version?: string; progress?: number }, installing = false): { title: string; progress: number | null } {
  if (installing) return { title: 'Wird installiert …', progress: null };
  if (state.phase === 'downloading' || state.phase === 'available') {
    const percent = Math.max(0, Math.min(100, Math.round((state.progress ?? 0) * 100)));
    return { title: `Update auf ${state.version} wird geladen … ${percent} %`, progress: state.progress ?? 0 };
  }
  if (state.phase === 'ready') return { title: `Update auf ${state.version} wird geladen … 100 %`, progress: 1 };
  if (state.phase === 'checking' || state.phase === 'idle') return { title: 'Suche nach Updates …', progress: null };
  return { title: 'HeldixClient wird gestartet …', progress: null };
}

// ---------- update-start.json: letzter Installationsversuch und Hinweise für „Neu in …“ ----------

export interface ReleaseNotes {
  version: string;
  date: string;
  notes: string[];
}

export interface UpdateMemo {
  attempt: InstallAttempt | null;
  /** Hinweise aus dem Manifest der installierten Version (falls der Dienst nach dem Neustart nicht antwortet) */
  notes: ReleaseNotes | null;
}

const isVersion = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    compareVersions(value, value);
    return true;
  } catch {
    return false;
  }
};

export function parseUpdateMemo(raw: unknown): UpdateMemo {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const a = r.attempt && typeof r.attempt === 'object' ? (r.attempt as Record<string, unknown>) : null;
  const n = r.notes && typeof r.notes === 'object' ? (r.notes as Record<string, unknown>) : null;
  return {
    attempt: a && isVersion(a.version) && typeof a.at === 'number' && Number.isFinite(a.at) ? { version: a.version, at: a.at } : null,
    notes: n && isVersion(n.version)
      ? {
          version: n.version,
          date: typeof n.date === 'string' ? n.date : '',
          notes: Array.isArray(n.notes) ? n.notes.filter((x): x is string => typeof x === 'string').slice(0, 30) : [],
        }
      : null,
  };
}

export async function readUpdateMemo(file: string): Promise<UpdateMemo> {
  try {
    return parseUpdateMemo(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return { attempt: null, notes: null };
  }
}

export async function writeUpdateMemo(file: string, memo: UpdateMemo): Promise<void> {
  if (!memo.attempt && !memo.notes) {
    await rm(file, { force: true }).catch(() => undefined);
    return;
  }
  await writeFile(file, JSON.stringify(memo, null, 2));
}

/** Nach dem Start der neuen Version: der Versuch ist erledigt (aktuelle Version ≥ versuchte) */
export function settleUpdateMemo(memo: UpdateMemo, current: string): UpdateMemo {
  if (!memo.attempt) return memo;
  try {
    return compareVersions(current, memo.attempt.version) >= 0 ? { ...memo, attempt: null } : memo;
  } catch {
    return { ...memo, attempt: null };
  }
}

// ---------- „Neu in …“ nach dem Update ----------

export interface WhatsNewResult {
  /** zu zeigen (null = nichts) */
  show: { version: string; entries: ReleaseNotes[] } | null;
  /** lastSeenVersion jetzt auf die aktuelle Version setzen (dann kommt die Anzeige nur einmal) */
  markSeen: boolean;
}

/**
 * Was „Neu in <Version>“ zeigt: alle Versionen nach der zuletzt gesehenen bis zur aktuellen aus dem Versionsverlauf
 * des Dienstes ({@code remote}, null = nicht erreichbar); fehlen die, die Hinweise aus dem Manifest der installierten
 * Version ({@code saved}). Erste Installation (lastSeen null): nichts zeigen, nur merken. Gezeigt wird einmal: Wer
 * etwas zeigt, merkt die Version gleich als gesehen. Dienst nicht erreichbar und nichts gespeichert: beim nächsten
 * Start noch einmal.
 */
export function pickWhatsNew(current: string, lastSeen: string | null, remote: ReleaseNotes[] | null, saved: ReleaseNotes | null): WhatsNewResult {
  if (!lastSeen) return { show: null, markSeen: true };
  const between = (version: string) => {
    try {
      return compareVersions(version, lastSeen) > 0 && compareVersions(version, current) <= 0;
    } catch {
      return false;
    }
  };
  try {
    if (compareVersions(current, lastSeen) <= 0) return { show: null, markSeen: false };
  } catch {
    return { show: null, markSeen: false };
  }
  let entries = (remote ?? []).filter((entry) => between(entry.version));
  if (!entries.some((entry) => entry.notes.length > 0) && saved && saved.version === current && saved.notes.length > 0) entries = [saved];
  if (entries.some((entry) => entry.notes.length > 0)) return { show: { version: current, entries }, markSeen: true };
  return { show: null, markSeen: remote !== null };
}

// ---------- Spiel aus einer früheren Sitzung ----------

export interface GameMarker {
  pid: number;
  startedAt: number;
}

export function parseGameMarker(raw: unknown): GameMarker | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0 || typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt)) return null;
  return { pid: r.pid, startedAt: r.startedAt };
}

/** Läuft der Prozess noch? (Signal 0 prüft nur; EPERM = läuft, gehört aber jemand anderem) */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Spiel aus einer früheren Sitzung läuft noch: Marker jünger als GAME_MARKER_MAX_MS und der Prozess lebt */
export function previousGameRunning(marker: GameMarker | null, now: number, alive: (pid: number) => boolean = processAlive): boolean {
  if (!marker || marker.startedAt > now + 60_000 || now - marker.startedAt > GAME_MARKER_MAX_MS) return false;
  return alive(marker.pid);
}

export async function readGameMarker(file: string): Promise<GameMarker | null> {
  try {
    return parseGameMarker(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}
