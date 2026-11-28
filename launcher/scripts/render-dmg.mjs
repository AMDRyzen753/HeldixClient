// Erzeugt das Hintergrundbild des Mac-DMG im Heldix-Design (dunkel, Logo, Pfeil von der App zu „Programme“, kurzer
// Text „Zum Installieren in Programme ziehen“):
//   build/dmg-background.png      540 × 380 (1×, bestimmt die Fenstergröße im Finder)
//   build/dmg-background@2x.png  1080 × 760 (Retina; electron-builder legt beide mit tiffutil zu einer TIFF zusammen)
// Die Symbole von App und Programme-Link legt der Finder darüber – ihre Mitte steht in package.json unter
// build.dmg.contents (x/y in Punkten). Die Werte unten (APP, APPS) müssen dazu passen.
// Gezeichnet wird wie bei den anderen Grafiken als HTML in einem unsichtbaren Fenster (Logo, Motiv und Schrift Inter
// aus der Oberfläche bzw. der Client-Mod); Electron liefert das PNG. Ohne weitere Abhängigkeiten.
// Aufruf: npm run dmg-art
import { app, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildDir = path.join(launcherDir, 'build');
const rendererDir = path.join(launcherDir, 'src', 'renderer');
const fontDir = path.join(launcherDir, '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'font');

/** Fenstergröße und Mitte der beiden Symbole (Punkte) – wie build.dmg in package.json */
const WIDTH = 540;
const HEIGHT = 380;
const APP = { x: 150, y: 196 };
const APPS = { x: 390, y: 196 };
const ICON = 96;

// eigenes Profil im Temp-Ordner: das Skript soll nichts unter %APPDATA% anlegen; Pixel genau (Windows-Skalierung aus)
app.setPath('userData', path.join(os.tmpdir(), 'heldix-dmg-art'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// zwischen den beiden Bildern ist kurz kein Fenster offen – dann nicht beenden
app.on('window-all-closed', () => {});

const pkg = JSON.parse(await readFile(path.join(launcherDir, 'package.json'), 'utf8'));
const dmg = pkg.build?.dmg ?? {};
const contents = dmg.contents ?? [];
const file = contents.find((c) => c.type === 'file');
const link = contents.find((c) => c.type === 'link');
if (!file || !link || file.x !== APP.x || file.y !== APP.y || link.x !== APPS.x || link.y !== APPS.y || dmg.iconSize !== ICON
  || dmg.window?.width !== WIDTH || dmg.window?.height !== HEIGHT) {
  throw new Error('build.dmg in package.json passt nicht zu render-dmg.mjs (Fenster, Positionen oder iconSize).');
}

const logo = await readFile(path.join(rendererDir, 'logo.svg'), 'utf8');
const art = `data:image/svg+xml;base64,${(await readFile(path.join(rendererDir, 'background.svg'))).toString('base64')}`;
const inter = async (name) => `url(data:font/ttf;base64,${(await readFile(path.join(fontDir, name))).toString('base64')})`;
const fonts = `@font-face{font-family:Inter;src:${await inter('inter-bold.ttf')};font-weight:700 900}
@font-face{font-family:Inter;src:${await inter('inter-semibold.ttf')};font-weight:600}
@font-face{font-family:Inter;src:${await inter('inter-medium.ttf')};font-weight:100 500}`;
const svgLogo = (size) => logo.replace('<svg ', `<svg width="${size}" height="${size}" `);

// Pfeil zwischen den Symbolen: von rechts neben der App bis links vor Programme
const arrowLeft = APP.x + ICON / 2 + 22;
const arrowRight = APPS.x - ICON / 2 - 22;
const arrowWidth = arrowRight - arrowLeft;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box}html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;font-family:Inter,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;background:#070a12}
.bg{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 0%,#0e1a33 0%,#080c16 55%,#05070d 100%)}
.art{position:absolute;left:-40px;right:-40px;bottom:-30px;height:170px;background:url(${art}) 50% 85%/cover no-repeat;opacity:.55;
  -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 70%)}
.glow{position:absolute;left:50%;top:${APP.y}px;width:520px;height:220px;transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,rgba(56,189,248,.16),rgba(37,99,235,.06) 60%,rgba(37,99,235,0) 100%)}
.head{position:absolute;left:0;right:0;top:26px;display:flex;align-items:center;justify-content:center;gap:10px;color:#fff}
.head .logo{width:30px;height:30px;filter:drop-shadow(0 4px 10px rgba(8,20,50,.8))}
.word{display:flex;align-items:baseline;gap:6px;white-space:nowrap}
.word b{font-size:17px;font-weight:700;letter-spacing:.6px}
.word span{font-size:12.5px;font-weight:600;letter-spacing:3px;color:#93c5fd}
.pad{position:absolute;width:${ICON + 36}px;height:${ICON + 36}px;border-radius:30px;transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,rgba(148,197,255,.10),rgba(148,197,255,.03) 70%,rgba(148,197,255,0));border:1px solid rgba(148,197,255,.10)}
.arrow{position:absolute;left:${arrowLeft}px;top:${APP.y - 14}px;width:${arrowWidth}px;height:28px}
.text{position:absolute;left:0;right:0;top:${APP.y + ICON / 2 + 54}px;text-align:center}
.text b{display:block;font-size:15px;font-weight:600;color:#e6eeff;letter-spacing:.1px}
.text span{display:block;margin-top:6px;font-size:11px;font-weight:500;color:#8ea3c7}
</style></head><body>
<div class="bg"></div><div class="art"></div><div class="glow"></div>
<div class="head"><div class="logo">${svgLogo(30)}</div><div class="word"><b>HELDIX</b><span>CLIENT</span></div></div>
<div class="pad" style="left:${APP.x}px;top:${APP.y}px"></div>
<div class="pad" style="left:${APPS.x}px;top:${APPS.y}px"></div>
<svg class="arrow" viewBox="0 0 ${arrowWidth} 28" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="${arrowWidth}" y1="14" y2="14"><stop offset="0" stop-color="#3b82f6" stop-opacity="0"/><stop offset=".45" stop-color="#3b82f6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
  <path d="M2 14 H${arrowWidth - 8}" stroke="url(#g)" stroke-width="3.2" stroke-linecap="round" fill="none"/>
  <path d="M${arrowWidth - 18} 5 L${arrowWidth - 6} 14 L${arrowWidth - 18} 23" stroke="#22d3ee" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
<div class="text"><b>Zum Installieren in Programme ziehen</b><span>Danach HeldixClient aus dem Ordner Programme starten</span></div>
</body></html>`;

/** HTML in ein unsichtbares Fenster rendern und als PNG holen (scale 2 = Retina, gleiche Punkte, doppelte Pixel) */
async function render(scale) {
  const width = WIDTH * scale;
  const height = HEIGHT * scale;
  const win = new BrowserWindow({ width, height, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: scale } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.webContents.setZoomFactor(scale);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((resolve) => setTimeout(resolve, 500));
  let image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
  const size = image.getSize();
  if (size.width !== width || size.height !== height) image = image.resize({ width, height, quality: 'best' });
  win.destroy();
  return image.toPNG();
}

app.disableHardwareAcceleration();
// nicht auf whenReady warten (top-level await): „ready“ kommt in Electron erst, wenn dieses Modul fertig geladen ist
app.whenReady().then(async () => {
  try {
    for (const [scale, name] of [[1, 'dmg-background.png'], [2, 'dmg-background@2x.png']]) {
      const png = await render(scale);
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      if (width !== WIDTH * scale || height !== HEIGHT * scale) throw new Error(`${name}: ${width}×${height} statt ${WIDTH * scale}×${HEIGHT * scale}`);
      await writeFile(path.join(buildDir, name), png);
      console.log(`build/${name}: ${width}×${height}`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
