// Abzeichen (Heldix-Symbol je Rolle) im Launcher: Freundesliste, Profilkarte und Kontokarte. Die SVGs kommen aus dem
// Icon-Set (ui-icons.ts, erzeugt von scripts/render-ui-assets.mjs – dieselben Zeichnungen wie im Spiel), die
// Bezeichnungen wie BADGE_LABELS im Heldix-Dienst. Als <img> mit data:-URL, damit sich die IDs der Verläufe in den
// SVGs nicht in die Quere kommen.
import type { PlayerBadge } from '../shared/api';
import { h } from './core.js';
import { BADGE_LABELS, UI_BADGES, UI_BADGES_SMALL } from './ui-icons.js';

const urls = new Map<string, string>();

function badgeName(badge: PlayerBadge | null | undefined): string {
  return badge && UI_BADGES[badge] ? badge : 'player';
}

/** „Team-Admin“, „Botschafter“ …; null/unbekannt = „HeldixClient-Spieler“ */
export function badgeLabel(badge: PlayerBadge | null | undefined): string {
  return BADGE_LABELS[badgeName(badge)] ?? 'HeldixClient-Spieler';
}

function badgeUrl(name: string, small: boolean): string {
  const key = `${name}:${small ? 's' : 'l'}`;
  let url = urls.get(key);
  if (!url) {
    const svg = (small ? UI_BADGES_SMALL : UI_BADGES)[name] ?? UI_BADGES.player;
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    urls.set(key, url);
  }
  return url;
}

/**
 * Abzeichen als Bild, size = Höhe in Pixeln (Breite 7/8 davon). Unter 32 px die gröbere Fassung wie im Spiel.
 * null = normales HeldixClient-Symbol (blaues „H“).
 */
export function badgeIcon(badge: PlayerBadge | null | undefined, size = 16): HTMLImageElement {
  const name = badgeName(badge);
  return h('img', {
    class: 'badge-icon',
    src: badgeUrl(name, size < 32),
    width: String(Math.round((size * 7) / 8)),
    height: String(size),
    alt: badgeLabel(badge),
    title: badgeLabel(badge),
    draggable: 'false',
    'data-badge': name,
  });
}
