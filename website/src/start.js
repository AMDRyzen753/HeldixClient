// HeldixClient – Webseite: Startseite.
// - Live-Zahlen: GET /api/v1/public/stats → { online, voice, worlds } (nur Summen; unter 50 Spielern online liefert der
//   Dienst null – dann bleibt die Leiste ausgeblendet, ebenso ohne Dienst)
// - Addon-Store: die beliebtesten Addons (bis zu 6) ersetzen die feste Liste; ohne Dienst bleibt die feste Liste
// - Neuigkeiten: die neuesten drei, gekürzt mit „Weiterlesen“; leer oder nicht erreichbar: Abschnitt bleibt versteckt
import { h } from './app-common.js';
import { addonIcon, loadAddons } from './addon-common.js';
import { clampLongNews, newsCard, publicGet } from './public-cards.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Live-Zahlen
const bar = document.querySelector('[data-live-bar]');
if (bar) {
  const fields = { online: 'online', voice: 'voice', worlds: 'welten' };
  const show = (field, value) => {
    const num = field.querySelector('.live__num');
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      field.hidden = true;
      return;
    }
    field.dataset.state = 'da';
    if (reduceMotion) {
      num.textContent = value.toLocaleString('de-DE');
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 700);
      num.textContent = Math.round(value * (1 - (1 - t) ** 3)).toLocaleString('de-DE');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  publicGet('/v1/public/stats')
    .then((data) => {
      if (typeof data?.online !== 'number') return; // unter der Schwelle: alles null → nichts zeigen
      bar.hidden = false;
      bar.dataset.state = 'da';
      for (const [key, name] of Object.entries(fields)) show(bar.querySelector(`[data-live="${name}"]`), data[key]);
    })
    .catch(() => {});
}

// --- Addon-Store: beliebteste Addons
const storeList = document.getElementById('start-addons');
if (storeList) {
  loadAddons()
    .then((addons) => {
      if (!addons.length) return;
      storeList.replaceChildren(
        ...addons.slice(0, 6).map((addon) =>
          h('li', {}, h('a', { class: 'addon', href: `/addons#${addon.id}` }, addonIcon(addon.icon, 'icon-tile'), h('span', {}, h('strong', { text: addon.name }), h('span', { text: addon.summary })))),
        ),
      );
      storeList.dataset.quelle = 'store';
    })
    .catch(() => {});
}

// --- Neuigkeiten
const section = document.getElementById('neuigkeiten');
const list = document.getElementById('neuigkeiten-liste');
if (section && list) {
  publicGet('/v1/news?limit=3')
    .then((data) => {
      const items = (Array.isArray(data?.news) ? data.news : []).filter((item) => item && typeof item.title === 'string' && typeof item.text === 'string').slice(0, 3);
      if (!items.length) return;
      list.replaceChildren(...items.map((item) => newsCard(item, { clamp: true })));
      list.dataset.count = String(items.length);
      section.hidden = false;
      // Erst jetzt haben die Karten eine Größe.
      clampLongNews(list);
    })
    .catch(() => {});
}
