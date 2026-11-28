// Preload des Startfensters (splash-window.ts): zeigt den Stand (splash:view) und meldet „Später“ (splash:skip).
// Keine Schnittstelle für die Seite selbst – sie hat kein eigenes Skript.
import { ipcRenderer } from 'electron';

interface SplashView {
  title: string;
  /** 0–1 = Balken mit Fortschritt, null = laufender Balken */
  progress: number | null;
  /** Knopf „Später“ zeigen */
  skip: boolean;
}

let latest: SplashView | null = null;

function apply(): void {
  const view = latest;
  const status = document.getElementById('splash-status');
  const bar = document.getElementById('splash-bar');
  const fill = document.getElementById('splash-bar-fill');
  const skip = document.getElementById('splash-skip');
  if (!view || !status || !bar || !fill || !skip) return;
  status.textContent = view.title;
  const determinate = typeof view.progress === 'number';
  bar.classList.toggle('determinate', determinate);
  fill.style.width = determinate ? `${Math.round(Math.max(0, Math.min(1, view.progress!)) * 100)}%` : '';
  skip.hidden = !view.skip;
}

ipcRenderer.on('splash:view', (_event, view: SplashView) => {
  latest = view;
  if (document.readyState === 'loading') return;
  apply();
});

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('splash-skip')?.addEventListener('click', () => ipcRenderer.send('splash:skip'));
  apply();
});
