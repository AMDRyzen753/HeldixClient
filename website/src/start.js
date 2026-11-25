// HeldixClient – Webseite: Startseite. Neuigkeiten (die neuesten drei, gekürzt mit „Weiterlesen“; leer oder nicht
// erreichbar: Abschnitt bleibt versteckt), die drei beliebtesten Addons im Band zum Addon-Store (sonst nur Text und
// Link) und Download-Knöpfe mit dem erkannten System beschriften.
import { h } from './app-common.js';
import { addonIcon, loadAddons } from './addon-common.js';
import { clampLongNews, newsCard, publicGet } from './public-cards.js';
import { detectSystem } from './system.js';

const storeList = document.getElementById('start-addons');
if (storeList) {
  loadAddons()
    .then((addons) => {
      if (!addons.length) return;
      storeList.replaceChildren(
        ...addons.slice(0, 3).map((addon) =>
          h('a', { class: 'store-mini', href: `/addons#${addon.id}` }, addonIcon(addon.icon), h('span', { class: 'store-mini-text' }, h('strong', { text: addon.name }), h('span', { text: addon.summary }))),
        ),
      );
      storeList.hidden = false;
    })
    .catch(() => {});
}

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

detectSystem().then((system) => {
  const label = system.os === 'windows' ? 'Für Windows herunterladen' : system.os === 'mac' ? 'Für Mac herunterladen' : 'Downloads ansehen';
  const sub =
    system.os === 'windows'
      ? 'Windows 10 und 11 · 64 Bit · kostenlos'
      : system.os === 'mac'
        ? 'macOS 11 oder neuer · Apple Silicon und Intel'
        : 'Für Windows und Mac – auf dem PC herunterladen';
  for (const button of document.querySelectorAll('[data-download-cta]')) {
    const text = button.querySelector('.cta-label');
    if (text) text.textContent = label;
    button.dataset.system = system.os;
  }
  for (const element of document.querySelectorAll('[data-download-sub]')) element.textContent = sub;
});
