// Baut die Webseite von HeldixClient: website/src → website/dist
//
//   node website/build.mjs
//
// - setzt Kopf, Navigation und Fußzeile ein ({{include:datei.html}} aus src/_partials)
// - Icons aus dem Heldix-Icon-Set ({{icon:name}}, dieselben wie in Launcher und Spiel)
// - Bedingte Blöcke: {{#github}}…{{/github}} nur mit githubUrl, {{^github}}…{{/github}} nur ohne
// - Seitenangaben (Titel, Beschreibung, Open Graph, noindex) aus <!--seite {…}--> am Anfang einer Seite
// - Hilfe-Center (src/hilfe/*.md) und Entwickler-Seiten (src/entwickler/*.md) mit eigenem, sicherem
//   Markdown-Renderer (kein HTML aus den Texten) und Syntax-Farben per CSS-Klassen
// - Module aus den Quellen der Mod (module/impl/*.java, Icons aus Module.java, Module der Store-Addons aus
//   mod/addons/<id>) + Texte aus src/data/module.json; Capes aus capes.json der Mod (Texturen werden mitkopiert)
// - Addon-Store (/addons): der Inhalt kommt zur Laufzeit vom Dienst, die Seite bekommt dafür das ganze Icon-Set
// - Cosmetics (/cosmetics): Katalog zur Laufzeit vom Dienst; /update-key.js bringt den öffentlichen Update-Schlüssel
//   aus launcher/src/main/update-public-key.ts mit (Prüfung der Signaturen im Browser), /capes/capes.json die
//   eingebauten Capes
// - 3D-Ansicht: skinview3d (MIT) samt Lizenztexten, dazu ein selbst gezeichneter Standard-Skin
// - Bilder (docs/images), Logo, Hintergrund und die Schrift Inter (aus der Mod) werden mitkopiert
// - sitemap.xml und robots.txt
// Angaben für Impressum/Datenschutz aus site.config.json (fehlt sie: site.config.example.json mit Hinweis).
// Die Adresse der API (__API_DOMAIN__) setzt erst der Server-Installer ein (nur in *.html).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const websiteDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(websiteDir, '..');
const srcDir = path.join(websiteDir, 'src');
const FONTS = ['inter-medium.ttf', 'inter-semibold.ttf', 'inter-bold.ttf'];

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slugify = (text) =>
  String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------------------------------------------------
// Markdown (bewusst klein: Überschriften, Absätze, Listen, Hinweise, Code, Links, Bilder, Tasten)
// ---------------------------------------------------------------------------------------------------------

const JAVA_KEYWORDS = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try var void volatile while record yield sealed permits true false null def apply plugins dependencies repositories'.split(
    ' ',
  ),
);

/** Code einfärben: Tokens werden einzeln escaped und in <span class="tok-…"> gesetzt. */
export function highlight(code, lang) {
  const language = (lang || 'text').toLowerCase();
  let pattern;
  if (['java', 'groovy', 'gradle', 'kotlin'].includes(language)) {
    pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(@[A-Za-z_]\w*)|(\b\d[\d_]*(?:\.\d+)?[fFdDlL]?\b)|(\b[A-Za-z_]\w*\b)/g;
  } else if (language === 'json') {
    pattern = /()("(?:[^"\\\n]|\\.)*"(?=\s*:))|("(?:[^"\\\n]|\\.)*")|(\b-?\d+(?:\.\d+)?\b)|(\b(?:true|false|null)\b)/g;
  } else if (['bash', 'sh', 'shell', 'powershell'].includes(language)) {
    pattern = /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^'\n]*')|()|(\b\d+\b)|(^\s*[\w./\\-]+)/gm;
  } else {
    return escape(code);
  }
  let out = '';
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    out += escape(code.slice(last, match.index));
    last = match.index + match[0].length;
    const [text, comment, str, third, num, word] = match;
    let cls = null;
    if (language === 'json') {
      if (str) cls = 'tok-key';
      else if (third) cls = 'tok-str';
      else if (num) cls = 'tok-num';
      else if (word) cls = 'tok-kw';
    } else if (comment) cls = 'tok-com';
    else if (str) cls = 'tok-str';
    else if (third) cls = 'tok-ann';
    else if (num) cls = 'tok-num';
    else if (word) {
      if (['bash', 'sh', 'shell', 'powershell'].includes(language)) cls = 'tok-kw';
      else if (JAVA_KEYWORDS.has(word)) cls = 'tok-kw';
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) cls = 'tok-type';
    }
    out += cls ? `<span class="${cls}">${escape(text)}</span>` : escape(text);
  }
  return out + escape(code.slice(last));
}

/** Inline-Formatierung auf schon escaptem Text (Code-Abschnitte bleiben unberührt). */
function inline(text) {
  return String(text)
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${escape(part.slice(1, -1))}</code>`;
      let out = escape(part);
      out = out.replace(/\[\[([^\]]{1,40})\]\]/g, '<kbd>$1</kbd>');
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
        const target = url.replace(/&amp;/g, '&');
        if (!/^(\/(?!\/)|#|https:\/\/)/.test(target)) return label;
        const external = target.startsWith('https://');
        return `<a href="${escape(target)}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
      });
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/(^|[\s(„])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)“]|$)/g, '$1<em>$2</em>');
      return out;
    })
    .join('');
}

export function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const toc = [];
  const used = new Set();
  let html = '';
  let i = 0;
  const isBlockStart = (line) => /^(```|#{2,3} |> ?|- |\d+\. |!\[)/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      html += `<div class="code-block"><span class="code-lang">${escape(lang || 'text')}</span><pre class="code" tabindex="0"><code>${highlight(code.join('\n'), lang)}</code></pre></div>\n`;
      continue;
    }
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      let id = slugify(heading[2].replace(/[`*[\]]/g, '')) || 'abschnitt';
      while (used.has(id)) id += '-2';
      used.add(id);
      if (level === 2) toc.push({ id, text: heading[2].replace(/[`*[\]]/g, '') });
      html += `<h${level} id="${id}">${inline(heading[2])}</h${level}>\n`;
      i++;
      continue;
    }
    if (/^> ?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^> ?/.test(lines[i])) quote.push(lines[i++].replace(/^> ?/, ''));
      let text = quote.join(' ').trim();
      let kind = 'hinweis';
      const label = /^\*\*(Hinweis|Tipp|Achtung|Wichtig):\*\*\s*/.exec(text);
      if (label) {
        kind = label[1].toLowerCase();
        text = text.slice(label[0].length);
      }
      const title = label ? label[1] : 'Hinweis';
      html += `<aside class="callout callout-${kind}"><p><strong>${escape(title)}:</strong> ${inline(text)}</p></aside>\n`;
      continue;
    }
    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : /^- /.test(lines[i]))) {
        let item = lines[i++].replace(ordered ? /^\d+\. / : /^- /, '');
        while (i < lines.length && /^ {2,}\S/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(`<li>${inline(item)}</li>`);
      }
      html += `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>\n`;
      continue;
    }
    const image = /^!\[([^\]]*)\]\((\/images\/[\w.-]+\.(?:png|jpg|webp))\)\s*$/.exec(line);
    if (image) {
      html += `<figure class="article-figure"><img src="${escape(image[2])}" alt="${escape(image[1])}" loading="lazy"><figcaption>${escape(image[1])}</figcaption></figure>\n`;
      i++;
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !(paragraph.length && isBlockStart(lines[i]))) paragraph.push(lines[i++].trim());
    html += `<p>${inline(paragraph.join(' '))}</p>\n`;
  }
  return { html, toc };
}

/** Markdown-Datei mit Vorspann (--- schluessel: wert ---) lesen. */
function readArticle(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text.replace(/\r\n?/g, '\n'));
  if (!match) throw new Error(`${file}: Vorspann (---) fehlt`);
  const meta = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  for (const key of ['titel', 'beschreibung']) if (!meta[key]) throw new Error(`${file}: „${key}“ fehlt im Vorspann`);
  const body = text.replace(/\r\n?/g, '\n').slice(match[0].length);
  const slug = path.basename(file, '.md');
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`${file}: Dateiname nur aus a–z, 0–9 und -`);
  // Klartext für die Suche: Markdown-Zeichen nur am Zeilenanfang bzw. als Hervorhebung entfernen (Bindestriche in
  // Wörtern wie „HUD-Module“ bleiben), Überschriften und Listenpunkte werden zu eigenen Sätzen.
  const plain = body
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
        .replace(/^\s*\|?\s*:?-{3,}.*$/, '')
        .replace(/\|/g, ' ')
        .replace(/\*\*|__|\*|`/g, '')
        .trim(),
    )
    .filter(Boolean)
    .map((line) => (/[.!?:;…)“"]$/.test(line) ? line : `${line}.`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { slug, meta, body, plain, order: Number(meta.reihenfolge) || 99 };
}

// ---------------------------------------------------------------------------------------------------------
// PNG schreiben (für den Standard-Skin) – ohne Abhängigkeiten
// ---------------------------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Eigener Standard-Skin (64×64): blauer Pullover im Heldix-Blau, dunkle Hose, braune Haare. */
function defaultSkin() {
  const pixels = new Uint8Array(64 * 64 * 4);
  const hex = (value) => [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16), 255];
  const rect = (x, y, w, h, color) => {
    const c = hex(color);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) pixels.set(c, (yy * 64 + xx) * 4);
  };
  const SKIN = '#e0a77c';
  const HAIR = '#4a3022';
  const SHIRT = '#2f6fe0';
  const SHIRT_DARK = '#2457b8';
  const PANTS = '#25324a';
  const SHOES = '#1a1f2b';
  // Kopf: oben, unten, rechts, vorn, links, hinten
  rect(8, 0, 8, 8, HAIR);
  rect(16, 0, 8, 8, SKIN);
  rect(0, 8, 32, 8, SKIN);
  rect(0, 8, 8, 3, HAIR);
  rect(16, 8, 8, 3, HAIR);
  rect(24, 8, 8, 8, HAIR);
  rect(8, 8, 8, 2, HAIR);
  rect(8, 10, 1, 1, HAIR);
  rect(15, 10, 1, 1, HAIR);
  rect(9, 12, 2, 1, '#ffffff');
  rect(10, 12, 1, 1, '#3c5fd6');
  rect(13, 12, 2, 1, '#ffffff');
  rect(13, 12, 1, 1, '#3c5fd6');
  rect(11, 14, 2, 1, '#9c5b45');
  // Körper
  rect(20, 16, 8, 4, SHIRT);
  rect(28, 16, 8, 4, SHIRT_DARK);
  rect(16, 20, 24, 12, SHIRT);
  rect(20, 20, 8, 1, SHIRT_DARK);
  rect(23, 22, 2, 3, '#8fc1ff');
  // rechter Arm (alt) und linker Arm (neu)
  for (const [ax, ay] of [
    [40, 16],
    [32, 48],
  ]) {
    rect(ax + 4, ay, 4, 4, SHIRT);
    rect(ax + 8, ay, 4, 4, SKIN);
    rect(ax, ay + 4, 16, 8, SHIRT);
    rect(ax, ay + 12, 16, 4, SKIN);
  }
  // rechtes und linkes Bein
  for (const [lx, ly] of [
    [0, 16],
    [16, 48],
  ]) {
    rect(lx + 4, ly, 4, 4, PANTS);
    rect(lx + 8, ly, 4, 4, SHOES);
    rect(lx, ly + 4, 16, 9, PANTS);
    rect(lx, ly + 13, 16, 3, SHOES);
  }
  return encodePng(64, 64, pixels);
}

// ---------------------------------------------------------------------------------------------------------
// Module und Capes aus den Quellen der Mod
// ---------------------------------------------------------------------------------------------------------

/** Addons, deren Module auf /module stehen. Die Addons liegen in mod/addons/<id> und kommen aus dem Addon-Store. */
const STORE_MODULE_ADDONS = ['spotify'];

function readModules(icons) {
  const modDir = path.join(root, 'mod', 'src', 'main', 'java', 'dev', 'heldixclient', 'module');
  const iconMap = {};
  for (const match of readFileSync(path.join(modDir, 'Module.java'), 'utf8').matchAll(/case "([a-z0-9_]+)" -> "([a-z0-9-]+)"/g)) iconMap[match[1]] = match[2];
  const modules = [];
  for (const file of readdirSync(path.join(modDir, 'impl')).filter((name) => name.endsWith('.java')).sort()) {
    const source = readFileSync(path.join(modDir, 'impl', file), 'utf8');
    const call = /super\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]*)",\s*(true|false)/.exec(source);
    if (!call) continue;
    const [, id, name, description, enabled] = call;
    modules.push({ id, name, description, enabled: enabled === 'true', hud: /extends\s+HudModule\b/.test(source), icon: iconMap[id] ?? 'cube', addon: null });
  }
  // Module aus Addons im Addon-Store (die Karte verlinkt auf /addons#<id>)
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.java') ? [path.join(dir, entry.name)] : []));
  for (const addonId of STORE_MODULE_ADDONS) {
    const addonDir = path.join(root, 'mod', 'addons', addonId);
    const javaDir = path.join(addonDir, 'src', 'main', 'java');
    if (!existsSync(javaDir)) throw new Error(`Addon ${addonId}: ${path.relative(root, javaDir)} fehlt`);
    const info = JSON.parse(readFileSync(path.join(addonDir, 'src', 'main', 'resources', 'heldix.addon.json'), 'utf8'));
    const addon = { id: info.id || addonId, name: `${info.name || addonId}-Addon` };
    for (const file of walk(javaDir)) {
      const source = readFileSync(file, 'utf8');
      // Bis zum Ende der Anweisung lesen: withIcon(...) steht oft hinter .at(x, y)
      for (const match of source.matchAll(/register(Hud)?Module\(\s*ModuleSpec\.of\("([^"]+)",\s*"([^"]+)",\s*"([^"]*)"\)([^;]*)/g)) {
        const icon = /withIcon\("([a-z0-9-]+)"\)/.exec(match[5])?.[1] ?? 'addons';
        modules.push({ id: match[2], name: match[3], description: match[4], enabled: false, hud: Boolean(match[1]), icon, addon });
      }
    }
  }
  for (const module of modules) if (!icons[module.icon]) module.icon = 'cube';
  return modules;
}

function readCapes() {
  const file = path.join(root, 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'textures', 'cape', 'capes.json');
  return JSON.parse(readFileSync(file, 'utf8')).capes;
}

/**
 * Öffentlicher Update-Schlüssel (PEM) aus launcher/src/main/update-public-key.ts – damit prüft die Seite die Signatur
 * der Cosmetics im Browser. Fehlt die Datei oder ist kein Schlüssel eingetragen: null (dann zeigt die Seite keine).
 */
function readUpdatePublicKey() {
  const file = path.join(root, 'launcher', 'src', 'main', 'update-public-key.ts');
  if (!existsSync(file)) return null;
  const match = /UPDATE_PUBLIC_KEY[^=]*=\s*("(?:[^"\\]|\\.)*")/.exec(readFileSync(file, 'utf8'));
  if (!match) return null;
  const pem = JSON.parse(match[1]);
  return /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n?$/.test(pem) ? pem : null;
}

// ---------------------------------------------------------------------------------------------------------
// Bauen
// ---------------------------------------------------------------------------------------------------------

/** Baut die Seite nach outDir; gibt zurück, ob die Angaben für Impressum/Datenschutz vollständig sind. */
export function buildWebsite(outDir = path.join(websiteDir, 'dist')) {
  const configFile = path.join(websiteDir, 'site.config.json');
  const complete = existsSync(configFile);
  const config = JSON.parse(readFileSync(complete ? configFile : path.join(websiteDir, 'site.config.example.json'), 'utf8'));
  for (const key of ['betreiber', 'anschrift', 'email', 'hoster']) {
    if (!config[key] || (Array.isArray(config[key]) && config[key].length === 0)) throw new Error(`site.config.json: "${key}" fehlt`);
  }
  const githubUrl = typeof config.githubUrl === 'string' ? config.githubUrl.trim() : '';
  if (githubUrl && !/^https:\/\//.test(githubUrl)) throw new Error('site.config.json: "githubUrl" muss mit https:// beginnen (oder leer sein)');
  const siteUrl = (typeof config.siteUrl === 'string' && config.siteUrl.trim() ? config.siteUrl.trim() : 'https://heldixclient.com').replace(/\/+$/, '');
  if (!/^https:\/\//.test(siteUrl)) throw new Error('site.config.json: "siteUrl" muss mit https:// beginnen');

  const version = JSON.parse(readFileSync(path.join(root, 'launcher', 'package.json'), 'utf8')).version;
  const iconsSource = readFileSync(path.join(root, 'launcher', 'src', 'renderer', 'ui-icons.ts'), 'utf8');
  const icons = JSON.parse(iconsSource.slice(iconsSource.indexOf('{'), iconsSource.lastIndexOf('}') + 1));
  const svg = (name) => {
    if (!icons[name]) throw new Error(`Unbekanntes Icon: ${name}`);
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  };
  const stand = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  // --- Module
  const moduleTexts = existsSync(path.join(srcDir, 'data', 'module.json')) ? JSON.parse(readFileSync(path.join(srcDir, 'data', 'module.json'), 'utf8')) : {};
  const modules = readModules(icons);
  const builtIn = modules.filter((module) => !module.addon);
  const moduleCard = (module) => {
    const extra = moduleTexts[module.id] ?? {};
    const kind = module.addon ? 'addon' : module.hud ? 'hud' : 'funktion';
    const kindLabel = module.addon ? 'Addon' : module.hud ? 'HUD-Anzeige' : 'Funktion';
    const search = [module.name, module.description, extra.text, kindLabel, ...(extra.tasten ?? []), ...(extra.einstellungen ?? []), extra.hinweis].filter(Boolean).join(' ').toLowerCase();
    return `<article class="module-card tile reveal" id="modul-${escape(module.id)}" data-kategorie="${kind}" data-suche="${escape(search.replace(/\[\[|\]\]/g, ''))}">
  <div class="module-top"><span class="badge">${svg(module.icon)}</span><span class="chip ${kind === 'hud' ? 'accent' : kind === 'addon' ? 'warning' : ''}">${kindLabel}</span>${module.enabled ? '<span class="chip success">von Anfang an an</span>' : ''}</div>
  <h3>${escape(module.name)}</h3>
  <p class="module-short">${escape(module.description)}${module.addon ? ` · ${escape(module.addon.name)}` : ''}</p>
  ${extra.text ? `<p class="module-text">${inline(extra.text)}</p>` : ''}
  ${extra.tasten?.length ? `<ul class="module-keys" aria-label="Tasten">${extra.tasten.map((key) => `<li>${inline(key)}</li>`).join('')}</ul>` : ''}
  ${extra.einstellungen?.length ? `<details class="module-more"><summary>Einstellungen${svg('chevron-down')}</summary><ul>${extra.einstellungen.map((entry) => `<li>${inline(entry)}</li>`).join('')}</ul></details>` : ''}
  ${extra.hinweis ? `<p class="module-hint">${svg('info')}<span>${inline(extra.hinweis)}</span></p>` : ''}
  ${extra.bild ? `<button class="module-shot" type="button" data-full="/images/${escape(extra.bild)}">${svg('image')}Im Spiel ansehen</button>` : ''}
  ${module.addon ? `<a class="module-store" href="/addons#${escape(module.addon.id)}">${svg('addons')}Im Addon-Store ansehen</a>` : ''}
</article>`;
  };

  // --- Capes
  const capes = readCapes();
  const capeButtons = capes
    .map(
      (cape, index) => `<button class="cape-pick" type="button" role="radio" aria-checked="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}" data-cape="${escape(cape.id)}" data-name="${escape(cape.name)}" data-beschreibung="${escape(cape.description)}" data-frames="${Number(cape.frames) || 1}" data-fps="${Number(cape.fps) || 10}" data-glow="${cape.glow ? '1' : '0'}">
  <span class="cape-art" data-cape="${escape(cape.id)}" aria-hidden="true"></span><span class="cape-pick-name">${escape(cape.name)}</span></button>`,
    )
    .join('\n');
  const capeList = capes
    .map((cape) => `<li><strong>${escape(cape.name)}</strong> – ${escape(cape.description)}${cape.glow ? ' <span class="chip accent">leuchtet</span>' : ''}</li>`)
    .join('');

  // --- Hilfe und Entwickler
  const HILFE_KATEGORIEN = [
    ['erste-schritte', 'Erste Schritte', 'Installieren, anmelden, losspielen', 'play'],
    ['launcher', 'Launcher & Instanzen', 'Loader, Mods & Addons, Shaderpacks, Updates', 'loader-heldix'],
    ['grafik', 'Grafik & Leistung', 'Vulkan, OpenGL, FPS-Boost, Shader', 'performance'],
    ['spiel', 'Im Spiel', 'Heldix-Menü, Module, HUD, Capes & Cosmetics', 'modules'],
    ['freunde', 'Freunde & Konto', 'Freunde, Nachrichten, Privatsphäre, Web-Konto', 'friends'],
    ['probleme', 'Probleme lösen', 'Startprobleme, Abstürze, Anmeldung', 'warning'],
  ];
  const readCollection = (dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith('.md'))
          .map((name) => readArticle(path.join(dir, name)))
          .sort((a, b) => a.order - b.order || a.meta.titel.localeCompare(b.meta.titel, 'de'))
      : [];
  const hilfe = readCollection(path.join(srcDir, 'hilfe'));
  const entwickler = readCollection(path.join(srcDir, 'entwickler'));
  for (const article of hilfe) {
    if (!HILFE_KATEGORIEN.some(([id]) => id === article.meta.kategorie)) throw new Error(`hilfe/${article.slug}.md: unbekannte Kategorie „${article.meta.kategorie}“`);
  }
  const articleCard = (article, base) => `<a class="article-card" href="${base}/${article.slug}"><strong>${escape(article.meta.titel)}</strong><span>${escape(article.meta.beschreibung)}</span></a>`;
  const hilfeCategoriesHtml = HILFE_KATEGORIEN.map(([id, name, sub, icon]) => {
    const list = hilfe.filter((article) => article.meta.kategorie === id);
    if (!list.length) return '';
    return `<section class="help-category reveal" id="kategorie-${id}" aria-labelledby="kategorie-${id}-titel">
  <div class="help-category-head"><span class="badge">${svg(icon)}</span><div><h2 id="kategorie-${id}-titel">${escape(name)}</h2><p>${escape(sub)}</p></div></div>
  <div class="article-list">${list.map((article) => articleCard(article, '/hilfe')).join('')}</div>
</section>`;
  }).join('\n');
  const hilfeKategorieChips = HILFE_KATEGORIEN.filter(([id]) => hilfe.some((article) => article.meta.kategorie === id))
    .map(([id, name, , icon]) => `<a class="topic-chip" href="#kategorie-${id}">${svg(icon)}${escape(name)}</a>`)
    .join('');
  const entwicklerCardsHtml = entwickler
    .map((article, index) => `<a class="dev-card tile reveal" href="/entwickler/${article.slug}"><span class="dev-number">${String(index + 1).padStart(2, '0')}</span><h3>${escape(article.meta.titel)}</h3><p>${escape(article.meta.beschreibung)}</p><span class="story-link">Lesen${svg('chevron-right')}</span></a>`)
    .join('\n');

  const values = {
    VERSION: escape(version),
    YEAR: String(new Date().getFullYear()),
    STAND: escape(stand),
    BETREIBER: escape(config.betreiber),
    ANSCHRIFT_HTML: config.anschrift.map(escape).join('<br>'),
    EMAIL: escape(config.email),
    TELEFON_HTML: config.telefon ? `<br>Telefon: ${escape(config.telefon)}` : '',
    HOSTER: escape(config.hoster),
    AUFSICHT_HTML: config.aufsichtsbehoerde?.length
      ? `<p>Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO). Für uns zuständig ist:</p>
  <address>${config.aufsichtsbehoerde.map(escape).join('<br>')}</address>`
      : '<p>Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), zum Beispiel in dem Bundesland, in dem du wohnst.</p>',
    PROJEKT_HTML: config.projektVon?.name
      ? `<p>HeldixClient ist ein Projekt von ${config.projektVon.url ? `<a href="${escape(config.projektVon.url)}">${escape(config.projektVon.name)}</a>` : escape(config.projektVon.name)}.</p>`
      : '',
    DOWNLOAD_URL: '/download',
    GITHUB_URL: escape(githubUrl),
    SITE_URL: escape(siteUrl),
    CONFIG_WARNING: complete ? '' : '<p class="notice">Platzhalter: Die Angaben zum Betreiber fehlen noch. Vor dem Veröffentlichen website/site.config.json ausfüllen und neu bauen.</p>',
    MODULE_ANZAHL: String(builtIn.length),
    MODULE_GESAMT: String(modules.length),
    MODULE_HUD_ANZAHL: String(modules.filter((module) => module.hud && !module.addon).length),
    MODULE_FUNKTION_ANZAHL: String(modules.filter((module) => !module.hud && !module.addon).length),
    MODULE_ADDON_ANZAHL: String(modules.filter((module) => module.addon).length),
    MODULE_KARTEN_HTML: modules.map(moduleCard).join('\n'),
    MODULE_KACHELN_HTML: builtIn
      .slice(0, 8)
      .map((module) => `<a class="tile mini-tile reveal" href="/module#modul-${escape(module.id)}"><span class="badge">${svg(module.icon)}</span><h3>${escape(module.name)}</h3><p>${escape(module.description)}</p></a>`)
      .join('\n'),
    CAPES_ANZAHL: String(capes.length),
    CAPES_AUSWAHL_HTML: capeButtons,
    CAPES_LISTE_HTML: capeList,
    HILFE_KATEGORIEN_HTML: hilfeCategoriesHtml,
    HILFE_THEMEN_HTML: hilfeKategorieChips,
    HILFE_ANZAHL: String(hilfe.length),
    ENTWICKLER_KARTEN_HTML: entwicklerCardsHtml,
    // Das ganze Icon-Set für Seiten, die ihre Icons erst zur Laufzeit kennen (Addon-Store: das Icon steht im Manifest)
    ICONS_ALLE_HTML: `<template id="icons">\n${Object.keys(icons)
      .sort()
      .map((name) => `  <span data-icon="${escape(name)}">${svg(name)}</span>`)
      .join('\n')}\n</template>`,
  };

  const partials = path.join(srcDir, '_partials');
  const sitemap = [];

  /** Seitenangaben aus <!--seite {…}--> → Titel, Beschreibung, Open Graph, kanonische Adresse, noindex. */
  const pageMeta = (text, urlPath) => {
    const match = /<!--seite\s+(\{[\s\S]*?\})\s*-->\n?/.exec(text);
    if (!match) return { text, meta: '', noindex: false };
    const data = JSON.parse(match[1]);
    const title = data.titel ? `${data.titel} – HeldixClient` : 'HeldixClient';
    const image = `${siteUrl}${data.bild || '/images/launcher-start.png'}`;
    const url = `${siteUrl}${urlPath}`;
    const lines = [
      `<title>${escape(data.titelVoll || title)}</title>`,
      data.beschreibung ? `<meta name="description" content="${escape(data.beschreibung)}">` : '',
      data.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${escape(url)}">`,
      `<meta property="og:site_name" content="HeldixClient">`,
      `<meta property="og:locale" content="de_DE">`,
      `<meta property="og:type" content="${data.typ || 'website'}">`,
      `<meta property="og:title" content="${escape(data.titelVoll || title)}">`,
      data.beschreibung ? `<meta property="og:description" content="${escape(data.beschreibung)}">` : '',
      `<meta property="og:url" content="${escape(url)}">`,
      `<meta property="og:image" content="${escape(image)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
    ].filter(Boolean);
    return { text: text.replace(match[0], ''), meta: lines.join('\n'), noindex: Boolean(data.noindex) };
  };

  const render = (raw, urlPath, extra = {}) => {
    const { text: withoutMeta, meta, noindex } = pageMeta(raw, urlPath);
    let out = withoutMeta.replace(/\{\{include:([\w.-]+)\}\}/g, (_, name) => readFileSync(path.join(partials, name), 'utf8').trimEnd());
    out = out.replace('{{SEITE_META}}', meta);
    // Bedingte Blöcke (auch über mehrere Zeilen)
    out = out.replace(/\{\{([#^])github\}\}([\s\S]*?)\{\{\/github\}\}/g, (_, mode, body) => ((mode === '#') === Boolean(githubUrl) ? body : ''));
    out = out.replace(/\{\{icon:([\w-]+)\}\}/g, (_, name) => svg(name));
    out = out.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
      if (key in extra) return extra[key];
      if (!(key in values)) throw new Error(`Unbekannter Platzhalter: ${match}`);
      return values[key];
    });
    if (/\{\{[#^/]?[a-z]/.test(out)) throw new Error(`Unverarbeiteter Block in ${urlPath}`);
    if (!noindex && urlPath !== '/404') sitemap.push(urlPath);
    return out;
  };

  rmSync(outDir, { recursive: true, force: true });
  for (const dir of ['assets', 'images', 'fonts', 'vendor', 'capes', 'hilfe', 'entwickler']) mkdirSync(path.join(outDir, dir), { recursive: true });

  // Seiten aus src/*.html
  for (const file of readdirSync(srcDir)) {
    const source = path.join(srcDir, file);
    if (file.endsWith('.html')) {
      const name = file.replace(/\.html$/, '');
      const urlPath = name === 'index' ? '/' : `/${name}`;
      writeFileSync(path.join(outDir, file), render(readFileSync(source, 'utf8'), urlPath));
    } else if (file.endsWith('.css') || file.endsWith('.js')) copyFileSync(source, path.join(outDir, file));
  }

  // Artikel (Hilfe-Center und Entwickler) aus der Vorlage
  const articleTemplate = readFileSync(path.join(srcDir, '_vorlagen', 'artikel.html'), 'utf8');
  const writeArticles = (list, area) => {
    for (const article of list) {
      const { html, toc } = renderMarkdown(article.body);
      const category = area === 'hilfe' ? HILFE_KATEGORIEN.find(([id]) => id === article.meta.kategorie) : null;
      const siblings = (area === 'hilfe' ? list.filter((other) => other.meta.kategorie === article.meta.kategorie) : list).filter((other) => other.slug !== article.slug);
      const extra = {
        BEREICH: area === 'hilfe' ? 'Hilfe' : 'Entwickler',
        BEREICH_URL: area === 'hilfe' ? '/hilfe' : '/entwickler',
        KATEGORIE_HTML: category ? `<a href="/hilfe#kategorie-${category[0]}">${escape(category[1])}</a>` : `<span aria-current="page">${escape(article.meta.titel)}</span>`,
        ARTIKEL_TITEL: escape(article.meta.titel),
        ARTIKEL_BESCHREIBUNG: escape(article.meta.beschreibung),
        ARTIKEL_HTML: html,
        ARTIKEL_TOC_HTML: toc.length > 1 ? `<nav class="toc" aria-label="Auf dieser Seite"><p>Auf dieser Seite</p><ol>${toc.map((entry) => `<li><a href="#${entry.id}">${escape(entry.text)}</a></li>`).join('')}</ol></nav>` : '',
        VERWANDT_HTML: siblings.length ? `<div class="related"><h2>${area === 'hilfe' ? 'Mehr zum Thema' : 'Weitere Seiten'}</h2><div class="article-list">${siblings.slice(0, 6).map((other) => articleCard(other, `/${area}`)).join('')}</div></div>` : '',
        SUPPORT_HTML:
          area === 'hilfe'
            ? `<aside class="support-box">${svg('info')}<div><h2>Nicht gelöst?</h2><p>Schreib dem Team – die Antwort bekommst du im Konto und im Spiel.</p></div><a class="button small" href="/konto#ziel=support">Support-Anfrage stellen</a></aside>`
            : `<aside class="support-box">${svg('chat')}<div><h2>Fragen zur API?</h2><p>Schreib dem Team über eine Support-Anfrage – auch für die API-Datei und das Beispielprojekt.</p></div><a class="button small" href="/konto#ziel=support">Support-Anfrage stellen</a></aside>`,
      };
      const page = articleTemplate.replace('<!--seite {}-->', `<!--seite ${JSON.stringify({ titel: article.meta.titel, beschreibung: article.meta.beschreibung, typ: 'article' })}-->`);
      writeFileSync(path.join(outDir, area, `${article.slug}.html`), render(page, `/${area}/${article.slug}`, extra));
    }
  };
  writeArticles(hilfe, 'hilfe');
  writeArticles(entwickler, 'entwickler');
  // Suchindex für das Hilfe-Center
  writeFileSync(
    path.join(outDir, 'hilfe', 'suche.json'),
    JSON.stringify(
      hilfe.map((article) => ({
        slug: article.slug,
        titel: article.meta.titel,
        beschreibung: article.meta.beschreibung,
        kategorie: HILFE_KATEGORIEN.find(([id]) => id === article.meta.kategorie)?.[1] ?? '',
        stichworte: article.meta.stichworte ?? '',
        text: article.plain.slice(0, 4000),
      })),
    ),
  );

  // Dateien
  copyFileSync(path.join(root, 'launcher', 'src', 'renderer', 'logo.svg'), path.join(outDir, 'assets', 'logo.svg'));
  copyFileSync(path.join(root, 'launcher', 'src', 'renderer', 'background.svg'), path.join(outDir, 'assets', 'background.svg'));
  copyFileSync(path.join(root, 'launcher', 'build', 'icon.png'), path.join(outDir, 'assets', 'icon.png'));
  writeFileSync(path.join(outDir, 'assets', 'standard-skin.png'), defaultSkin());
  for (const image of readdirSync(path.join(root, 'docs', 'images')).filter((name) => /\.(png|jpg|webp)$/.test(name))) copyFileSync(path.join(root, 'docs', 'images', image), path.join(outDir, 'images', image));
  const fontDir = path.join(root, 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'font');
  for (const font of FONTS) copyFileSync(path.join(fontDir, font), path.join(outDir, 'fonts', font));
  copyFileSync(path.join(root, 'mod', 'src', 'main', 'resources', 'licenses', 'Inter-OFL.txt'), path.join(outDir, 'fonts', 'Inter-OFL.txt'));
  // Capes: Texturen (24 Bilder untereinander) und Leuchtebenen
  const capeDir = path.join(root, 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'textures', 'cape');
  for (const cape of capes) {
    copyFileSync(path.join(capeDir, `${cape.id}.png`), path.join(outDir, 'capes', `${cape.id}.png`));
    if (cape.glow && existsSync(path.join(capeDir, `${cape.id}_glow.png`))) copyFileSync(path.join(capeDir, `${cape.id}_glow.png`), path.join(outDir, 'capes', `${cape.id}_glow.png`));
  }
  // Liste der eingebauten Capes für Seiten, die sie erst zur Laufzeit brauchen (cosmetics-common.js: loadBuiltinCapes)
  writeFileSync(
    path.join(outDir, 'capes', 'capes.json'),
    JSON.stringify({ capes: capes.map((cape) => ({ id: cape.id, name: cape.name, description: cape.description, frames: Number(cape.frames) || 1, fps: Number(cape.fps) || 10, glow: Boolean(cape.glow) })) }),
  );
  // Öffentlicher Update-Schlüssel für die Prüfung der Cosmetics im Browser (cosmetics-common.js)
  const updateKey = readUpdatePublicKey();
  writeFileSync(
    path.join(outDir, 'update-key.js'),
    `// Gebaut von website/build.mjs aus launcher/src/main/update-public-key.ts – nicht von Hand ändern.\n// Öffentlicher Ed25519-Schlüssel, mit dem das HeldixClient-Team Cosmetics (und Addons, Updates) signiert; null = keiner.\nexport const UPDATE_PUBLIC_KEY = ${JSON.stringify(updateKey)};\n`,
  );
  // 3D-Ansicht (skinview3d mit three.js, MIT-Lizenz) samt Lizenztexten
  const modules3d = path.join(root, 'launcher', 'node_modules');
  copyFileSync(path.join(modules3d, 'skinview3d', 'bundles', 'skinview3d.bundle.js'), path.join(outDir, 'vendor', 'skinview3d.bundle.js'));
  copyFileSync(path.join(modules3d, 'skinview3d', 'LICENSE'), path.join(outDir, 'vendor', 'skinview3d.LICENSE.txt'));
  copyFileSync(path.join(modules3d, 'three', 'LICENSE'), path.join(outDir, 'vendor', 'three.LICENSE.txt'));

  // Suchmaschinen: Sitemap ohne angemeldete Seiten, robots.txt mit Verweis darauf
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    path.join(outDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap
      .sort()
      .map((url) => `  <url><loc>${escape(siteUrl + url)}</loc><lastmod>${today}</lastmod></url>`)
      .join('\n')}\n</urlset>\n`,
  );
  writeFileSync(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
  if (!complete) writeFileSync(path.join(outDir, '.platzhalter'), 'Impressum und Datenschutz enthalten noch Platzhalter (website/site.config.json fehlt).\n');
  return complete;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const complete = buildWebsite();
  console.log(`Webseite gebaut: website/dist${complete ? '' : ' – ACHTUNG: Impressum/Datenschutz mit Platzhaltern (website/site.config.json fehlt)'}`);
}
