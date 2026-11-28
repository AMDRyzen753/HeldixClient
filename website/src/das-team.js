// HeldixClient – Webseite: öffentliche Teamseite (/das-team). Zeigt nur Mitglieder, die ihr Teamprofil
// selbst öffentlich gemacht haben (GET /api/v1/public/team, nach Rang sortiert). Köpfe kommen vom Heldix-Dienst
// (/api/v1/public/heads/<uuid>.png), nie von Mojang; Abzeichen und Rollennamen wie im Spiel (abzeichen.js, rollen.js).
import { emptyState, formatDate, h } from './app-common.js';
import { badgeImg } from './abzeichen.js';
import { publicGet } from './public-cards.js';
import { roleLabel } from './rollen.js';

const list = document.getElementById('team-liste');
const MONTH_YEAR = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const UUID = /^[0-9a-f]{32}$/;

function head(member) {
  const image = h('img', { class: 'kopf', src: '/assets/standard-kopf.svg', width: 88, height: 88, alt: '' });
  if (typeof member.uuid === 'string' && UUID.test(member.uuid)) {
    image.addEventListener('error', () => image.setAttribute('src', '/assets/standard-kopf.svg'), { once: true });
    image.src = `/api/v1/public/heads/${member.uuid}.png?size=128`;
  }
  return image;
}

function memberCard(member) {
  const role = roleLabel(member.role);
  const since = typeof member.since === 'number' && Number.isFinite(member.since) ? member.since : null;
  return h(
    'article',
    { class: 'card member-card', 'data-rolle': member.role ?? '' },
    head(member),
    h('div', { class: 'member-name' }, h('h2', { text: member.name }), role ? h('span', { class: 'member-role' }, badgeImg(member.role, { size: 24 }), h('span', { text: role })) : null),
    member.title ? h('p', { class: 'member-title', text: member.title }) : null,
    member.about ? h('p', { class: 'member-about', text: member.about }) : null,
    since ? h('p', { class: 'member-since' }, 'im Team seit ', h('time', { datetime: new Date(since).toISOString(), title: formatDate(since), text: MONTH_YEAR.format(since) })) : null,
  );
}

async function load() {
  list.setAttribute('aria-busy', 'true');
  try {
    const data = await publicGet('/v1/public/team');
    const members = (Array.isArray(data?.members) ? data.members : []).filter((member) => member && typeof member.name === 'string');
    list.classList.toggle('empty-grid', !members.length);
    if (!members.length) list.replaceChildren(emptyState('Das Team stellt sich hier bald vor.', 'friends'));
    else list.replaceChildren(...members.map(memberCard));
  } catch {
    list.classList.add('empty-grid');
    const retry = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: load }, 'Erneut versuchen');
    list.replaceChildren(h('div', { class: 'empty' }, h('p', { text: 'Die Teamseite ist gerade nicht erreichbar. Bitte versuch es später noch einmal.' }), retry));
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

load();
