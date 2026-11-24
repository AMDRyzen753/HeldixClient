// Kopiert HTML/CSS der Oberfläche nach dist/renderer
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, 'src', 'renderer');
const to = path.join(root, 'dist', 'renderer');

await mkdir(to, { recursive: true });
for (const file of ['index.html', 'styles.css', 'instances.css', 'home.css', 'logo.svg', 'background.svg']) {
  await cp(path.join(from, file), path.join(to, file));
}

// Schrift Inter (wie im Spiel, SIL Open Font License) aus der Client-Mod
const fontFrom = path.join(root, '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'font');
await mkdir(path.join(to, 'fonts'), { recursive: true });
for (const file of ['inter-medium.ttf', 'inter-semibold.ttf', 'inter-bold.ttf']) {
  await cp(path.join(fontFrom, file), path.join(to, 'fonts', file));
}
await cp(path.join(root, '..', 'mod', 'src', 'main', 'resources', 'licenses', 'Inter-OFL.txt'), path.join(to, 'fonts', 'Inter-OFL.txt'));

// 3D-Figur auf der Startseite (skinview3d, MIT-Lizenz) – fertige Browser-Version ohne Bundler
await mkdir(path.join(to, 'vendor'), { recursive: true });
await cp(path.join(root, 'node_modules', 'skinview3d', 'bundles', 'skinview3d.bundle.js'), path.join(to, 'vendor', 'skinview3d.bundle.js'));
// Lizenztexte der eingebetteten Bibliotheken (MIT verlangt, dass sie mitgeliefert werden)
await cp(path.join(root, 'node_modules', 'skinview3d', 'LICENSE'), path.join(to, 'vendor', 'skinview3d.LICENSE.txt'));
await cp(path.join(root, 'node_modules', 'three', 'LICENSE'), path.join(to, 'vendor', 'three.LICENSE.txt'));
