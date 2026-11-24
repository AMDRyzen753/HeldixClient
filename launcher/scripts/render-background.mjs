// Erzeugt das Hintergrundbild des Launchers (src/renderer/background.svg):
// Nachthimmel mit Sternen, leuchtender Horizont und blockige Bergketten in Blautönen.
// Aufruf: node scripts/render-background.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const W = 1600;
const H = 1000;

// deterministischer Zufall, damit das Bild bei jedem Lauf gleich aussieht
let seed = 20261124;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Stufige Bergkette: Höhen werden auf ganze "Blöcke" gerundet. */
function ridge(baseY, amplitude, block, phase, roughness) {
  let d = `M0 ${H} L0 ${baseY}`;
  for (let x = 0; x <= W; x += block) {
    const t = x / W;
    const n =
      Math.sin(t * 6.2 + phase) * 0.55 +
      Math.sin(t * 13.7 + phase * 2.1) * 0.25 +
      Math.sin(t * 29.3 + phase * 0.7) * 0.12 * roughness +
      (rand() - 0.5) * 0.18 * roughness;
    const y = Math.round((baseY - n * amplitude) / block) * block;
    d += ` V${y} H${Math.min(W, x + block)}`;
  }
  return `${d} V${H} Z`;
}

const stars = Array.from({ length: 140 }, () => {
  const x = (rand() * W).toFixed(1);
  const y = (rand() * H * 0.55).toFixed(1);
  const r = (rand() * 1.4 + 0.3).toFixed(2);
  const o = (rand() * 0.6 + 0.25).toFixed(2);
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#e0f2fe" opacity="${o}"/>`;
}).join('');

/** Kleiner schwebender Würfel (isometrisch) */
function cube(cx, cy, s, opacity) {
  return `<g opacity="${opacity}">
    <path d="M${cx} ${cy - s} L${cx + s} ${cy - s / 2} L${cx} ${cy} L${cx - s} ${cy - s / 2} Z" fill="#bae6fd"/>
    <path d="M${cx - s} ${cy - s / 2} L${cx} ${cy} L${cx} ${cy + s} L${cx - s} ${cy + s / 2} Z" fill="#1d4ed8"/>
    <path d="M${cx + s} ${cy - s / 2} L${cx} ${cy} L${cx} ${cy + s} L${cx + s} ${cy + s / 2} Z" fill="#0ea5e9"/>
  </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#020817"/>
      <stop offset="0.38" stop-color="#071d44"/>
      <stop offset="0.62" stop-color="#0f4a9a"/>
      <stop offset="0.76" stop-color="#2a8fe0"/>
      <stop offset="0.86" stop-color="#55c8f2"/>
      <stop offset="1" stop-color="#0b2c5c"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.7" cy="0.7" r="0.36">
      <stop offset="0" stop-color="#f0fdff" stop-opacity="0.95"/>
      <stop offset="0.12" stop-color="#a5f3fc" stop-opacity="0.75"/>
      <stop offset="0.4" stop-color="#22d3ee" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowLeft" cx="0.12" cy="0.35" r="0.45">
      <stop offset="0" stop-color="#3b82f6" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="r1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a8fd6"/><stop offset="1" stop-color="#1a5aa3"/></linearGradient>
    <linearGradient id="r2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b5ca8"/><stop offset="1" stop-color="#103e7c"/></linearGradient>
    <linearGradient id="r3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d3672"/><stop offset="1" stop-color="#08254f"/></linearGradient>
    <linearGradient id="r4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#061a3a"/><stop offset="1" stop-color="#030c1f"/></linearGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7dd3fc" stop-opacity="0"/>
      <stop offset="1" stop-color="#7dd3fc" stop-opacity="0.22"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#glowLeft)"/>
  ${stars}
  <rect width="${W}" height="${H}" fill="url(#sun)"/>
  ${cube(1240, 300, 22, 0.55)}
  ${cube(1330, 250, 12, 0.4)}
  ${cube(360, 380, 14, 0.3)}
  <path d="${ridge(700, 120, 24, 1.3, 1)}" fill="url(#r1)" opacity="0.85"/>
  <rect y="560" width="${W}" height="200" fill="url(#haze)"/>
  <path d="${ridge(770, 140, 32, 2.6, 1.1)}" fill="url(#r2)"/>
  <rect y="660" width="${W}" height="160" fill="url(#haze)" opacity="0.7"/>
  <path d="${ridge(850, 120, 40, 4.4, 1.2)}" fill="url(#r3)"/>
  <path d="${ridge(940, 90, 48, 0.4, 1.3)}" fill="url(#r4)"/>
</svg>
`;

await writeFile(path.join(root, 'src', 'renderer', 'background.svg'), svg);
console.log('background.svg geschrieben');
