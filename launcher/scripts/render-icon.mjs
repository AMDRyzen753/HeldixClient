// Rendert das HeldixClient-Logo als PNG. Aufruf: npm run icon
// Erzeugt build/icon.png (512 px, für Installer und .exe), build/discord-logo.png (1024 px, zum Hochladen
// als Discord-Bild "logo"), das 128-px-Icon der Mod und das Logo für den Ladebildschirm im Spiel.
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modAssets = path.join(launcherDir, '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient');
// Gleiche Datei, die auch die Oberfläche nutzt
const svg = await readFile(path.join(launcherDir, 'src', 'renderer', 'logo.svg'), 'utf8');
// Schrift Inter wie in Launcher und Spiel (aus der Client-Mod, als Daten-URL eingebettet)
const fontDir = path.join(modAssets, 'font');
const inter = async (file) => `url(data:font/ttf;base64,${(await readFile(path.join(fontDir, file))).toString('base64')})`;
const fontFaces = `<style>@font-face{font-family:Inter;src:${await inter('inter-bold.ttf')};font-weight:700 900}@font-face{font-family:Inter;src:${await inter('inter-semibold.ttf')};font-weight:600}</style>`;

/** Rendert HTML in ein unsichtbares Fenster und gibt das Bild zurück. */
async function render(html, width, height) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = (await win.webContents.capturePage()).resize({ width, height, quality: 'best' });
  win.destroy();
  return image;
}

const iconHtml = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
<div style="width:1024px;height:1024px">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</div></body></html>`;

// Ladebildschirm: Symbol + Schriftzug. Im Spiel ist beim Start noch keine Schrift geladen, deshalb als Bild.
const loadingHtml = `<!doctype html><html><head>${fontFaces}</head><body style="margin:0;background:transparent;overflow:hidden">
<div style="width:1400px;height:360px;display:flex;align-items:center;justify-content:center;gap:44px;
  font-family:Inter,'Segoe UI',sans-serif">
  <div style="width:250px;height:250px;flex:none">${svg.replace('<svg ', '<svg width="250" height="250" ')}</div>
  <div style="display:flex;align-items:baseline;gap:30px;white-space:nowrap">
    <span style="font-size:150px;font-weight:700;letter-spacing:2px;color:#ffffff">HELDIX</span>
    <span style="font-size:112px;font-weight:600;letter-spacing:14px;color:#93c5fd">CLIENT</span>
  </div>
</div></body></html>`;

// Zwischen den Bildern ist kurz kein Fenster offen – dann nicht beenden
// Weiches Leuchten hinter dem Logo (radialer Verlauf, wird im Spiel skaliert)
const glowHtml = '<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><div style="width:512px;height:512px;background:radial-gradient(circle at 50% 50%, rgba(56,189,248,0.55) 0%, rgba(37,99,235,0.28) 32%, rgba(37,99,235,0.08) 55%, rgba(37,99,235,0) 70%)"></div></body></html>';

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const large = await render(iconHtml, 1024, 1024);
  const image = large.resize({ width: 512, height: 512, quality: 'best' });

  const buildDir = path.join(launcherDir, 'build');
  await mkdir(buildDir, { recursive: true });
  await writeFile(path.join(buildDir, 'icon.png'), image.toPNG());
  await writeFile(path.join(buildDir, 'discord-logo.png'), large.toPNG());
  const modIcon = image.resize({ width: 128, height: 128, quality: 'best' }).toPNG();
  await writeFile(path.join(modAssets, 'icon.png'), modIcon);
  // Symbol des Ressourcenpakets der Mod (Optionen → Ressourcenpakete)
  await writeFile(path.join(modAssets, '..', '..', 'pack.png'), modIcon);

  const loading = await render(loadingHtml, 1400, 360);
  await mkdir(path.join(modAssets, 'textures', 'gui'), { recursive: true });
  await writeFile(path.join(modAssets, 'textures', 'gui', 'loading_logo.png'), loading.resize({ width: 1024, height: 263, quality: 'best' }).toPNG());

  const glow = await render(glowHtml, 512, 512);
  await writeFile(path.join(modAssets, 'textures', 'gui', 'loading_glow.png'), glow.resize({ width: 256, height: 256, quality: 'best' }).toPNG());

  console.log('Icons geschrieben: build/icon.png, build/discord-logo.png, mod/.../icon.png und mod/.../textures/gui/loading_logo.png');
  app.quit();
});
