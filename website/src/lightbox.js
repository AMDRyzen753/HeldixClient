// HeldixClient – Webseite: Bilder groß ansehen (Screenshots im Addon-Store, in „Meine Addons“ und im Team-Bereich).
// Ein eigener <dialog>, damit die Ansicht auch über einem schon offenen Dialog liegt (beide im Top-Layer).
// Pfeiltasten blättern, Escape oder Klick daneben schließt nur die Lightbox; danach bekommt der Auslöser den Fokus.
import { h, icon } from './app-common.js';

/** images: [{ src, alt }]. Gibt den Dialog zurück. */
export function openLightbox(images, start = 0, { label = 'Screenshots' } = {}) {
  if (!images.length) return null;
  const opener = document.activeElement;
  let index = 0;
  const image = h('img', { class: 'lightbox-image', alt: '' });
  const caption = h('p', { class: 'lightbox-caption' });
  const prev = h('button', { type: 'button', class: 'icon-button lightbox-prev', 'aria-label': 'Vorheriges Bild' }, icon('chevron-left'));
  const next = h('button', { type: 'button', class: 'icon-button lightbox-next', 'aria-label': 'Nächstes Bild' }, icon('chevron-right'));
  const close = h('button', { type: 'button', class: 'icon-button lightbox-close', 'aria-label': 'Schließen' }, icon('close'));
  const dialog = h('dialog', { class: 'lightbox-dialog', 'aria-label': label }, h('figure', { class: 'lightbox-figure' }, image, caption), prev, next, close);
  const show = (target) => {
    index = (target + images.length) % images.length;
    image.src = images[index].src;
    image.alt = images[index].alt || '';
    caption.textContent = images.length > 1 ? `${images[index].alt || 'Bild'} · ${index + 1} von ${images.length}` : images[index].alt || '';
    dialog.dataset.index = String(index);
  };
  prev.hidden = images.length < 2;
  next.hidden = images.length < 2;
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (images.length < 2) return;
    if (event.key === 'ArrowLeft') show(index - 1);
    else if (event.key === 'ArrowRight') show(index + 1);
    else return;
    event.preventDefault();
  });
  // Klick auf den dunklen Rand (nicht auf Bild oder Knöpfe) schließt
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.classList.contains('lightbox-figure')) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  });
  document.body.append(dialog);
  show(start);
  dialog.showModal();
  close.focus();
  return dialog;
}
