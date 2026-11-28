// Prüft den Launcher im Hintergrund (core/background.ts) und die Anzeige von Tastenkürzeln (renderer/keys.ts):
// gemeinsamer Zähler für Taskleiste und Dock, das gezeichnete Overlay-Abzeichen, Schließen in den Infobereich, Ende
// des Spiels, Autostart mit --hidden, Blinken, Dock-Menü, die Einstellung „Im Hintergrund bereit für Nachrichten“
// samt Übernahme alter Einstellungen und „⌘“ statt „Strg+“ auf dem Mac. Ohne Fenster, ohne Netz.
//
// Aufruf: npm run test:background

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
  HIDDEN_FLAG,
  afterGameAction,
  attentionCount,
  badgeDescription,
  badgePng,
  badgeRgba,
  badgeText,
  closeAction,
  dockBadgeText,
  loginItemSettings,
  recentInstances,
  shouldFlash,
  startedHidden,
  startWithSystemLabel,
  trayHint,
} from '../main/core/background';
import { Store } from '../main/store';
import { check, finish } from './testkit';

function overview(unread: number, incoming: number, status = 'online') {
  return { status, unread, incoming: Array.from({ length: incoming }, (_, i) => ({ uuid: String(i) })) };
}

/** PNG lesen (nur das, was badgePng schreibt: RGBA, Filter 0) */
function readPng(png: Buffer): { width: number; height: number; rgba: Buffer } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let offset = 8;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (type === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  return { width, height, rgba };
}

async function main(): Promise<void> {
  // ---------- Zähler ----------
  check('Zähler: Nachrichten + Anfragen', attentionCount(overview(3, 2)) === 5);
  check('Zähler: nicht verbunden → 0', attentionCount(overview(3, 2, 'error')) === 0 && attentionCount(null) === 0);
  check('Overlay-Text: 0 → nichts, 7 → „7“, 12 → „9+“', badgeText(0) === '' && badgeText(7) === '7' && badgeText(9) === '9' && badgeText(12) === '9+');
  check('Dock-Text: bis 99, darüber „99+“', dockBadgeText(0) === '' && dockBadgeText(42) === '42' && dockBadgeText(150) === '99+');
  check('Beschreibung fürs Overlay', badgeDescription(overview(1, 2)) === '1 ungelesene Nachricht, 2 Freundschaftsanfragen' && badgeDescription(overview(0, 0)) === '');

  // ---------- Overlay-Abzeichen ----------
  for (const [text, size] of [['3', 16], ['9+', 16], ['9+', 32]] as const) {
    const png = badgePng(text, size);
    const image = readPng(png);
    const pixel = (x: number, y: number) => image.rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4);
    const white = [...Array(size * size).keys()].filter((i) => image.rgba[i * 4] === 255 && image.rgba[i * 4 + 1] === 255 && image.rgba[i * 4 + 3] === 255).length;
    check(`Abzeichen „${text}“ ${size} px: PNG ${size}×${size}`, png.readUInt32BE(0) === 0x89504e47 && image.width === size && image.height === size);
    check(`Abzeichen „${text}“ ${size} px: Ecke durchsichtig, Rand rot, Ziffern weiß`, pixel(0, 0)[3] === 0 && pixel(1, Math.floor(size / 2))[0] === 229 && pixel(1, Math.floor(size / 2))[3] > 100 && white > 5, `${white} weiße Pixel`);
  }
  check('Abzeichen: gleiche Eingabe → gleiche Pixel', badgeRgba('5', 16).equals(badgeRgba('5', 16)) && !badgeRgba('5', 16).equals(badgeRgba('6', 16)));

  // ---------- Schließen und Ende des Spiels ----------
  const close = (platform: NodeJS.Platform, background: boolean, gameRunning: boolean, quitting = false) => closeAction({ platform, background, gameRunning, quitting });
  check('Schließen (Windows, an, ohne Spiel) → Infobereich', close('win32', true, false) === 'tray');
  check('Schließen (Windows, an, mit Spiel) → Infobereich', close('win32', true, true) === 'tray');
  check('Schließen (Windows, aus) → beenden, auch während eines Spiels', close('win32', false, false) === 'close' && close('win32', false, true) === 'close');
  check('Schließen beim Beenden/Update → wirklich schließen', close('win32', true, true, true) === 'close');
  check('Schließen (Mac, ohne Spiel) → Fenster zu, App bleibt im Dock', close('darwin', true, false) === 'close');
  check('Schließen (Mac, mit Spiel) → Menüleiste', close('darwin', true, true) === 'tray');
  const after = (platform: NodeJS.Platform, closedToTray: boolean, problem: boolean, quitting = false) => afterGameAction({ platform, closedToTray, problem, quitting });
  check('Spielende: Fenster war offen → nichts Besonderes', after('win32', false, false) === 'none');
  check('Spielende: im Infobereich → bleibt dort (Windows)', after('win32', true, false) === 'stay');
  check('Spielende: im Infobereich nach Absturz → Fenster mit Absturz-Hilfe', after('win32', true, true) === 'show');
  check('Spielende: Mac → Menüleisten-Symbol weg, App bleibt im Dock', after('darwin', true, false) === 'dock');
  check('Spielende beim Beenden → nichts', after('win32', true, true, true) === 'none');
  const hint = trayHint('win32', 'HeldixClient');
  check('Hinweis Windows: läuft im Infobereich weiter, Beenden per Rechtsklick', /Infobereich weiter/.test(hint.title) && /Rechtsklick auf das Symbol → Beenden/.test(hint.body));
  check('Hinweis Mac: Menüleiste und ⌘Q', /Menüleiste/.test(trayHint('darwin', 'HeldixClient').body) && /⌘Q/.test(trayHint('darwin', 'HeldixClient').body));

  // ---------- Autostart ----------
  check('Autostart Windows: Run-Eintrag mit --hidden', JSON.stringify(loginItemSettings(true, 'win32', 'C:\\X\\HeldixClient.exe')) === JSON.stringify({ openAtLogin: true, path: 'C:\\X\\HeldixClient.exe', args: [HIDDEN_FLAG], name: 'HeldixClient' }));
  check('Autostart Windows aus: gleicher Eintrag mit openAtLogin false (wird entfernt)', loginItemSettings(false, 'win32', 'C:\\X\\HeldixClient.exe')?.openAtLogin === false && loginItemSettings(false, 'win32', 'x')?.args?.[0] === HIDDEN_FLAG);
  check('Autostart Mac: bei der Anmeldung öffnen', JSON.stringify(loginItemSettings(true, 'darwin', '/Applications/HeldixClient.app/Contents/MacOS/HeldixClient')) === JSON.stringify({ openAtLogin: true }));
  check('Autostart Linux: nicht unterstützt', loginItemSettings(true, 'linux', '/x') === null);
  check('Unsichtbar gestartet: --hidden bzw. Mac bei der Anmeldung', startedHidden(['x.exe', HIDDEN_FLAG], 'win32') && !startedHidden(['x.exe'], 'win32', true) && startedHidden(['x'], 'darwin', true) && !startedHidden(['x'], 'darwin'));
  check('Bezeichnung: „Mit Windows starten“ bzw. „Bei der Anmeldung starten“', startWithSystemLabel('win32') === 'Mit Windows starten' && startWithSystemLabel('darwin') === 'Bei der Anmeldung starten');

  // ---------- Blinken und Dock-Menü ----------
  const flash = (patch: Partial<Parameters<typeof shouldFlash>[0]>) => shouldFlash({ kind: 'message', focused: false, visible: true, doNotDisturb: false, heldixGame: false, ...patch });
  check('Blinken: neue Nachricht, Fenster im Hintergrund', flash({}));
  check('Blinken: nicht bei Fenster im Vordergrund, im Infobereich, „Nicht stören“, im Spiel oder bei Anfragen',
    !flash({ focused: true }) && !flash({ visible: false }) && !flash({ doNotDisturb: true }) && !flash({ heldixGame: true }) && !flash({ kind: 'request' }));
  const recent = recentInstances([
    { id: 'a', name: 'A', lastPlayed: 10 }, { id: 'b', name: 'B', lastPlayed: null }, { id: 'c', name: 'C', lastPlayed: 30 },
    { id: 'd', name: 'D', lastPlayed: 20 }, { id: 'e', name: 'E', lastPlayed: 5 }, { id: 'f', name: 'F', lastPlayed: 1 }, { id: 'g', name: 'G', lastPlayed: 2 },
  ]);
  check('Dock-Menü: höchstens 5 zuletzt gespielte, neueste zuerst, nie gespielte fehlen', recent.map((i) => i.id).join('') === 'cdaeg');

  // ---------- Einstellungen: Standard und alte Dateien ----------
  const dir = await mkdtemp(path.join(os.tmpdir(), 'heldix-hintergrund-'));
  try {
    let settings = await new Store(dir).getSettings();
    check('Einstellung neu: im Hintergrund an, Autostart aus, Hinweis noch nicht gezeigt', settings.closeToTray && !settings.startWithSystem && !settings.trayHintSeen);
    await writeFile(path.join(dir, 'launcher-settings.json'), JSON.stringify({ closeToTray: false, memoryMb: 4096 }));
    settings = await new Store(dir).getSettings();
    check('Übernahme: „Beim Schließen in den Infobereich“ bewusst aus → auch das Neue aus', settings.closeToTray === false && settings.startWithSystem === false);
    await writeFile(path.join(dir, 'launcher-settings.json'), JSON.stringify({ closeToTray: true }));
    check('Übernahme: war an (Standard) → an', (await new Store(dir).getSettings()).closeToTray === true);
    await writeFile(path.join(dir, 'launcher-settings.json'), JSON.stringify({ startWithSystem: 'ja', trayHintSeen: 1 }));
    settings = await new Store(dir).getSettings();
    check('Übernahme: ungültige Werte → Standard', settings.startWithSystem === false && settings.trayHintSeen === false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // ---------- Tastenkürzel (renderer/keys.ts, ES-Modul der Oberfläche) ----------
  // nur als Typ beschrieben: renderer/keys.ts gehört zur Oberfläche (eigenes tsconfig, ES-Modul)
  interface Keys {
    shortcut(key: string, modifiers: { shift?: boolean; alt?: boolean; control?: boolean; plain?: boolean }, platform: string): string;
    shortcutClick(platform: string): string;
    modifierKey(platform: string): string;
    altKey(platform: string): string;
    shortcutPressed(event: { ctrlKey: boolean; metaKey: boolean }, platform: string): boolean;
  }
  const keys = (await import(pathToFileURL(path.join(__dirname, '..', 'renderer', 'keys.js')).href)) as Keys;
  check('Kürzel Windows: „Strg+1“, „Strg+Umschalt+Z“, „Alt+F4“', keys.shortcut('1', {}, 'win32') === 'Strg+1' && keys.shortcut('Z', { shift: true }, 'win32') === 'Strg+Umschalt+Z' && keys.shortcut('F4', { alt: true, plain: true }, 'win32') === 'Alt+F4');
  check('Kürzel Mac: „⌘1“, „⇧⌘Z“, „⌥⌘K“, „⌃Tab“', keys.shortcut('1', {}, 'darwin') === '⌘1' && keys.shortcut('Z', { shift: true }, 'darwin') === '⇧⌘Z' && keys.shortcut('K', { alt: true }, 'darwin') === '⌥⌘K' && keys.shortcut('Tab', { control: true }, 'darwin') === '⌃Tab');
  check('Klick und Tasten: „Strg+Klick“/„⌘-Klick“, „Strg“/„⌘“, „Alt“/„⌥“', keys.shortcutClick('win32') === 'Strg+Klick' && keys.shortcutClick('darwin') === '⌘-Klick'
    && keys.modifierKey('darwin') === '⌘' && keys.modifierKey('win32') === 'Strg' && keys.altKey('darwin') === '⌥' && keys.altKey('win32') === 'Alt');
  check('Kürzel gedrückt: Mac ⌘, sonst Strg', keys.shortcutPressed({ ctrlKey: false, metaKey: true }, 'darwin') && !keys.shortcutPressed({ ctrlKey: true, metaKey: false }, 'darwin') && keys.shortcutPressed({ ctrlKey: true, metaKey: false }, 'win32'));

  finish('Hintergrund');
}

void main();
