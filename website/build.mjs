// Baut die Webseite von HeldixClient: website/src → website/dist
//
//   node website/build.mjs
//
// - setzt Kopf, Navigation und Fußzeile ein ({{include:datei.html}} aus src/_partials)
// - Icons aus dem Heldix-Icon-Set ({{icon:name}}, dieselben wie in Launcher und Spiel)
// - Version des Launchers, Links und die Angaben für Impressum/Datenschutz aus site.config.json
//   (fehlt sie, nimmt der Build site.config.example.json und die Seiten zeigen einen Hinweis)
// - Bilder (docs/images), Logo, Hintergrund und die Schrift Inter (aus der Mod) werden mitkopiert
// Die Adresse der API (__API_DOMAIN__) setzt erst der Server-Installer ein.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(websiteDir, '..');
const IMAGES = ['launcher-start.png', 'launcher-instanzen.png', 'spiel-hauptmenue.png', 'spiel-heldix-menue.png', 'spiel-cape.png',
  'capes.png', 'spiel-shader.png', 'spiel-ladebildschirm.png', 'spiel-mehrspieler.png', 'spiel-hud-editor.png', 'spiel-einzelspieler.png'];
const FONTS = ['inter-medium.ttf', 'inter-semibold.ttf', 'inter-bold.ttf'];

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Baut die Seite nach outDir; gibt zurück, ob die Angaben für Impressum/Datenschutz vollständig sind. */
export function buildWebsite(outDir = path.join(websiteDir, 'dist')) {
  const configFile = path.join(websiteDir, 'site.config.json');
  const complete = existsSync(configFile);
  const config = JSON.parse(readFileSync(complete ? configFile : path.join(websiteDir, 'site.config.example.json'), 'utf8'));
  for (const key of ['betreiber', 'anschrift', 'email', 'hoster', 'downloadUrl', 'githubUrl']) {
    if (!config[key] || (Array.isArray(config[key]) && config[key].length === 0)) throw new Error(`site.config.json: "${key}" fehlt`);
  }
  for (const key of ['downloadUrl', 'githubUrl']) {
    if (!/^https:\/\//.test(config[key])) throw new Error(`site.config.json: "${key}" muss mit https:// beginnen`);
  }

  const version = JSON.parse(readFileSync(path.join(root, 'launcher', 'package.json'), 'utf8')).version;
  const iconsSource = readFileSync(path.join(root, 'launcher', 'src', 'renderer', 'ui-icons.ts'), 'utf8');
  const icons = JSON.parse(iconsSource.slice(iconsSource.indexOf('{'), iconsSource.lastIndexOf('}') + 1));
  const stand = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

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
    DOWNLOAD_URL: escape(config.downloadUrl),
    GITHUB_URL: escape(config.githubUrl),
    CONFIG_WARNING: complete ? ''
      : '<p class="notice">Platzhalter: Die Angaben zum Betreiber fehlen noch. Vor dem Veröffentlichen website/site.config.json ausfüllen und neu bauen.</p>',
  };

  const partials = path.join(websiteDir, 'src', '_partials');
  const render = (text) => {
    let out = text.replace(/\{\{include:([\w.-]+)\}\}/g, (_, name) => readFileSync(path.join(partials, name), 'utf8').trimEnd());
    out = out.replace(/\{\{icon:([\w-]+)\}\}/g, (_, name) => {
      if (!icons[name]) throw new Error(`Unbekanntes Icon: ${name}`);
      return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
    });
    out = out.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
      if (!(key in values)) throw new Error(`Unbekannter Platzhalter: ${match}`);
      return values[key];
    });
    return out;
  };

  rmSync(outDir, { recursive: true, force: true });
  for (const dir of ['assets', 'images', 'fonts']) mkdirSync(path.join(outDir, dir), { recursive: true });
  for (const file of readdirSync(path.join(websiteDir, 'src'))) {
    const source = path.join(websiteDir, 'src', file);
    if (file.endsWith('.html')) writeFileSync(path.join(outDir, file), render(readFileSync(source, 'utf8')));
    else if (file.endsWith('.css') || file.endsWith('.js')) copyFileSync(source, path.join(outDir, file));
  }
  copyFileSync(path.join(root, 'launcher', 'src', 'renderer', 'logo.svg'), path.join(outDir, 'assets', 'logo.svg'));
  copyFileSync(path.join(root, 'launcher', 'src', 'renderer', 'background.svg'), path.join(outDir, 'assets', 'background.svg'));
  copyFileSync(path.join(root, 'launcher', 'build', 'icon.png'), path.join(outDir, 'assets', 'icon.png'));
  for (const image of IMAGES) copyFileSync(path.join(root, 'docs', 'images', image), path.join(outDir, 'images', image));
  const fontDir = path.join(root, 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'font');
  for (const font of FONTS) copyFileSync(path.join(fontDir, font), path.join(outDir, 'fonts', font));
  copyFileSync(path.join(root, 'mod', 'src', 'main', 'resources', 'licenses', 'Inter-OFL.txt'), path.join(outDir, 'fonts', 'Inter-OFL.txt'));
  writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  if (!complete) writeFileSync(path.join(outDir, '.platzhalter'), 'Impressum und Datenschutz enthalten noch Platzhalter (website/site.config.json fehlt).\n');
  return complete;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const complete = buildWebsite();
  console.log(`Webseite gebaut: website/dist${complete ? '' : ' – ACHTUNG: Impressum/Datenschutz mit Platzhaltern (website/site.config.json fehlt)'}`);
}
