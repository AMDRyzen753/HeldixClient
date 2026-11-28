// Dauerhafte Welten (1.13.0): erlaubte Pfade innerhalb einer Welt. Plugin-Konfiguration nur als Textdatei unter
// `plugins/` (relativ zum Datenordner der Welt), ohne „..“, ohne absolute Pfade; Plugin-Jars nur mit einfachem Namen.

/** Textdateien unter plugins/, die Besitzer ansehen und bearbeiten dürfen. */
export const PLUGIN_TEXT_RE = /^plugins\/(?:[A-Za-z0-9 ._+-]+\/){0,8}[A-Za-z0-9 ._+-]+\.(?:yml|yaml|json|properties|txt|toml)$/;
export const PLUGIN_TEXT_MAX_BYTES = 256 * 1024;

/** Ist das ein erlaubter Pfad einer Plugin-Konfiguration (`plugins/…`)? */
export function isPluginTextPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 300 &&
    PLUGIN_TEXT_RE.test(value) &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part.trim() === part)
  );
}
