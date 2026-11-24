// Rendert das HeldixClient-Logo als PNG. Aufruf: npm run icon
// Erzeugt build/icon.png (512 px, für Installer und .exe), build/discord-logo.png (1024 px, zum Hochladen
// als Discord-Bild "logo") und das 128-px-Icon der Mod.
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Gleiche Datei, die auch die Oberfläche nutzt
const svg = await readFile(path.join(launcherDir, 'src', 'renderer', 'logo.svg'), 'utf8');
const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
<div style="width:1024px;height:1024px">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const large = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
  const image = large.resize({ width: 512, height: 512, quality: 'best' });

  const buildDir = path.join(launcherDir, 'build');
  await mkdir(buildDir, { recursive: true });
  await writeFile(path.join(buildDir, 'icon.png'), image.toPNG());
  await writeFile(path.join(buildDir, 'discord-logo.png'), large.toPNG());

  const modIcon = path.join(launcherDir, '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'icon.png');
  await writeFile(modIcon, image.resize({ width: 128, height: 128, quality: 'best' }).toPNG());

  console.log('Icons geschrieben: build/icon.png, build/discord-logo.png und mod/.../icon.png');
  app.quit();
});
