// HeldixClient – Webseite: Karten, die öffentliche Seiten und der Team-Bereich gleich darstellen.
//
// - newsCard: eine Neuigkeit (Startseite, /neuigkeiten, Vorschau im Team-Bereich)
// - memberCard: ein Team-Mitglied (/das-team und die Vorschau unter „Mein Teamprofil“)
// - skinHead: Kopf aus dem Minecraft-Skin, den der Heldix-Dienst ausliefert (/api/v1/public/skins/<uuid>).
//   Der Browser fragt nie bei Mojang an; ohne Skin erscheinen Initialen.
// Texte vom Server werden nie als HTML ausgewertet.
import { avatar, formatDate, h, ROLE_LABELS, textBlocks, timeEl } from './app-common.js';

const MONTH_YEAR = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

/**
 * Neuigkeit als Karte. clamp: lange Texte gekürzt mit „Weiterlesen“ (die Kürzung prüft clampLongNews(),
 * sobald die Karte sichtbar ist). anchor: id für Links wie /neuigkeiten#neuigkeit-7.
 */
export function newsCard(item, { clamp = false, anchor = false, author = item.author } = {}) {
  const bodyId = `neuigkeit-text-${item.id ?? Math.random().toString(36).slice(2)}`;
  const body = h('div', { class: `news-body${clamp ? ' clamped' : ''}`, id: bodyId }, textBlocks(item.text));
  const parts = [];
  if (typeof item.at === 'number' && Number.isFinite(item.at)) parts.push(timeEl(item.at, formatDate(item.at)));
  parts.push(h('h3', { text: item.title }), body);
  if (clamp) {
    const more = h('button', { type: 'button', class: 'news-more', hidden: true, 'aria-expanded': 'false', 'aria-controls': bodyId }, 'Weiterlesen');
    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      body.classList.toggle('clamped', !open);
      more.textContent = open ? 'Weniger anzeigen' : 'Weiterlesen';
    });
    parts.push(more);
  }
  if (typeof author === 'string' && author) parts.push(h('p', { class: 'news-author', text: `von ${author}` }));
  return h('article', { class: 'news-card', id: anchor && item.id !== undefined ? `neuigkeit-${item.id}` : undefined }, parts);
}

/** Nach dem Einblenden: „Weiterlesen“ nur bei Texten zeigen, die wirklich gekürzt sind. */
export function clampLongNews(root) {
  for (const body of root.querySelectorAll('.news-body.clamped')) {
    const more = body.parentElement.querySelector('.news-more');
    if (body.scrollHeight > body.clientHeight + 4) {
      if (more) more.hidden = false;
    } else {
      body.classList.remove('clamped');
    }
  }
}

/** Skin-Kopf (8×8 Gesicht + Hut-Ebene) als Canvas; ohne Skin die Initialen. */
export function skinHead(uuid, name, { pixels = 128 } = {}) {
  const box = h('span', { class: 'skin-head loading', 'aria-hidden': 'true' });
  if (!uuid) {
    box.classList.remove('loading');
    box.append(avatar(name, uuid, { size: 'xl' }));
    return box;
  }
  const fallback = () => {
    box.classList.remove('loading');
    box.replaceChildren(avatar(name, uuid, { size: 'xl' }));
  };
  const image = new Image();
  image.decoding = 'async';
  image.addEventListener('load', () => {
    // Skins sind 64×64 (oder alt 64×32); Gesicht bei (8|8), Hut-Ebene bei (40|8).
    if (image.naturalWidth < 64 || image.naturalHeight < 16 || image.naturalWidth !== 64) return fallback();
    const canvas = h('canvas', { width: String(pixels), height: String(pixels), class: 'skin-canvas' });
    const context = canvas.getContext('2d');
    if (!context) return fallback();
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 8, 8, 8, 8, 0, 0, pixels, pixels);
    context.drawImage(image, 40, 8, 8, 8, 0, 0, pixels, pixels);
    box.classList.remove('loading');
    box.replaceChildren(canvas);
  });
  image.addEventListener('error', fallback);
  image.src = `/api/v1/public/skins/${encodeURIComponent(uuid)}`;
  return box;
}

/**
 * Team-Mitglied als Karte, genau so auf /das-team und in der Vorschau unter „Mein Teamprofil“.
 * head: schon vorhandener Kopf (die Vorschau lädt den Skin nicht bei jedem Tastendruck neu).
 */
export function memberCard(member, { head } = {}) {
  const role = ROLE_LABELS[member.role] ?? member.role ?? '';
  const since = typeof member.since === 'number' && Number.isFinite(member.since) ? member.since : null;
  return h(
    'article',
    { class: 'member-card' },
    head ?? skinHead(member.uuid, member.name),
    h('div', { class: 'member-name' }, h('h2', { text: member.name }), role ? h('span', { class: `chip ${member.role === 'admin' ? 'accent' : ''}`.trim(), text: role }) : null),
    member.title ? h('p', { class: 'member-title', text: member.title }) : null,
    member.about ? h('p', { class: 'member-about', text: member.about }) : null,
    since ? h('p', { class: 'member-since' }, 'im Team seit ', h('time', { datetime: new Date(since).toISOString(), title: formatDate(since), text: MONTH_YEAR.format(since) })) : null,
  );
}

/** Öffentliche GET-Anfrage (ohne Anmeldung) – Fehler als Error mit .status. */
export async function publicGet(path) {
  let response;
  try {
    response = await fetch(`/api${path}`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw Object.assign(new Error('nicht erreichbar'), { status: 0 });
  }
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return response.json();
}
