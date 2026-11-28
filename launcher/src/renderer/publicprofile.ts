// Öffentliches Profil (Dienst 1.14.0, main/core/publicprofile.ts): Karte #profile-public unter der 3D-Figur in
// Skins & Cosmetics mit dem Schalter „Öffentliches Profil“ (#profile-public-toggle), „Profil im Browser ansehen“
// (https://<Webseite>/spieler/<name>) und dem Sprung zu den Einstellungen auf der Webseite (Bio, was sichtbar ist).
// Ohne Dienst, ohne Konto oder bei einem Dienst ohne öffentliche Profile bleibt die Karte weg.
import type { PublicProfileState } from '../shared/api';
import { api, errorMessage, h, toast, uiIcon } from './core.js';

let host: HTMLElement | null = null;
let current: PublicProfileState | null = null;
let busy = false;
let seq = 0;

/** Platz für die Karte (einmal beim Aufbau der Seite) */
export function publicProfileCard(): HTMLElement {
  host = h('div', { class: 'profile-public', id: 'profile-public', hidden: true });
  return host;
}

/** Stand neu holen (Seite gezeigt, Konto gewechselt) */
export async function refreshPublicProfile(): Promise<void> {
  const mine = ++seq;
  const next = await api.getPublicProfile().catch((error): PublicProfileState => ({ status: 'error', error: errorMessage(error), enabled: false, url: null, name: null }));
  if (mine !== seq) return;
  current = next;
  render();
}

function render(): void {
  if (!host) return;
  const state = current;
  if (!state || state.status === 'unsupported' || state.status === 'no-account') {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  const toggle = h('input', { type: 'checkbox', class: 'switch', id: 'profile-public-toggle', disabled: busy || state.status !== 'ok' });
  toggle.checked = state.enabled;
  toggle.addEventListener('change', () => void setEnabled(toggle.checked));
  const sub = state.status === 'offline-account' ? 'Ein öffentliches Profil gibt es nur mit einem Microsoft-Konto.'
    : state.status === 'error' ? (state.error ?? 'Der Heldix-Dienst ist gerade nicht erreichbar.')
      : state.enabled ? 'Alle können deine Profilseite mit Figur, Abzeichen und Welten sehen.'
        : 'Aus: Es gibt keine öffentliche Seite von dir.';
  const view = h('button', {
    class: 'ghost small',
    type: 'button',
    id: 'profile-public-open',
    disabled: !state.enabled || !state.url,
    title: state.url ?? '',
    onclick: () => void api.openPublicProfile().catch((error: unknown) => toast(errorMessage(error), 'error')),
  }, uiIcon('external', 'btn-icon'), h('span', { text: 'Profil im Browser ansehen' }));
  const settings = h('button', {
    class: 'link-button',
    type: 'button',
    id: 'profile-public-settings',
    disabled: state.status !== 'ok',
    onclick: () => void api.openWebAccount('oeffentlich').catch((error: unknown) => toast(errorMessage(error), 'error')),
  }, 'Bio und Sichtbarkeit auf der Webseite');
  host.replaceChildren(
    h('label', { class: 'toggle-row' }, h('span', {}, 'Öffentliches Profil', h('small', { class: 'toggle-sub', id: 'profile-public-sub', text: sub })), toggle),
    h('div', { class: 'button-row' }, view, settings));
}

async function setEnabled(enabled: boolean): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  try {
    current = await api.setPublicProfile(enabled);
    toast(current.enabled ? 'Dein Profil ist jetzt öffentlich.' : 'Dein Profil ist jetzt nicht mehr öffentlich.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    busy = false;
    render();
  }
}
