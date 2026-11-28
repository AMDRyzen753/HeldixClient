// HeldixClient – Webseite: Vorschaukarten (Open Graph/Twitter, 1200×630) je Seite vorab rendern → website/src/og/*.png
//
//   node website/build.mjs                                   (zuerst bauen: Schrift, Bilder und design.css liegen in dist)
//   launcher/node_modules/.bin/electron website/werkzeug/og-karten.cjs [<dist-Ordner>]
//
// Electron läuft unsichtbar (Offscreen-Fenster, kein Fokus). Ein kleiner Server liefert dist und diesen Ordner aus;
// jede Karte ist eine Seite aus design.css + og-karten.css. Die PNGs gehören ins Repo (build.mjs kopiert src/og nach
// dist/og und trägt sie als og:image/twitter:image ein). Neu rendern, wenn sich Texte, Bilder oder das Design ändern.
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const werkzeug = __dirname;
const website = path.resolve(werkzeug, '..');
const dist = path.resolve(process.argv.slice(2).find((arg) => !arg.startsWith('-') && !arg.endsWith('.cjs')) ?? path.join(website, 'dist'));
const out = path.join(website, 'src', 'og');
const version = JSON.parse(fs.readFileSync(path.join(website, '..', 'launcher', 'package.json'), 'utf8')).version;

// Karten: Name (= Seite), Kennzeile, Titel, Unterzeile, Bild aus /bilder (oder null), Chips
const KARTEN = [
  ['start', 'Launcher und Client für Minecraft', 'Minecraft macht mehr Spaß zusammen.', 'Freunde einladen, Party, Voice auch im Browser, Welt teilen – kostenlos für Windows und Mac.', 'welt-zusammen.webp', ['Kostenlos', 'Kein Tracking', `Version ${version}`]],
  ['zusammen', 'Zusammen spielen', 'Mit Freunden spielen – ohne Umwege.', 'Freunde, Party, Voice Chat und deine Welt für alle – ohne eigenen Server.', 'party-spiel.webp', ['Party', 'Voice', 'Welt teilen']],
  ['warum', 'Warum HeldixClient', 'Kurz und ehrlich.', 'Kostenlos ohne Abo, kein Tracking, Server in Deutschland, signierte Updates und Addons.', null, ['Kostenlos', 'Kein Tracking', 'Server in Deutschland', 'Signiert']],
  ['download', 'Download', 'HeldixClient herunterladen', 'Kostenlos für Windows 10/11 und macOS 11 oder neuer – in einer Minute eingerichtet.', 'einrichtung-willkommen.webp', [`Version ${version}`, 'Windows', 'Mac']],
  ['module', 'Funktionen', 'Dein Spiel, deine Regeln.', 'Heldix-Menü, HUD-Editor, Vulkan, Shader und Module wie Freelook, Zoom und Wegpunkte.', 'spiel-heldix-menue.webp', ['HUD-Editor', 'Vulkan', 'Module']],
  ['cosmetics', 'Cosmetics', 'Hüte, Flügel, Auren – in 3D.', 'Animierte Capes und Cosmetics, die alle HeldixClient-Spieler sehen.', 'cosmetics-animiert.webp', ['Animiert', 'Kostenlos']],
  ['addons', 'Addon-Store', 'Mehr Funktionen mit einem Klick', 'Voice Chat, Minimap, Spotify und mehr – vom Team geprüft und signiert.', 'einrichtung-addons.webp', ['Geprüft', 'Signiert']],
  ['hilfe', 'Hilfe-Center', 'Wobei können wir helfen?', 'Anleitungen von der Installation über Party und Welt teilen bis zur Fehlersuche.', null, ['Installation', 'Freunde', 'Welt teilen', 'Probleme lösen']],
  ['entwickler', 'Für Entwickler', 'Erweitere HeldixClient.', 'Heldix-Addons mit stabiler Java-API – einreichen, prüfen lassen, im Store veröffentlichen.', null, ['Addon-API', 'Heldix Loader']],
  ['neuigkeiten', 'Neuigkeiten', `Neu in ${version}`, 'Setup teilen per Link, öffentliche Spielerprofile, Partner-Server mit eigenem Plugin und „Im Launcher“ bei Freunden.', 'launcher-welten.webp', ['Versionsverlauf']],
  ['einladung', 'Einladung', 'Du bist eingeladen!', 'Hol dir HeldixClient – wer neu dazukommt, bekommt den Freundesfunken, und ihr seid gleich befreundet.', 'einladung-dialog.webp', ['Freundesfunken', 'Kostenlos']],
  ['das-team', 'Das Team', 'Die Menschen hinter HeldixClient', 'Entwicklung, Design, Support und Moderation – und was die Abzeichen bedeuten.', null, ['Team', 'Abzeichen']],
  ['status', 'Status', 'Läuft der Heldix-Dienst?', 'Freunde, Party, Nachrichten, Welt teilen und Capes im Überblick.', null, ['Live']],
  // 0.14.1: Partner-Programm und allgemeine Karte für Spielerprofile (der Dienst nimmt sie für unbekannte/private Profile)
  ['partner', 'Partner-Programm', 'HeldixClient für deinen Server', 'Voice-Gruppen, Server-HUD, Belohnungs-Cosmetics und Server-Regeln – kostenlos für Partner-Server.', null, ['Kostenlos', 'Paper', 'Abzeichen „Partner“']],
  ['spieler', 'Spielerprofil', 'Spielt mit HeldixClient', '3D-Figur mit Cape und Cosmetics, Abzeichen und Welten – öffentliche Profile auf heldixclient.com.', null, ['Profil', 'Zusammen spielen']],
];

const escape = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function page([, eyebrow, title, sub, image, chips]) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="/design.css"><link rel="stylesheet" href="/werkzeug/og-karten.css"></head><body>
<div class="og${image ? '' : ' og--ohne-bild'}">
  <div class="og__text">
    <span class="brand"><img src="/assets/logo.svg" alt="">Heldix<span>Client</span></span>
    <span class="og__eyebrow">${escape(eyebrow)}</span>
    <span class="og__titel">${escape(title)}</span>
    <span class="og__unter">${escape(sub)}</span>
    <span class="og__chips">${chips.map((chip) => `<span class="chip chip--accent">${escape(chip)}</span>`).join('')}</span>
  </div>
  ${image ? `<figure class="og__bild"><img src="/bilder/${escape(image)}" alt=""></figure>` : ''}
</div></body></html>`;
}

const TYPES = { '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.html': 'text/html; charset=utf-8' };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/karte/')) {
        const card = KARTEN.find(([name]) => name === url.pathname.slice(7));
        res.writeHead(card ? 200 : 404, { 'content-type': TYPES['.html'] });
        res.end(card ? page(card) : 'unbekannt');
        return;
      }
      const base = url.pathname.startsWith('/werkzeug/') ? werkzeug : dist;
      const file = path.join(base, decodeURIComponent(url.pathname.replace(/^\/werkzeug\//, '/')));
      if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.whenReady().then(async () => {
  if (!fs.existsSync(path.join(dist, 'design.css'))) {
    console.error(`Kein gebauter Stand in ${dist} – zuerst node website/build.mjs`);
    app.exit(1);
    return;
  }
  fs.mkdirSync(out, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ show: false, width: 1200, height: 630, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  for (const card of KARTEN) {
    await win.loadURL(`${base}/karte/${card[0]}`);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))))');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 });
    const png = image.resize({ width: 1200, height: 630, quality: 'best' }).toPNG();
    fs.writeFileSync(path.join(out, `${card[0]}.png`), png);
    console.log(`og/${card[0]}.png ${(png.length / 1024).toFixed(0)} KB`);
  }
  server.close();
  app.exit(0);
});
