// Launcher im Hintergrund (ab 0.14.0) – die Entscheidungen als reine Funktionen (getestet in scripts/test-background.ts),
// Fenster, Infobereich, Dock und Taskleiste stehen in main.ts.
//
// - Zähler: ungelesene Nachrichten + offene Freundschaftsanfragen (attentionCount) – derselbe Zähler für das Overlay
//   in der Windows-Taskleiste (badgeText: 1–9, „9+“) und das Abzeichen im Dock (dockBadgeText).
// - Overlay-Symbol: kleines rundes Abzeichen mit Zahl als PNG, ohne weitere Bibliothek gezeichnet (badgePng).
// - Fenster schließen (closeAction): Einstellung „Im Hintergrund bereit für Nachrichten“ (closeToTray) an → Windows:
//   Launcher läuft im Infobereich weiter, auch ohne Spiel; macOS: wie gewohnt im Dock (während eines Spiels zusätzlich
//   das Symbol in der Menüleiste). Aus → das Fenster schließt den Launcher (ein laufendes Spiel läuft weiter).
// - Nach dem Spiel (afterGameAction): Launcher war im Infobereich → er bleibt dort (Windows) bzw. im Dock (Mac); nach
//   einem Absturz kommt das Fenster mit der Absturz-Hilfe.
// - Mit dem System starten (loginItemSettings): Windows-Autostart mit --hidden (kein Fenster, nur Infobereich), auf dem
//   Mac „Bei der Anmeldung öffnen“ (startedHidden erkennt beides).
// - Kurz blinken (shouldFlash): neue Nachricht, Fenster sichtbar, aber nicht im Vordergrund.

import zlib from 'node:zlib';

/** Befehlszeile des Autostarts: Launcher ohne Fenster, nur im Infobereich */
export const HIDDEN_FLAG = '--hidden';

// ---------- Zähler ----------

/** Ungelesene Nachrichten + offene Anfragen (nur verbunden; sonst 0) */
export function attentionCount(overview: { status: string; unread: number; incoming: readonly unknown[] } | null | undefined): number {
  if (!overview || overview.status !== 'online') return 0;
  const unread = Number.isFinite(overview.unread) ? Math.max(0, Math.floor(overview.unread)) : 0;
  return unread + overview.incoming.length;
}

/** Text im Overlay der Taskleiste: '' (nichts), 1–9 oder „9+“ */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 9 ? '9+' : String(Math.floor(count));
}

/** Abzeichen im Dock (macOS zeigt auch längere Texte): '' (nichts), bis 99, darüber „99+“ */
export function dockBadgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}

/** Beschreibung des Overlays für Screenreader */
export function badgeDescription(overview: { status: string; unread: number; incoming: readonly unknown[] } | null | undefined): string {
  if (!overview || overview.status !== 'online') return '';
  const parts: string[] = [];
  if (overview.unread > 0) parts.push(overview.unread === 1 ? '1 ungelesene Nachricht' : `${overview.unread} ungelesene Nachrichten`);
  if (overview.incoming.length > 0) parts.push(overview.incoming.length === 1 ? '1 Freundschaftsanfrage' : `${overview.incoming.length} Freundschaftsanfragen`);
  return parts.join(', ');
}

// ---------- Overlay-Symbol (PNG ohne Bibliothek) ----------

/** 5 × 7 Pixel je Zeichen (Ziffern und „+“) */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
};

/** Farbe des Abzeichens (Rot wie die Zähler in der Oberfläche) */
const BADGE_RGB = [229, 72, 77];

/**
 * Rundes Abzeichen mit Text als RGBA-Pixel (size × size, 4 Byte je Pixel): Kreis mit weichem Rand, Ziffern weiß
 * (Pixelschrift, ab 32 px doppelt so groß). Unbekannte Zeichen werden ausgelassen.
 */
export function badgeRgba(text: string, size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size / 2;
  const samples = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const dx = x + (sx + 0.5) / samples - radius;
          const dy = y + (sy + 0.5) / samples - radius;
          if (dx * dx + dy * dy <= radius * radius) inside++;
        }
      }
      const i = (y * size + x) * 4;
      pixels[i] = BADGE_RGB[0];
      pixels[i + 1] = BADGE_RGB[1];
      pixels[i + 2] = BADGE_RGB[2];
      pixels[i + 3] = Math.round((inside / (samples * samples)) * 255);
    }
  }
  const glyphs = [...text].map((c) => GLYPHS[c]).filter((g): g is string[] => !!g);
  if (glyphs.length === 0) return pixels;
  const scale = size >= 32 ? 2 : 1;
  const width = (glyphs.length * 5 + (glyphs.length - 1)) * scale;
  const height = 7 * scale;
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  glyphs.forEach((glyph, index) => {
    const offset = left + index * 6 * scale;
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const x = offset + gx * scale + px;
            const y = top + gy * scale + py;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const i = (y * size + x) * 4;
            pixels[i] = 255;
            pixels[i + 1] = 255;
            pixels[i + 2] = 255;
            pixels[i + 3] = 255;
          }
        }
      }
    }
  });
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA-Pixel als PNG (8 Bit, Farbtyp 6, ohne Filter) */
export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Overlay-Abzeichen als PNG (16 px für 100 %, 32 px für 200 %) */
export function badgePng(text: string, size: number): Buffer {
  return encodePng(badgeRgba(text, size), size, size);
}

// ---------- Fenster schließen und Ende des Spiels ----------

export interface CloseInput {
  platform: NodeJS.Platform;
  /** Einstellung „Im Hintergrund bereit für Nachrichten“ (closeToTray) */
  background: boolean;
  gameRunning: boolean;
  /** Launcher beendet sich ohnehin (Beenden, Update) */
  quitting: boolean;
}

/** tray = Fenster ausblenden, Launcher läuft im Infobereich weiter; close = Fenster schließt (Windows: Launcher endet) */
export function closeAction(input: CloseInput): 'tray' | 'close' {
  if (input.quitting || !input.background) return 'close';
  // macOS: ohne Spiel wie jede Mac-App – das Fenster schließt, HeldixClient bleibt im Dock und meldet weiter Nachrichten
  if (input.platform === 'darwin') return input.gameRunning ? 'tray' : 'close';
  return 'tray';
}

export interface AfterGameInput {
  platform: NodeJS.Platform;
  /** Fenster wartet im Infobereich (geschlossen während des Spiels oder unsichtbar gestartet) */
  closedToTray: boolean;
  /** Absturz, Fehler oder Hinweis zum Spiel */
  problem: boolean;
  quitting: boolean;
}

/**
 * Spiel zu Ende: none = nichts Besonderes (Symbol im Infobereich weg, Fenster wieder zeigen, falls beim Start
 * ausgeblendet), show = Fenster mit der Absturz-Hilfe, stay = Launcher bleibt im Infobereich (Windows), dock = Symbol in
 * der Menüleiste weg, Launcher bleibt im Dock (macOS).
 */
export function afterGameAction(input: AfterGameInput): 'none' | 'show' | 'stay' | 'dock' {
  if (input.quitting || !input.closedToTray) return 'none';
  if (input.problem) return 'show';
  return input.platform === 'darwin' ? 'dock' : 'stay';
}

/** Hinweis beim ersten Schließen in den Infobereich (einmal, danach trayHintSeen) */
export function trayHint(platform: NodeJS.Platform, name: string): { title: string; body: string } {
  if (platform === 'darwin') {
    return { title: `${name} läuft weiter`, body: 'Solange Minecraft läuft, findest du es oben in der Menüleiste. Beenden: ⌘Q oder Rechtsklick auf das Symbol im Dock.' };
  }
  return {
    title: `${name} läuft im Infobereich weiter`,
    body: 'Nachrichten, Anfragen und Einladungen kommen weiter an. Beenden: Rechtsklick auf das Symbol → Beenden.',
  };
}

// ---------- Mit dem System starten ----------

export interface LoginItem {
  openAtLogin: boolean;
  path?: string;
  args?: string[];
  /** Name des Werts im Run-Schlüssel von Windows (der Deinstaller entfernt ihn, build/installer.nsh) */
  name?: string;
}

/** Wert im Run-Schlüssel von Windows */
export const LOGIN_ITEM_NAME = 'HeldixClient';

/** Einstellungen für app.setLoginItemSettings: Windows mit --hidden (Run-Schlüssel), Mac „Bei der Anmeldung öffnen“ */
export function loginItemSettings(enabled: boolean, platform: NodeJS.Platform, execPath: string): LoginItem | null {
  if (platform === 'win32') return { openAtLogin: enabled, path: execPath, args: [HIDDEN_FLAG], name: LOGIN_ITEM_NAME };
  if (platform === 'darwin') return { openAtLogin: enabled };
  return null;
}

/** Unsichtbar gestartet? (Windows-Autostart mit --hidden; macOS bei der Anmeldung geöffnet) */
export function startedHidden(argv: readonly string[], platform: NodeJS.Platform, openedAtLogin = false): boolean {
  return argv.includes(HIDDEN_FLAG) || (platform === 'darwin' && openedAtLogin);
}

/** Bezeichnung der Einstellung je System */
export function startWithSystemLabel(platform: string): string {
  return platform === 'darwin' ? 'Bei der Anmeldung starten' : 'Mit Windows starten';
}

// ---------- Blinken ----------

/** Neue Nachricht: Taskleiste kurz blinken lassen (Mac: Dock-Symbol hüpft einmal)? */
export function shouldFlash(input: { kind: string; focused: boolean; visible: boolean; doNotDisturb: boolean; heldixGame: boolean }): boolean {
  return input.kind === 'message' && input.visible && !input.focused && !input.doNotDisturb && !input.heldixGame;
}

// ---------- Dock-Menü (macOS) ----------

export interface DockInstance {
  id: string;
  name: string;
  lastPlayed: number | null;
}

/** Bis zu {@code max} zuletzt gespielte Instanzen, neueste zuerst (nie gespielte fehlen) */
export function recentInstances<T extends DockInstance>(list: readonly T[], max = 5): T[] {
  return list
    .filter((i) => typeof i.lastPlayed === 'number' && i.lastPlayed > 0)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, max);
}
