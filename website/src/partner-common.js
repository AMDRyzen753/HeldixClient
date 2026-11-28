// HeldixClient – Webseite: Partner-Server (Heldix-Dienst ab 1.14.0, Server-Partner-Programm).
//
// GET /api/v1/public/partners → { partners: [{ id, name, description, website, servers, featured }] } – nur aktive
// Partner, öffentlich, vom Dienst 5 Minuten zwischengespeichert. Genutzt von /entdecken (Abschnitt „Partner-Server“),
// /partner und den Cosmetics (Zugang „partner“: „Belohnung auf <Partnername>“). Älterer Dienst (404) oder Fehler: keine
// Partner – die Seiten zeigen dann einfach nichts dazu. Texte vom Dienst landen nur als Text im Dokument.
import { copyText, h, icon, toast } from './app-common.js';
import { badgeImg } from './abzeichen.js';
import { publicGet } from './public-cards.js';

export const PARTNER_ID_RE = /^[a-z0-9-]{3,32}$/;
/** Server-Adresse wie der Dienst sie speichert (normalizeServer): Domain oder Adresse, Kleinbuchstaben, ggf. Port. */
export const SERVER_RE = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*(?::\d{1,5})?$/;
const FORBIDDEN_TEXT_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const text = (value, max) => (typeof value === 'string' && !FORBIDDEN_TEXT_RE.test(value) ? value.trim().slice(0, max) : '');

/** Webseite eines Partners: nur https-Adressen, sonst null. */
export function safeWebsite(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Partner in eine sichere Form bringen; sonst null. */
export function normalizePartner(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !PARTNER_ID_RE.test(entry.id)) return null;
  const servers = (Array.isArray(entry.servers) ? entry.servers : [])
    .filter((server) => typeof server === 'string')
    .map((server) => server.trim().toLowerCase())
    .filter((server) => SERVER_RE.test(server))
    .slice(0, 10);
  return {
    id: entry.id,
    name: text(entry.name, 40) || entry.id,
    description: text(entry.description, 300),
    website: safeWebsite(entry.website),
    servers,
    featured: entry.featured === true,
  };
}

/** Hervorgehobene zuerst, dann nach Name. */
export function sortPartners(list) {
  return [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

let partnersPromise = null;
const names = new Map();

/** Aktive Partner (einmal je Seite geladen); bei Fehlern eine leere Liste mit .error (Status). */
export function loadPartners() {
  partnersPromise ??= publicGet('/v1/public/partners').then(
    (data) => {
      const list = sortPartners((Array.isArray(data?.partners) ? data.partners : []).map(normalizePartner).filter(Boolean));
      for (const partner of list) names.set(partner.id, partner.name);
      return list;
    },
    (error) => Object.assign([], { error: error?.status ?? 0 }),
  );
  return partnersPromise;
}

/** Name eines Partners (sobald loadPartners() fertig ist), sonst null. */
export const partnerName = (id) => names.get(id) ?? null;

/** Text für Cosmetics mit Zugang „partner“; known: Name aus dem Katalog (partnerName), falls vorhanden. */
export function partnerRewardText(id, known = null) {
  const name = known || partnerName(id);
  return name ? `Belohnung auf ${name}` : 'Belohnung eines Partner-Servers';
}

/** Passt eine Server-Adresse zu einem Partner? Eine Domain deckt ihre Subdomains ab (wie im Dienst und im Spiel). */
export function partnerForAddress(list, address) {
  const host = String(address ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '').replace(/\.$/, '');
  if (!host) return null;
  return list.find((partner) => partner.servers.some((server) => {
    const domain = server.replace(/:\d{1,5}$/, '');
    return host === domain || host.endsWith(`.${domain}`);
  })) ?? null;
}

/** Abzeichen „Partner“ (Sechseck wie im Spiel) mit Text. */
export function partnerChip() {
  return h('span', { class: 'chip partner-chip', title: 'Offizieller Partner-Server von HeldixClient' }, badgeImg('partner', { size: 16, label: '' }), 'Partner');
}

/** Karte eines Partner-Servers (Entdecken, /partner). */
export function partnerCard(partner) {
  const address = partner.servers[0] ?? '';
  const copy = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { aktion: 'kopieren' }, 'aria-label': `Adresse von ${partner.name} kopieren` }, icon('copy'), 'Adresse kopieren');
  copy.addEventListener('click', async () => {
    const ok = await copyText(address);
    toast(ok ? `${address} kopiert – in Minecraft unter Mehrspieler → Server hinzufügen einfügen.` : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
  });
  const more = partner.servers.slice(1);
  return h(
    'article',
    { class: `card partner-card${partner.featured ? ' is-featured' : ''}`, dataset: { partner: partner.id } },
    h(
      'div',
      { class: 'partner-card__top' },
      h('span', { class: `icon-tile${partner.featured ? ' icon-tile--reward' : ' icon-tile--online'}`, 'aria-hidden': 'true' }, icon('server')),
      h(
        'div',
        { class: 'partner-card__title' },
        h('h3', { class: 'card__title', text: partner.name }),
        h('p', { class: 'partner-card__chips' }, partnerChip(), partner.featured ? h('span', { class: 'chip chip--reward' }, icon('star'), 'Hervorgehoben') : null),
      ),
    ),
    partner.description ? h('p', { class: 'card__text', text: partner.description }) : null,
    address
      ? h('div', { class: 'world-address__row partner-card__address' }, h('code', { text: address }), copy)
      : null,
    more.length ? h('p', { class: 'tiny text-3', text: more.length === 1 ? `Auch erreichbar unter ${more[0]}.` : `Auch erreichbar unter ${more.join(', ')}.` }) : null,
    partner.website ? h('a', { class: 'link-arrow partner-card__site', href: partner.website, rel: 'noopener' }, 'Webseite des Servers', icon('external')) : null,
  );
}
