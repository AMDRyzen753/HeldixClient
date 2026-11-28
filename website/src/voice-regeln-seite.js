// HeldixClient – Webseite: Seite /voice-regeln. Die Seite bringt den Standardtext der Voice-Regeln schon mit (auch
// ohne JavaScript lesbar); dieses Skript ersetzt ihn durch den Text vom Heldix-Dienst (GET /api/v1/public/voice/rules)
// und zeigt Version, Datum der Veröffentlichung und ob Aufnahmen beim Melden gerade aktiv sind.
import { formatDate, h, icon } from './app-common.js';
import { clipMinutes, loadVoiceRules, parseRules, renderRules } from './voice-regeln.js';

const $ = (id) => document.getElementById(id);

function chip(kind, iconName, label) {
  return h('span', { class: `chip ${kind}` }, icon(iconName), label);
}

async function start() {
  const stand = $('regeln-stand');
  const rules = await loadVoiceRules();
  if (!rules) {
    stand.replaceChildren(chip('', 'info', 'Standardtext'), ' Der aktuelle Stand ließ sich gerade nicht vom Heldix-Dienst laden.');
    return;
  }
  const parsed = parseRules(rules.text);
  if (parsed.blocks.length) {
    const { nodes, toc } = renderRules(parsed, { level: 2, ids: true });
    $('regeln-text').replaceChildren(...nodes);
    if (parsed.title) {
      $('regeln-titel').textContent = parsed.title;
      document.title = `${parsed.title} – HeldixClient`;
    }
    const list = $('regeln-toc');
    list.replaceChildren(...toc.map((entry) => h('li', null, h('a', { href: `#${entry.id}`, text: entry.text }))));
    list.closest('.toc').hidden = toc.length < 2;
  }
  const minutes = clipMinutes(rules.limits);
  if (rules.published) {
    stand.replaceChildren(
      chip('accent', 'check', `Version ${rules.version}`),
      rules.publishedAt ? ` veröffentlicht am ${formatDate(rules.publishedAt)}. ` : ' ',
      rules.clips ? chip('warning', 'mic', `Aufnahmen beim Melden: aktiv (letzte ${minutes} Minuten)`) : chip('', 'mic-off', 'Aufnahmen beim Melden: gerade aus'),
    );
  } else {
    stand.replaceChildren(chip('', 'info', 'Noch nicht veröffentlicht'), ' Bis zur Veröffentlichung läuft der Voice Chat wie bisher: ohne Zustimmung und ohne Aufnahmen beim Melden.');
  }
  document.body.dataset.regeln = rules.published ? `v${rules.version}` : 'entwurf';
}

start();
