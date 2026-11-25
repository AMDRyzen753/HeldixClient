// HeldixClient – Webseite: öffentliche Teamseite (/das-team). Zeigt nur Mitglieder, die ihr Teamprofil
// selbst öffentlich gemacht haben (GET /api/v1/public/team). Köpfe kommen vom Heldix-Dienst, nie von Mojang.
import { emptyState, h } from './app-common.js';
import { memberCard, publicGet } from './public-cards.js';

const list = document.getElementById('team-liste');

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
    const retry = h('button', { type: 'button', class: 'button small ghost', onClick: load }, 'Erneut versuchen');
    list.replaceChildren(h('div', { class: 'empty' }, h('p', { text: 'Die Teamseite ist gerade nicht erreichbar. Bitte versuch es später noch einmal.' }), retry));
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

load();
