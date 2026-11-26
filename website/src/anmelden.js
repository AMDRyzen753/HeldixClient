// HeldixClient – Webseite: Anmeldung mit dem Minecraft-Konto auf der Konto- und der Team-Seite. Angemeldet wird bei
// Microsoft (dort liegt das Minecraft-Konto); der Heldix-Dienst macht den Rest auf dem Server und übernimmt nur Name
// und UUID. Den Knopf gibt es nur, wenn der Dienst die Anmeldung anbietet (GET /v1/web/config → microsoftLogin).
//
// Der Knopf führt zu /api/v1/web/auth/microsoft auf dieser Adresse: Dort setzt der Dienst ein kurzes Cookie, das die
// Anmeldung an diesen Browser bindet. Zurück kommt der Browser nach /konto mit #code=… (wie beim Link aus dem
// Launcher) oder mit #fehler=<code>; die Texte zu den Codes stehen hier (Liste in docs/dienst.md).
//
// Im HTML: ein Block mit [data-minecraft-knopf] (der Link) sowie beliebige Elemente mit [data-mit-minecraft] (nur
// sichtbar, wenn es die Anmeldung gibt) und [data-ohne-minecraft] (nur sichtbar, wenn nicht).
import { api } from './app-common.js';

const ERRORS = {
  abgebrochen: 'Du hast die Anmeldung bei Microsoft abgebrochen. Du kannst es jederzeit noch einmal versuchen.',
  abgelaufen: 'Die Anmeldung hat zu lange gedauert oder wurde schon benutzt. Bitte klicke noch einmal auf „Mit Minecraft-Konto anmelden“.',
  microsoft: 'Microsoft hat die Anmeldung nicht bestätigt. Bitte versuche es noch einmal.',
  'kein-xbox': 'Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil. Melde dich einmal auf xbox.com an und lege eins an – danach klappt es hier.',
  'xbox-land': 'Xbox Live ist in deinem Land nicht verfügbar. Mit diesem Minecraft-Konto klappt die Anmeldung deshalb leider nicht.',
  'xbox-alter': 'Microsoft verlangt für dieses Konto eine Altersbestätigung. Erledige sie auf xbox.com und versuche es dann noch einmal.',
  kinderkonto: 'Dieses Microsoft-Konto gehört zu einem Kind. Ein Erwachsener muss es erst zu seiner Microsoft-Familie hinzufügen (account.microsoft.com/family).',
  'xbox-eltern': 'Die Jugendschutz-Einstellungen deines Microsoft-Kontos erlauben kein Online-Spiel. Ein Erwachsener kann das unter account.microsoft.com/family ändern.',
  'xbox-bedingungen': 'Für dieses Konto sind die Nutzungsbedingungen von Xbox noch nicht bestätigt. Melde dich einmal auf xbox.com an und bestätige sie.',
  'xbox-gesperrt': 'Dieses Konto ist bei Xbox gesperrt. Daran können wir leider nichts ändern.',
  xbox: 'Die Anmeldung bei Xbox Live hat nicht geklappt. Bitte versuche es noch einmal.',
  'kein-minecraft': 'Mit diesem Microsoft-Konto ist kein Minecraft: Java Edition verknüpft. Melde dich mit dem Konto an, mit dem du Minecraft spielst.',
  minecraft: 'Die Minecraft-Dienste haben die Anmeldung abgelehnt. Bitte versuche es später noch einmal oder melde dich über den Launcher an.',
  gesperrt: 'Dieses Konto ist für den Heldix-Dienst gesperrt.',
  'zu-viele': 'Zu viele Anmeldeversuche. Bitte warte kurz und versuche es dann noch einmal.',
  'nicht-erreichbar': 'Microsoft oder die Minecraft-Dienste antworten gerade nicht. Bitte versuche es in ein paar Minuten noch einmal.',
};
const FALLBACK = 'Die Anmeldung mit deinem Minecraft-Konto hat nicht geklappt. Bitte versuche es noch einmal.';

/** Text zum Fehlercode aus #fehler=… (unbekannte Codes: allgemeiner Text, nie der Code selbst). */
export function loginErrorText(code) {
  return Object.hasOwn(ERRORS, code) ? ERRORS[code] : FALLBACK;
}

let available = null;

/** Bietet der Dienst die Anmeldung mit dem Minecraft-Konto an? Einmal pro Seite gefragt; jeder Fehler heißt nein. */
export function minecraftLoginAvailable() {
  available ??= api('GET', '/v1/web/config').then(
    (config) => config?.microsoftLogin === true,
    () => false,
  );
  return available;
}

/** Adresse zum Start, auf Wunsch mit Ziel nach der Anmeldung (der Dienst nimmt nur bekannte Ziele). */
export function minecraftLoginHref(target = null) {
  return `/api/v1/web/auth/microsoft${target ? `?ziel=${encodeURIComponent(target)}` : ''}`;
}

/**
 * Knopf und Texte unter `root` einrichten: Ziel in den Link, dann je nach Angebot des Dienstes [data-mit-minecraft]
 * oder [data-ohne-minecraft] zeigen. Liefert true, wenn es die Anmeldung gibt.
 */
export async function setupMinecraftLogin(root, target = null) {
  for (const link of root.querySelectorAll('[data-minecraft-knopf]')) link.href = minecraftLoginHref(target);
  const ok = await minecraftLoginAvailable();
  for (const el of root.querySelectorAll('[data-mit-minecraft]')) el.hidden = !ok;
  for (const el of root.querySelectorAll('[data-ohne-minecraft]')) el.hidden = ok;
  root.dataset.minecraftLogin = ok ? 'an' : 'aus';
  return ok;
}
