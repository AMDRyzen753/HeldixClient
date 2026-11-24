// Kopiert HTML/CSS der Oberfläche nach dist/renderer
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, 'src', 'renderer');
const to = path.join(root, 'dist', 'renderer');

await mkdir(to, { recursive: true });
for (const file of ['index.html', 'styles.css', 'instances.css', 'logo.svg', 'background.svg']) {
  await cp(path.join(from, file), path.join(to, file));
}
