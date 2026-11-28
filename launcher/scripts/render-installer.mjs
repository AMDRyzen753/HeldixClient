// Erzeugt die Bilder des Windows-Installers (electron-builder NSIS, assisted) im Heldix-Design:
//   build/installerSidebar.bmp    164 × 314 – linke Seite von „Willkommen“ und „Fertig“
//   build/uninstallerSidebar.bmp  164 × 314 – dasselbe für den Deinstaller
//   build/installerHeader.bmp     150 ×  57 – rechts im Kopf der übrigen Seiten (weißer Grund wie der Kopf)
// NSIS will 24-Bit-BMP ohne Alpha (BITMAPINFOHEADER, Zeilen von unten nach oben, auf 4 Bytes aufgefüllt).
// Gezeichnet wird wie bei den anderen Grafiken als HTML in einem unsichtbaren Fenster (Logo, Motiv und Schrift Inter
// aus der Oberfläche bzw. der Client-Mod), das Bild kommt als PNG zurück und wird hier ohne weitere Bibliothek in
// RGB-Pixel und dann in BMP umgerechnet. Mit --preview=<Ordner> zusätzlich PNG-Vorschauen (auch doppelt groß und
// nachgebaute Seiten des Installers) zum Ansehen.
// Aufruf: npm run installer-art [-- --preview=<Ordner>]
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildDir = path.join(launcherDir, 'build');
const rendererDir = path.join(launcherDir, 'src', 'renderer');
const fontDir = path.join(launcherDir, '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'font');
const previewArg = process.argv.find((a) => a.startsWith('--preview='));
const previewDir = previewArg ? path.resolve(previewArg.slice('--preview='.length)) : null;

// eigenes Profil im Temp-Ordner: das Skript soll nichts unter %APPDATA% anlegen
app.setPath('userData', path.join(os.tmpdir(), 'heldix-installer-art'));

const logo = await readFile(path.join(rendererDir, 'logo.svg'), 'utf8');
const art = `data:image/svg+xml;base64,${(await readFile(path.join(rendererDir, 'background.svg'))).toString('base64')}`;
const inter = async (file) => `url(data:font/ttf;base64,${(await readFile(path.join(fontDir, file))).toString('base64')})`;
const fonts = `@font-face{font-family:Inter;src:${await inter('inter-bold.ttf')};font-weight:700 900}
@font-face{font-family:Inter;src:${await inter('inter-semibold.ttf')};font-weight:600}
@font-face{font-family:Inter;src:${await inter('inter-medium.ttf')};font-weight:100 500}`;
const svgLogo = (size) => logo.replace('<svg ', `<svg width="${size}" height="${size}" `);

function page(width, height, body, css = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;font-family:Inter,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
${css}</style></head><body>${body}</body></html>`;
}

/** Seitenleiste: Motiv des Launchers, Logo, Schriftzug, eine Zeile darunter */
function sidebar(tagline, sub) {
  return page(164, 314, `
<div class="bg"></div><div class="art"></div><div class="shade"></div><div class="glow"></div>
<div class="content">
  <div class="logo">${svgLogo(66)}</div>
  <div class="word"><b>HELDIX</b><span>CLIENT</span></div>
  <div class="line"></div>
  <div class="tag">${tagline}</div>
  <div class="sub">${sub}</div>
</div>`, `
.bg{position:absolute;inset:0;background:linear-gradient(180deg,#060912 0%,#0a1224 46%,#0b1d3f 100%)}
.art{position:absolute;left:-150px;right:-90px;bottom:-8px;height:236px;background:url(${art}) 70% 80%/cover no-repeat;opacity:1;
  -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 55%)}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,9,18,.15) 0%,rgba(6,9,18,0) 45%,rgba(6,9,18,.3) 100%)}
.glow{position:absolute;left:50%;top:78px;width:190px;height:190px;transform:translate(-50%,-50%);
  background:radial-gradient(circle,rgba(56,189,248,.34) 0%,rgba(37,99,235,.16) 38%,rgba(37,99,235,0) 70%)}
.content{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:44px;color:#fff;text-align:center}
.logo{width:66px;height:66px;filter:drop-shadow(0 8px 18px rgba(8,20,50,.7))}
.word{display:flex;align-items:baseline;gap:6px;margin-top:16px;white-space:nowrap}
.word b{font-size:19px;font-weight:700;letter-spacing:.6px}
.word span{font-size:14px;font-weight:600;letter-spacing:3px;color:#93c5fd}
.line{width:30px;height:2px;margin:12px 0 10px;border-radius:2px;background:linear-gradient(90deg,#3b82f6,#22d3ee)}
.tag{font-size:11px;font-weight:600;color:#dbe7ff;letter-spacing:.2px}
.sub{margin-top:3px;font-size:9.5px;font-weight:500;color:#9fb3d6}`);
}

/** Kopf: weißer Grund wie der Kopf des Installers, rechts das Logo */
const header = page(150, 57, `
<div class="row"><div class="word"><b>HELDIX</b><span>CLIENT</span></div><div class="mark"><div class="halo"></div>${svgLogo(38)}</div></div>`, `
body{background:#fff}
.row{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-right:9px}
.word{display:flex;flex-direction:column;align-items:flex-end;line-height:1}
.word b{font-size:15px;font-weight:700;letter-spacing:.5px;color:#0b1220}
.word span{margin-top:3px;font-size:9.5px;font-weight:600;letter-spacing:2.6px;color:#2563eb}
.mark{position:relative;width:38px;height:38px}
.mark svg{position:relative}
.halo{position:absolute;inset:-9px;border-radius:50%;background:radial-gradient(circle,rgba(59,130,246,.18),rgba(59,130,246,0) 68%)}`);

/** Rendert HTML in ein unsichtbares Fenster und gibt das Bild als PNG zurück (genau in der gewünschten Größe). */
async function render(html, width, height) {
  const win = new BrowserWindow({ width, height, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((resolve) => setTimeout(resolve, 400));
  let image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
  const size = image.getSize();
  if (size.width !== width || size.height !== height) image = image.resize({ width, height, quality: 'best' });
  win.destroy();
  return image.toPNG();
}

// ---------- PNG lesen (8 Bit, RGBA oder RGB, ohne Interlace – so schreibt Electron) ----------

function decodePng(png) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('Kein PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const depth = chunk[8];
      const color = chunk[9];
      if (depth !== 8 || (color !== 6 && color !== 2) || chunk[12] !== 0) throw new Error(`PNG-Format nicht unterstützt (Tiefe ${depth}, Farbtyp ${color})`);
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 3);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      // auf Weiß bzw. Dunkel ist alles deckend; Reste von Transparenz auf Schwarz legen
      const alpha = channels === 4 ? line[x * 4 + 3] / 255 : 1;
      for (let k = 0; k < 3; k++) out[(y * width + x) * 3 + k] = Math.round(line[x * channels + k] * alpha);
    }
    previous = line;
  }
  return { width, height, rgb: out };
}

// ---------- BMP schreiben (24 Bit) ----------

function encodeBmp({ width, height, rgb }) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const file = Buffer.alloc(14 + 40 + pixelBytes);
  file.write('BM', 0, 'latin1');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(14 + 40, 10);
  file.writeUInt32LE(40, 14); // BITMAPINFOHEADER
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22); // positiv = Zeilen von unten nach oben
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(0, 30); // BI_RGB
  file.writeUInt32LE(pixelBytes, 34);
  file.writeInt32LE(2835, 38); // 72 dpi
  file.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      file[row + x * 3] = rgb[i + 2];
      file[row + x * 3 + 1] = rgb[i + 1];
      file[row + x * 3 + 2] = rgb[i];
    }
  }
  return file;
}

/** Gegenprobe: Kopf der BMP und einige Pixel stimmen mit dem Bild überein */
function verifyBmp(bmp, image) {
  const ok = bmp.toString('latin1', 0, 2) === 'BM' && bmp.readUInt32LE(2) === bmp.length && bmp.readInt32LE(18) === image.width
    && bmp.readInt32LE(22) === image.height && bmp.readUInt16LE(28) === 24 && bmp.readUInt32LE(30) === 0;
  if (!ok) throw new Error('BMP-Kopf stimmt nicht');
  const rowSize = Math.ceil((image.width * 3) / 4) * 4;
  for (const [x, y] of [[0, 0], [image.width - 1, 0], [Math.floor(image.width / 2), Math.floor(image.height / 2)], [0, image.height - 1]]) {
    const at = 54 + (image.height - 1 - y) * rowSize + x * 3;
    const i = (y * image.width + x) * 3;
    if (bmp[at] !== image.rgb[i + 2] || bmp[at + 1] !== image.rgb[i + 1] || bmp[at + 2] !== image.rgb[i]) throw new Error(`BMP-Pixel ${x},${y} stimmt nicht`);
  }
}

// ---------- Nachgebaute Seiten (nur Vorschau, Größe wie MUI2 bei 100 %) ----------

const pngUrl = (png) => `data:image/png;base64,${png.toString('base64')}`;
function welcomeMock(sidebarPng, title, text, finish) {
  return page(497, 360, `
<div class="win"><img class="side" src="${pngUrl(sidebarPng)}"><div class="text"><h1>${title}</h1><p>${text}</p>
${finish ? '<label class="run"><span class="box">✓</span>HeldixClient starten</label>' : ''}</div></div>
<div class="foot"><span class="btn">&lt; Zurück</span><span class="btn main">${finish ? 'Fertigstellen' : 'Weiter &gt;'}</span><span class="btn">Abbrechen</span></div>`, `
body{background:#f0f0f0;font-family:'Segoe UI',sans-serif}
.win{position:absolute;left:0;top:0;width:497px;height:314px;display:flex;background:#fff}
.side{width:164px;height:314px;display:block}
.text{padding:14px 16px;font-size:12px;color:#000}
h1{margin:0 0 14px;font:600 15.5px 'Segoe UI',sans-serif;white-space:pre-line}
p{margin:0;white-space:pre-line;line-height:1.35}
.run{display:flex;align-items:center;gap:6px;margin-top:18px}
.box{display:grid;place-items:center;width:13px;height:13px;border:1px solid #333;font-size:10px}
.foot{position:absolute;left:0;right:0;top:314px;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 10px;border-top:1px solid #ddd}
.btn{display:grid;place-items:center;width:75px;height:23px;border:1px solid #adadad;background:#e1e1e1;font-size:12px}
.btn.main{border-color:#0078d7}`);
}

function headerMock(headerPng) {
  return page(497, 120, `
<div class="head"><div><b>Zielverzeichnis auswählen</b><span>Wählen Sie das Verzeichnis aus, in das HeldixClient installiert werden soll.</span></div><img src="${pngUrl(headerPng)}"></div>
<div class="body">Setup wird HeldixClient in das folgende Verzeichnis installieren …</div>`, `
body{background:#f0f0f0;font-family:'Segoe UI',sans-serif;font-size:12px}
.head{position:absolute;left:0;top:0;right:0;height:57px;display:flex;align-items:center;justify-content:space-between;padding-left:14px;background:#fff;border-bottom:1px solid #a0a0a0}
.head div{display:flex;flex-direction:column;gap:3px}.head b{font-weight:600}.head span{padding-left:8px}
.head img{width:150px;height:57px;display:block}
.body{position:absolute;left:24px;top:76px}`);
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  await mkdir(buildDir, { recursive: true });
  const images = {
    installerSidebar: await render(sidebar('Dein Minecraft-Launcher', 'mit eigenem Client und Addons'), 164, 314),
    uninstallerSidebar: await render(sidebar('Bis bald!', 'Deine Welten bleiben erhalten'), 164, 314),
    installerHeader: await render(header, 150, 57),
  };
  for (const [name, png] of Object.entries(images)) {
    const image = decodePng(png);
    const bmp = encodeBmp(image);
    verifyBmp(bmp, image);
    await writeFile(path.join(buildDir, `${name}.bmp`), bmp);
    console.log(`build/${name}.bmp (${image.width} × ${image.height}, ${bmp.length} Bytes)`);
  }
  if (previewDir) {
    await mkdir(previewDir, { recursive: true });
    for (const [name, png] of Object.entries(images)) {
      await writeFile(path.join(previewDir, `${name}.png`), png);
      const { width, height } = decodePng(png);
      const big = await render(page(width * 2, height * 2, `<img src="${pngUrl(png)}" style="width:${width * 2}px;height:${height * 2}px;image-rendering:pixelated;display:block">`), width * 2, height * 2);
      await writeFile(path.join(previewDir, `${name}@2x.png`), big);
    }
    await writeFile(path.join(previewDir, 'vorschau-willkommen.png'), await render(welcomeMock(images.installerSidebar, 'Willkommen bei HeldixClient',
      'Dieser Assistent installiert HeldixClient – den Minecraft-Launcher mit eigenem Client, Addons und Freunden.\n\nDeine Welten, Instanzen und Einstellungen liegen in einem eigenen Ordner und bleiben bei Updates erhalten.\n\nKlicke auf „Weiter“, um fortzufahren.', false), 497, 360));
    await writeFile(path.join(previewDir, 'vorschau-fertig.png'), await render(welcomeMock(images.installerSidebar, 'HeldixClient ist bereit',
      'HeldixClient wurde installiert. Beim ersten Start führt dich ein kurzer Assistent durch Konto und Addons.\n\nKlicke auf „Fertigstellen“, um den Installer zu schließen.', true), 497, 360));
    await writeFile(path.join(previewDir, 'vorschau-kopf.png'), await render(headerMock(images.installerHeader), 497, 120));
    console.log(`Vorschauen in ${previewDir}`);
  }
  app.quit();
});
