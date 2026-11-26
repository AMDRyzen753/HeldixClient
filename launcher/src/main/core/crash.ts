// Absturz-Hilfe: Nach einem Absturz liest der Launcher Crash-Report, JVM-Fehlerprotokoll (hs_err_pid*.log) und das
// Ende des Logs, erkennt häufige Ursachen und schlägt passende Schritte vor. Nichts davon verlässt den PC, bis der
// Spieler ausdrücklich „An den Support senden“ wählt – dann nur, was er vorher gesehen hat, mit ~ statt Benutzerordner.

import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CrashAction, CrashAnalysis, CrashKind } from '../../shared/api';

/** Ein installierter Mod (für „welcher Mod war es?“) */
export interface CrashModInfo {
  /** Dateiname im mods-Ordner */
  file: string;
  id: string | null;
  name: string;
}

export interface CrashInput {
  instanceId: string;
  instanceName: string;
  gameDir: string;
  /** Start des Spiels (ms): nur Berichte, die danach entstanden sind */
  startedAt: number;
  exitCode: number | null;
  /** letzte Zeilen der Spielausgabe aus dem Launcher */
  logLines: string[];
  /** eingeschaltete Mods der Instanz */
  mods: CrashModInfo[];
  /** Arbeitsspeicher, mit dem gestartet wurde (MB) */
  memoryMb: number;
  graphicsApi: string;
  /** eigener Java-Pfad in den Einstellungen */
  customJava: boolean;
}

/** Was zur Analyse gehört (für die Vorschau und das Senden an den Support) */
export interface CrashFiles {
  crashReport: string | null;
  crashReportPath: string | null;
  jvmError: string | null;
  jvmErrorPath: string | null;
  log: string;
}

const MAX_READ = 2 * 1024 * 1024;
const LOG_TAIL_LINES = 1500;

async function readLimited(file: string, max = MAX_READ): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, max);
    const buffer = Buffer.alloc(length);
    // große Dateien: das Ende lesen (dort steht der Fehler)
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** neueste Datei in dir, die zu pattern passt und nach since geändert wurde */
async function newestFile(dir: string, pattern: RegExp, since: number): Promise<string | null> {
  let best: { file: string; mtime: number } | null = null;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!pattern.test(name)) continue;
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.mtimeMs < since - 5000) continue;
    if (!best || info.mtimeMs > best.mtime) best = { file, mtime: info.mtimeMs };
  }
  return best?.file ?? null;
}

export async function collectCrashFiles(input: Pick<CrashInput, 'gameDir' | 'startedAt' | 'logLines'>): Promise<CrashFiles> {
  const crashReportPath = await newestFile(path.join(input.gameDir, 'crash-reports'), /^crash-.+\.txt$/, input.startedAt);
  const jvmErrorPath = await newestFile(input.gameDir, /^hs_err_pid\d+\.log$/, input.startedAt);
  const latest = path.join(input.gameDir, 'logs', 'latest.log');
  const latestInfo = await stat(latest).catch(() => null);
  let log = '';
  if (latestInfo && latestInfo.mtimeMs >= input.startedAt - 5000) log = await readLimited(latest).catch(() => '');
  if (!log.trim()) log = input.logLines.join('\n');
  const lines = log.split(/\r?\n/);
  if (lines.length > LOG_TAIL_LINES) log = lines.slice(-LOG_TAIL_LINES).join('\n');
  return {
    crashReport: crashReportPath ? await readLimited(crashReportPath).catch(() => null) : null,
    crashReportPath,
    jvmError: jvmErrorPath ? await readLimited(jvmErrorPath, 256 * 1024).catch(() => null) : null,
    jvmErrorPath,
    log,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Welcher Mod? Pakete der Mod-JARs, um Stacktraces zuzuordnen
// ---------------------------------------------------------------------------------------------------------

/** Pakete, die nie einem Mod zugeordnet werden (Java, Minecraft, Loader, Bibliotheken) */
const IGNORED_PACKAGES = [
  'java.', 'javax.', 'jdk.', 'sun.', 'com.sun.', 'net.minecraft.', 'com.mojang.', 'org.lwjgl.', 'net.fabricmc.',
  'org.spongepowered.', 'org.objectweb.', 'it.unimi.', 'com.google.', 'io.netty.', 'org.apache.', 'org.slf4j.', 'kotlin.',
  'dev.heldixclient.loader.', 'oshi.', 'org.joml.', 'com.llamalad7.',
];

const packageCache = new Map<string, { key: string; packages: string[] }>();

/** bis zu 40 Paket-Präfixe (3 Ebenen) einer JAR */
async function jarPackages(file: string): Promise<string[]> {
  const info = await stat(file).catch(() => null);
  if (!info) return [];
  const key = `${info.size}:${info.mtimeMs}`;
  const cached = packageCache.get(file);
  if (cached?.key === key) return cached.packages;
  const packages = new Set<string>();
  try {
    for (const entry of new AdmZip(file).getEntries()) {
      if (!entry.entryName.endsWith('.class') || entry.entryName.startsWith('META-INF/')) continue;
      const parts = entry.entryName.split('/').slice(0, -1);
      if (parts.length < 2) continue;
      packages.add(`${parts.slice(0, Math.min(3, parts.length)).join('.')}.`);
      if (packages.size >= 40) break;
    }
  } catch {
    // kaputte JAR: keine Zuordnung
  }
  const list = [...packages].filter((p) => !IGNORED_PACKAGES.some((ignored) => p.startsWith(ignored)));
  packageCache.set(file, { key, packages: list });
  return list;
}

/** Mods, deren Pakete in den obersten Zeilen der Stacktraces vorkommen (häufigste zuerst) */
async function modsInStack(text: string, modsDir: string, mods: CrashModInfo[]): Promise<CrashModInfo[]> {
  const frames = [...text.matchAll(/^\s+at ([\w$.]+)\.[\w$<>]+\(/gm)].slice(0, 80).map((m) => `${m[1]}.`);
  if (frames.length === 0) return [];
  const hits = new Map<CrashModInfo, number>();
  for (const mod of mods) {
    const packages = await jarPackages(path.join(modsDir, mod.file));
    if (packages.length === 0) continue;
    const count = frames.filter((frame) => packages.some((p) => frame.startsWith(p))).length;
    if (count > 0) hits.set(mod, count);
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([mod]) => mod);
}

function findMod(mods: CrashModInfo[], idOrName: string): CrashModInfo | null {
  const key = idOrName.toLowerCase();
  return mods.find((m) => m.id?.toLowerCase() === key) ?? mods.find((m) => m.name.toLowerCase() === key) ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------------------------------------

const DRIVERS: [RegExp, string][] = [
  [/nvoglv(32|64)\.dll|nvwgf2umx|nvlddmkm|nvd3dumx|libnvidia/i, 'NVIDIA'],
  [/atio6axx\.dll|atioglxx\.dll|amdvlk(32|64)\.dll|amdxx|aticfx/i, 'AMD'],
  [/ig[0-9a-z]*icd(32|64)\.dll|igxelpicd|igvk64|iris_dri|i965_dri/i, 'Intel'],
];

/** „Description: …“ aus dem Crash-Report */
function crashDescription(report: string | null): string | null {
  const match = report ? /^Description: (.+)$/m.exec(report) : null;
  return match ? match[1].trim().slice(0, 200) : null;
}

/** erste Ausnahme mit erster eigener Zeile, z. B. „java.lang.NullPointerException: … (at foo.Bar.baz)“ */
function exceptionLine(text: string): string {
  const match = /^((?:[\w$]+\.)+[\w$]*(?:Exception|Error)(?:: [^\r\n]{0,160})?)\r?\n\s+at ([^\r\n]{0,140})/m.exec(text);
  if (match) return `${match[1]} (at ${match[2]})`.slice(0, 300);
  const plain = /^((?:[\w$]+\.)+[\w$]*(?:Exception|Error)(?:: [^\r\n]{0,160})?)/m.exec(text);
  return plain ? plain[1].slice(0, 300) : '';
}

export async function analyzeCrash(input: CrashInput, files?: CrashFiles): Promise<{ analysis: CrashAnalysis; files: CrashFiles }> {
  const collected = files ?? (await collectCrashFiles(input));
  const report = collected.crashReport ?? '';
  const jvm = collected.jvmError ?? '';
  const corpus = `${report}\n${jvm}\n${collected.log}`;
  const modsDir = path.join(input.gameDir, 'mods');
  const suspects: CrashModInfo[] = [];
  const addSuspect = (mod: CrashModInfo | null) => {
    if (mod && !suspects.includes(mod)) suspects.push(mod);
  };
  const actions: CrashAction[] = [];
  let kind: CrashKind = 'unknown';
  let title = 'Minecraft ist abgestürzt';
  let explanation = '';

  // Fabric nennt verdächtige Mods selbst („Suspected Mod(s): Name (id), Version: …“)
  const suspectedBlock = /Suspected Mods?:\s*([\s\S]{0,800}?)(?:\r?\n\s*\r?\n|Stacktrace:)/i.exec(report);
  if (suspectedBlock) {
    for (const m of suspectedBlock[1].matchAll(/\(([a-z0-9_-]+)\)/gi)) addSuspect(findMod(input.mods, m[1]));
  }

  const gb = (input.memoryMb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  if (/java\.lang\.OutOfMemoryError|Out of memory/i.test(corpus)) {
    kind = 'memory';
    title = 'Zu wenig Arbeitsspeicher';
    explanation = `Minecraft hatte mit ${gb} GB nicht genug Arbeitsspeicher. Viele Mods, Shaderpacks oder eine hohe Sichtweite brauchen mehr.`;
    actions.push({ kind: 'raise-memory', label: 'Mehr Arbeitsspeicher geben' });
  } else if (/Could not reserve enough space for|Invalid maximum heap size|Initial heap size set to a larger value|exceeds the maximum representable size/i.test(corpus)) {
    kind = 'memory-too-high';
    title = 'Arbeitsspeicher zu hoch eingestellt';
    explanation = `Java konnte die eingestellten ${gb} GB nicht reservieren. Stell etwas weniger ein – meist reichen 4 bis 6 GB.`;
    actions.push({ kind: 'lower-memory', label: 'Arbeitsspeicher anpassen' });
  } else if (/UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime/i.test(corpus)) {
    kind = 'java-version';
    title = 'Falsche Java-Version';
    explanation = input.customJava
      ? 'Der eingestellte Java-Pfad passt nicht zu dieser Minecraft-Version oder zu einem Mod. Lass das Feld leer, dann nimmt der Launcher automatisch das passende Java.'
      : 'Ein Mod braucht eine neuere Java-Version, als diese Minecraft-Version mitbringt. Prüfe, ob der Mod zu dieser Version passt.';
    if (input.customJava) actions.push({ kind: 'reset-java', label: 'Automatisches Java nutzen' });
  } else if (/No space left on device|There is not enough space on the disk|Nicht genügend Speicherplatz/i.test(corpus)) {
    kind = 'disk-full';
    title = 'Festplatte voll';
    explanation = 'Auf dem Laufwerk ist kein Platz mehr. Gib etwas Speicher frei und starte erneut.';
  } else {
    const driver = DRIVERS.find(([re]) => re.test(jvm) || /EXCEPTION_ACCESS_VIOLATION/.test(jvm) && re.test(report + collected.log));
    if (jvm && driver) {
      kind = 'graphics-driver';
      title = `Grafiktreiber abgestürzt (${driver[1]})`;
      explanation = `Der Absturz passierte im Grafiktreiber von ${driver[1]}, nicht in Minecraft. Meist hilft ein aktueller Treiber vom Hersteller.${input.graphicsApi === 'vulkan' ? ' Läuft es danach immer noch nicht, stell die Grafik-API auf OpenGL.' : ''}`;
      actions.push({ kind: 'help', label: 'Treiber aktualisieren – so geht’s', help: 'grafikprobleme' });
      if (input.graphicsApi === 'vulkan') actions.push({ kind: 'use-opengl', label: 'Auf OpenGL umstellen' });
    } else if (/Pixel format not accelerated|does not appear to support OpenGL|GLFW error 65542|GLFW error 65543|No OpenGL context|WGL: The driver/i.test(corpus)) {
      kind = 'opengl';
      title = 'Grafikkarte oder Treiber unterstützt OpenGL nicht';
      explanation = 'Minecraft konnte kein OpenGL-Fenster öffnen. Das liegt fast immer an einem fehlenden oder veralteten Grafiktreiber (oder an der falschen Grafikkarte bei Laptops).';
      actions.push({ kind: 'help', label: 'Treiber aktualisieren – so geht’s', help: 'grafikprobleme' });
    } else if (/Incompatible mods? (found|set)|Mod resolution encountered an incompatible mod set|requires (any )?version .* of .*, which is missing/i.test(corpus)) {
      kind = 'mod-dependency';
      title = 'Mods passen nicht zusammen';
      explanation = 'Ein Mod braucht einen anderen Mod (oder eine andere Version davon), der fehlt oder nicht passt. Die Liste unten zeigt, welche Mods betroffen sind.';
      for (const m of corpus.matchAll(/Mod '([^']+)' \(([a-z0-9_-]+)\)/gi)) addSuspect(findMod(input.mods, m[2]) ?? findMod(input.mods, m[1]));
    } else if (/Mixin (apply|transformation) .*failed|MixinApplyError|InvalidInjectionException|InjectionError|Mixin \[[^\]]+\] from mod (\w+)/i.test(corpus)) {
      kind = 'mod-conflict';
      title = 'Mod-Konflikt';
      explanation = 'Zwei Mods verändern dieselbe Stelle im Spiel und vertragen sich nicht – oder ein Mod passt nicht zu dieser Minecraft-Version.';
      for (const m of corpus.matchAll(/from mod ([a-z0-9_-]+)/gi)) addSuspect(findMod(input.mods, m[1]));
      for (const m of corpus.matchAll(/Mixin \[([a-z0-9_-]+)\.mixins?\.json/gi)) addSuspect(findMod(input.mods, m[1]));
    } else if (/ShaderCompileException|Failed to (compile|create) shader|shaderpack|net\.irisshaders\.iris.*Exception/i.test(report || collected.log.slice(-20000))
      && /iris|shaderpack/i.test(corpus)) {
      kind = 'shaderpack';
      title = 'Shaderpack macht Probleme';
      explanation = 'Das aktive Shaderpack ließ sich nicht laden. Probiere ein anderes Shaderpack oder schalte es aus.';
      actions.push({ kind: 'shaders', label: 'Shaderpacks öffnen' });
    } else if (/(NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|ClassNotFoundException|AbstractMethodError|IncompatibleClassChangeError)/.test(corpus)) {
      kind = 'mod-incompatible';
      title = 'Ein Mod passt nicht zu dieser Version';
      explanation = 'Ein Mod ruft etwas auf, das es in dieser Minecraft- oder Mod-Version nicht gibt. Meist hilft die passende Version des Mods (oder ihn auszuschalten).';
    } else if (/Exception (in server tick loop|ticking (world|entity|block entity))|Ticking (entity|block entity)/i.test(corpus)) {
      kind = 'world';
      title = 'Fehler in der Welt';
      explanation = 'Der Absturz passierte beim Berechnen der Welt (Entity, Block oder Weltgenerierung). Oft steckt ein Mod dahinter; selten ist die Welt beschädigt.';
    } else if (/^\s+at dev\.heldixclient\.(?!loader\.)/m.test(report)) {
      kind = 'heldixclient';
      title = 'Fehler in HeldixClient';
      explanation = 'Der Absturz kam aus HeldixClient selbst. Das ist unser Fehler – bitte schick ihn an den Support, dann beheben wir ihn.';
    }
  }

  // Mods aus dem Stacktrace (außer bei Ursachen, die sicher kein Mod sind)
  if (!['memory', 'memory-too-high', 'disk-full', 'graphics-driver', 'opengl', 'java-version'].includes(kind) && input.mods.length > 0) {
    for (const mod of await modsInStack(report || collected.log.slice(-60000), modsDir, input.mods)) addSuspect(mod);
  }
  if (suspects.length > 0 && kind === 'unknown') {
    kind = 'mod-incompatible';
    title = suspects.length === 1 ? `Absturz durch ${suspects[0].name}` : 'Absturz durch einen Mod';
    explanation = 'Der Fehler steckt sehr wahrscheinlich in einem Mod. Schalte ihn testweise aus oder lade eine passende Version.';
  }
  for (const mod of suspects.slice(0, 3)) actions.push({ kind: 'disable-mod', label: `${mod.name} ausschalten`, file: mod.file });

  const description = crashDescription(collected.crashReport);
  if (kind === 'unknown') {
    explanation = description
      ? `Minecraft meldet: „${description}“. Eine bekannte Ursache hat der Launcher nicht gefunden – der Support hilft gern weiter.`
      : input.exitCode !== null
        ? `Minecraft hat sich mit Fehlercode ${input.exitCode} beendet. Eine bekannte Ursache hat der Launcher nicht gefunden – der Support hilft gern weiter.`
        : 'Eine bekannte Ursache hat der Launcher nicht gefunden – der Support hilft gern weiter.';
  }
  if (collected.crashReportPath) actions.push({ kind: 'open-report', label: 'Crash-Report öffnen' });
  actions.push({ kind: 'open-logs', label: 'Logs-Ordner öffnen' });

  return {
    analysis: {
      id: randomUUID(),
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      at: Date.now(),
      exitCode: input.exitCode,
      kind,
      title,
      explanation,
      suspects: suspects.map((m) => ({ name: m.name, id: m.id, file: m.file })),
      actions,
      description,
      detail: exceptionLine(report || jvm || collected.log.slice(-60000)),
      hasCrashReport: collected.crashReportPath !== null,
      hasJvmError: collected.jvmErrorPath !== null,
    },
    files: collected,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Für den Support: Benutzerordner und Zugangsdaten entfernen
// ---------------------------------------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ersetzt den Benutzerordner durch ~ und entfernt alles, was nach Token aussieht. */
export function anonymize(text: string, home = os.homedir()): string {
  let out = text;
  const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')]);
  for (const variant of variants) {
    if (variant.length > 3) out = out.replace(new RegExp(escapeRegExp(variant), 'gi'), '~');
  }
  // andere Benutzerordner (z. B. in Pfaden von Java-Installationen)
  out = out.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\r\n"']+/gi, '$1~');
  out = out.replace(/(\/(?:home|Users)\/)[^/\r\n"']+/g, '$1~');
  // Zugangsdaten: Minecraft-/Microsoft-Tokens (JWT), --accessToken, Session-IDs
  out = out.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '<entfernt>');
  out = out.replace(/(--accessToken|--session|accessToken[=:])\s*\S+/gi, '$1 <entfernt>');
  out = out.replace(/(token:)[0-9a-f-]{20,}/gi, '$1<entfernt>');
  return out;
}

/** Ende eines Texts mit höchstens max Zeichen (ganze Zeilen) */
export function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const newline = cut.indexOf('\n');
  return newline >= 0 ? cut.slice(newline + 1) : cut;
}

