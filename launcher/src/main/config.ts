// Zentrale Einstellungen des Launchers. Zum Umbenennen des Clients reicht es meist, hier zu ändern.

export const CLIENT_NAME = 'HeldixClient';
export const LAUNCHER_NAME = 'HeldixClient';
export const LAUNCHER_VERSION = '0.13.9';

/** Ordnername für alle Spieldaten (Windows: %APPDATA%\.heldixclient) */
export const DATA_DIR_NAME = '.heldixclient';

/** Dateiname-Präfix der gebauten Client-Mod, z. B. heldixclient-0.1.0+26.3.jar */
export const CLIENT_MOD_PREFIX = 'heldixclient';

/**
 * Anwendungs-ID (Client-ID) deiner Azure-App-Registrierung für den Microsoft-Login.
 * Anleitung steht in der README. Alternativ per Umgebungsvariable HELDIX_MS_CLIENT_ID setzen.
 */
export const MICROSOFT_CLIENT_ID: string = process.env.HELDIX_MS_CLIENT_ID ?? '34c0c3ff-1c47-4a02-a816-18e701ddbbe8';

/** Redirect-URI, die in der Azure-App unter "Mobile und Desktopanwendungen" eingetragen sein muss. */
export const MICROSOFT_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';

/**
 * Application-ID deiner Discord-App für den Discord-Status (Rich Presence).
 * Anleitung steht in der README. Alternativ per Umgebungsvariable HELDIX_DISCORD_CLIENT_ID setzen.
 * Der Name der Discord-App erscheint in Discord als "Spielt <Name>".
 */
export const DISCORD_CLIENT_ID: string = process.env.HELDIX_DISCORD_CLIENT_ID ?? '1574791711266177084';

/**
 * Adresse des Heldix-Dienstes (Capes für alle, Heldix-Symbol in der Tab-Liste, Freunde), z. B. https://dienst.example.de.
 * Leer = diese Funktionen sind aus. Siehe docs/dienst.md. Alternativ per Umgebungsvariable HELDIX_SERVICE_URL setzen.
 */
export const HELDIX_SERVICE_URL: string = process.env.HELDIX_SERVICE_URL ?? 'https://api.heldixclient.com';

/** Webseite (Neuigkeiten, Versionsverlauf, Teamseite, Status) */
export const WEBSITE_URL: string = process.env.HELDIX_WEBSITE_URL ?? 'https://heldixclient.com';
