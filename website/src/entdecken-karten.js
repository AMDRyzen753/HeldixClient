// HeldixClient – Webseite: Karte einer Welt aus dem Weltenverzeichnis (Entdecken). Genutzt von /entdecken und von den
// öffentlichen Spielerprofilen (/spieler/<name>, „Welten von …“) – beide zeigen dieselben Einträge gleich an.
//
// Eintrag (DiscoverEntry des Dienstes): { code, name, description, tags, lang, version, state, persistent, players,
// maxPlayers, likes, address, icon, host: { name, uuid, head } }. Köpfe und Symbole kommen vom Heldix-Dienst
// (/api/v1/public/heads/…, …/icon.png), nie von Mojang. „Beitreten“ öffnet heldixclient://welt/<code>; „Kopieren“ legt die
// Adresse für die Serverliste in die Zwischenablage. Texte vom Dienst landen nur als Text im Dokument.
import { copyText, h, icon, toast } from './app-common.js';

export const FALLBACK_TAGS = [
  ['survival', 'Survival'],
  ['kreativ', 'Kreativ'],
  ['minispiele', 'Minispiele'],
  ['rollenspiel', 'Rollenspiel'],
  ['bauen', 'Bauen'],
  ['parkour', 'Parkour'],
  ['technik', 'Technik'],
  ['entspannt', 'Entspannt'],
  ['hardcore', 'Hardcore'],
].map(([id, label]) => ({ id, label }));

const CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
const HEAD_RE = /^\/v1\/public\/heads\/[0-9a-f]{32}\.png$/;
const ICON_RE = /^\/v1\/public\/discover\/[a-hjkmnp-z2-9]{6}\/icon\.png$/;
const NUMBER = new Intl.NumberFormat('de-DE');

/** Zustand einer Welt im Verzeichnis als Text (geteilte Welten: geöffnet; dauerhafte: Zustand). */
export function stateInfo(entry) {
  switch (entry.state) {
    case 'running':
      return { label: 'Läuft', tone: 'online', hint: null };
    case 'online':
      return { label: 'Geöffnet', tone: 'online', hint: null };
    case 'starting':
      return { label: 'Startet gerade', tone: 'soon', hint: 'In etwa 30 Sekunden kannst du beitreten.' };
    case 'stopping':
    case 'sleeping':
      return { label: 'Schläft', tone: '', hint: 'Beitreten weckt sie – das dauert etwa 30 Sekunden.' };
    default:
      return { label: String(entry.state ?? ''), tone: '', hint: null };
  }
}

function headImage(entry) {
  const head = typeof entry.host?.head === 'string' && HEAD_RE.test(entry.host.head) ? entry.host.head : null;
  const image = h('img', { class: 'kopf discover-card__head', src: '/assets/standard-kopf.svg', width: '28', height: '28', alt: '', loading: 'lazy', decoding: 'async' });
  if (head) {
    image.addEventListener('error', () => image.setAttribute('src', '/assets/standard-kopf.svg'), { once: true });
    image.src = `/api${head}?size=32`;
  }
  return image;
}

function worldIcon(entry) {
  const src = typeof entry.icon === 'string' && ICON_RE.test(entry.icon) ? `/api${entry.icon}` : null;
  if (!src) return h('span', { class: `icon-tile discover-card__icon${entry.persistent ? ' icon-tile--online' : ''}`, 'aria-hidden': 'true' }, icon(entry.persistent ? 'server' : 'world'));
  const image = h('img', { class: 'discover-card__symbol', src, width: '48', height: '48', alt: '', loading: 'lazy', decoding: 'async' });
  image.addEventListener('error', () => image.replaceWith(h('span', { class: 'icon-tile discover-card__icon', 'aria-hidden': 'true' }, icon('world'))), { once: true });
  return image;
}

/**
 * Karte einer Welt. tagLabel(id): Anzeigename eines Tags (Standard: feste Liste). host: false lässt die Zeile „von …“
 * weg (auf dem Profil des Besitzers steht sie ohnehin darüber).
 */
export function discoverCard(entry, { tagLabel = (id) => FALLBACK_TAGS.find((tag) => tag.id === id)?.label ?? id, host = true } = {}) {
  const info = stateInfo(entry);
  const code = CODE_RE.test(entry.code ?? '') ? entry.code : null;
  const address = typeof entry.address === 'string' ? entry.address : '';
  const players = Number(entry.players) || 0;
  const max = Number(entry.maxPlayers) || 0;
  const live = entry.state === 'running' || entry.state === 'online';
  const copy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon', 'aria-label': `Adresse von ${entry.name} kopieren`, title: 'Adresse kopieren', dataset: { aktion: 'kopieren' } }, icon('copy'));
  copy.addEventListener('click', async () => {
    const ok = await copyText(address);
    toast(ok ? `${address} kopiert – in Minecraft unter Mehrspieler → Server hinzufügen einfügen.` : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
  });
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  return h(
    'article',
    { class: `card discover-card${live ? ' is-live' : ''}`, dataset: { code: code ?? '', zustand: entry.state ?? '' } },
    h(
      'div',
      { class: 'discover-card__top' },
      worldIcon(entry),
      h(
        'div',
        { class: 'discover-card__title' },
        h('h3', { class: 'card__title' }, code ? h('a', { href: `/welt#${code}`, text: entry.name }) : entry.name),
        host ? h('p', { class: 'discover-card__host' }, headImage(entry), h('span', null, 'von ', h('strong', { text: entry.host?.name ?? 'unbekannt' }))) : null,
      ),
    ),
    h(
      'div',
      { class: 'discover-card__chips' },
      h('span', { class: `chip${info.tone ? ` chip--${info.tone}` : ''}` }, h('span', { class: `dot${live ? ' dot--online' : ''}`, 'aria-hidden': 'true' }), info.label),
      entry.persistent ? h('span', { class: 'chip chip--accent', title: 'Läuft auf dem Heldix-Server, auch wenn der Besitzer offline ist' }, icon('server'), 'Dauerhaft') : null,
      tags.map((tag) => h('span', { class: 'chip discover-tag', text: tagLabel(tag) })),
    ),
    entry.description ? h('p', { class: 'card__text discover-card__text', text: entry.description }) : h('p', { class: 'card__text discover-card__text text-3', text: 'Ohne Beschreibung.' }),
    info.hint ? h('p', { class: 'tiny text-3', text: info.hint }) : null,
    h(
      'dl',
      { class: 'discover-card__facts' },
      h('div', null, h('dt', { text: 'Spieler' }), h('dd', { text: live || entry.state === 'starting' ? `${players} von ${max}` : `bis zu ${max}` })),
      h('div', null, h('dt', { text: 'Minecraft' }), h('dd', { text: entry.version ?? '–' })),
      h('div', null, h('dt', { text: 'Sprache' }), h('dd', { text: entry.lang === 'en' ? 'Englisch' : 'Deutsch' })),
      h('div', null, h('dt', { text: 'Gefällt mir' }), h('dd', { class: 'discover-card__likes' }, icon('heart'), NUMBER.format(Number(entry.likes) || 0))),
    ),
    h(
      'div',
      { class: 'discover-card__actions' },
      code ? h('a', { class: 'btn btn--primary btn--sm', href: `heldixclient://welt/${code}`, dataset: { aktion: 'beitreten' } }, icon('play'), 'Beitreten') : null,
      address ? copy : null,
      code ? h('a', { class: 'btn btn--secondary btn--sm', href: `/welt#${code}`, dataset: { aktion: 'details' } }, 'Details', icon('chevron-right')) : null,
    ),
  );
}
