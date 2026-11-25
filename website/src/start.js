// HeldixClient – Webseite: Neuigkeiten auf der Startseite (die neuesten drei, gekürzt mit „Weiterlesen“).
// Leer oder nicht erreichbar: Der Abschnitt bleibt versteckt.
import { clampLongNews, newsCard, publicGet } from './public-cards.js';

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
