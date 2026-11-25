// HeldixClient – Webseite: Download-Seite (/download). Erkennt System und Prozessor, empfiehlt den passenden
// Download, zeigt Version, Dateigrößen und SHA-256-Prüfsummen (GET /api/v1/launcher/files) und Hinweise aus dem
// Versionsverlauf (GET /api/v1/launcher/versions). Die Knöpfe zeigen auf https://<API>/v1/launcher/download/latest/<ziel>
// und funktionieren auch ohne Skript.
import { copyText, formatBytes, formatDate, h, icon, setupTabs, toast } from './app-common.js';
import { SYSTEME, detectSystem } from './system.js';

const page = document.querySelector('.download-page');
const apiBase = page.dataset.apiBase;
const latest = (ziel) => `${apiBase}/v1/launcher/download/latest/${ziel}`;
const fileUrl = (file) => `${apiBase}/v1/launcher/download/${encodeURIComponent(file)}`;
const KIND = { exe: 'Installer (.exe)', dmg: 'Disk-Image (.dmg)', zip: 'ZIP-Archiv (.zip)' };

async function getJson(path) {
  const response = await fetch(`/api${path}`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw Object.assign(new Error(String(response.status)), { status: response.status });
  return response.json();
}

function zielOf(file) {
  if (file.platform === 'windows') return 'windows';
  if (file.platform === 'mac') return file.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return null;
}

function shortHash(hash) {
  return hash.length > 28 ? `${hash.slice(0, 16)}…${hash.slice(-8)}` : hash;
}

function fileRow(file) {
  const copy = h('button', { type: 'button', class: 'icon-button small', 'aria-label': `SHA-256 von ${file.file} kopieren`, title: 'Prüfsumme kopieren' }, icon('copy'));
  copy.addEventListener('click', async () => {
    const ok = await copyText(file.sha256);
    toast(ok ? 'Prüfsumme kopiert.' : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
  });
  return h(
    'div',
    { class: 'file-entry' },
    h(
      'div',
      { class: 'file-entry-head' },
      h('a', { href: fileUrl(file.file), class: 'file-link' }, icon('file'), h('span', { text: KIND[file.kind] ?? file.kind })),
      h('span', { class: 'file-meta', text: `${formatBytes(file.size)} · Version ${file.version}` }),
    ),
    typeof file.sha256 === 'string' && file.sha256
      ? h('div', { class: 'hash-row' }, h('span', { class: 'hash-label', text: 'SHA-256' }), h('code', { class: 'hash', title: file.sha256, 'data-sha256': file.sha256, text: shortHash(file.sha256) }), copy)
      : null,
  );
}

function renderSystems(files) {
  const available = new Set();
  for (const card of document.querySelectorAll('.system-card')) {
    const ziel = card.dataset.ziel;
    const own = files.filter((file) => zielOf(file) === ziel);
    const box = card.querySelector('[data-dateien]');
    box.replaceChildren(...own.map(fileRow));
    const missing = !own.length;
    card.querySelector('[data-fehlt]').hidden = !missing;
    card.querySelector('[data-knopf]').hidden = missing;
    card.classList.toggle('missing', missing);
    if (!missing) available.add(ziel);
  }
  return available;
}

function setButton(link, ziel, text) {
  link.href = latest(ziel);
  link.querySelector('span').textContent = text;
  link.hidden = false;
}

function renderRecommendation(system, available, version) {
  const title = document.getElementById('empfohlen-titel');
  const meta = document.getElementById('empfohlen-meta');
  const hint = document.getElementById('empfohlen-hinweis');
  const primary = document.getElementById('download-primary');
  const secondary = document.getElementById('download-secondary');
  const label = document.getElementById('empfohlen-label');
  const has = (ziel) => !available || available.has(ziel);
  hint.hidden = true;
  if (system.os === 'windows') {
    label.textContent = 'Empfohlen für dein System';
    title.textContent = 'HeldixClient für Windows';
    meta.textContent = `${SYSTEME.windows.voll}${version ? ` · Version ${version}` : ''}`;
    setButton(primary, 'windows', SYSTEME.windows.knopf);
    secondary.hidden = true;
    if (!has('windows')) showMissing(primary, hint);
  } else if (system.os === 'mac') {
    label.textContent = 'Empfohlen für deinen Mac';
    const first = system.ziel;
    const other = first === 'mac-arm64' ? 'mac-x64' : 'mac-arm64';
    title.textContent = system.sicher ? `HeldixClient für ${SYSTEME[first].name}` : 'HeldixClient für den Mac';
    meta.textContent = `macOS 11 oder neuer${version ? ` · Version ${version}` : ''}`;
    setButton(primary, first, first === 'mac-arm64' ? 'Für Apple Silicon (M1 und neuer)' : 'Für Mac mit Intel');
    setButton(secondary, other, other === 'mac-arm64' ? 'Für Apple Silicon (M1 und neuer)' : 'Für Mac mit Intel');
    if (!system.sicher) {
      hint.textContent = 'Dein Browser verrät nicht, welchen Prozessor dein Mac hat. Macs ab Ende 2020 haben meist Apple Silicon – im Zweifel: Apple-Menü → „Über diesen Mac“.';
      hint.hidden = false;
    } else {
      secondary.classList.add('quiet');
    }
    if (!has(first)) showMissing(primary, hint);
    if (!has(other)) secondary.hidden = true;
  } else {
    label.textContent = 'Für Windows und Mac';
    title.textContent = 'HeldixClient läuft auf Windows und Mac';
    meta.textContent = 'Auf diesem Gerät läuft HeldixClient nicht. Lade ihn auf deinem PC oder Mac herunter – alle Dateien stehen unten.';
    setButton(primary, 'windows', 'Für Windows herunterladen');
    setButton(secondary, 'mac-arm64', 'Für Mac herunterladen');
  }
}

function showMissing(button, hint) {
  button.hidden = true;
  hint.textContent = 'Für dieses System gibt es gerade noch keinen Download. Die anderen Systeme findest du unten; Fragen beantwortet der Support.';
  hint.hidden = false;
}

function renderVersion(version, entry) {
  if (version) document.getElementById('version-nummer').textContent = version;
  const date = entry && typeof entry.date === 'string' && Number.isFinite(Date.parse(entry.date)) ? formatDate(Date.parse(entry.date)) : entry?.publishedAt ? formatDate(entry.publishedAt) : '';
  document.getElementById('version-datum').textContent = date ? `veröffentlicht am ${date}` : '';
  const notes = (Array.isArray(entry?.notes) ? entry.notes : []).filter((note) => typeof note === 'string' && note.trim());
  const box = document.getElementById('version-hinweise');
  box.replaceChildren(
    notes.length ? h('ul', { class: 'release-notes' }, notes.map((note) => h('li', { text: note }))) : h('p', { class: 'muted', text: 'Kleinere Verbesserungen und Fehlerbehebungen.' }),
    h('p', { class: 'muted small' }, h('a', { href: '/neuigkeiten#versionen', text: 'Alle Versionen ansehen' })),
  );
}

async function main() {
  const tabs = setupTabs(document.getElementById('anleitung-tabs'));
  const system = await detectSystem();
  page.dataset.system = system.os;
  page.dataset.ziel = system.ziel ?? '';
  page.dataset.sicher = String(system.sicher);
  tabs.select(system.os === 'mac' ? 'mac' : 'windows', { silent: true });
  if (system.ziel) document.getElementById(`system-${system.ziel}`)?.classList.add('recommended');
  renderRecommendation(system, null, null);

  let files = null;
  let version = null;
  try {
    const data = await getJson('/v1/launcher/files');
    files = Array.isArray(data?.files) ? data.files : [];
    version = typeof data?.version === 'string' ? data.version : null;
  } catch {
    document.getElementById('download-fehler').hidden = false;
    page.dataset.dateien = 'fehler';
  }
  if (files) {
    const available = renderSystems(files);
    renderRecommendation(system, available, version);
    page.dataset.dateien = 'ok';
  }
  try {
    const data = await getJson('/v1/launcher/versions?limit=1');
    const entry = Array.isArray(data?.versions) ? data.versions[0] : null;
    renderVersion(version ?? entry?.version ?? null, entry);
  } catch {
    if (version) renderVersion(version, null);
  }
}

main();
