// Tastenkürzel so anzeigen, wie das System sie schreibt: Windows „Strg+1“, „Strg+Umschalt+Z“, „Alt+F4“; macOS „⌘1“,
// „⇧⌘Z“, „⌥⌘K“ (Reihenfolge der Zeichen wie bei Apple: ⌃ ⌥ ⇧ ⌘). Auf dem Mac ist ⌘ die Taste für Kürzel, ⌃ (Control)
// bleibt die echte Ctrl-Taste. Ohne Abhängigkeiten, damit scripts/test-background.ts es prüfen kann.

export interface ShortcutModifiers {
  /** Umschalt bzw. ⇧ */
  shift?: boolean;
  /** Alt bzw. ⌥ (Option) */
  alt?: boolean;
  /** echte Ctrl-Taste auch auf dem Mac (⌃), z. B. ⌃Tab */
  control?: boolean;
  /** ohne die Kürzel-Taste (Strg bzw. ⌘) – z. B. nur „Alt+F4“ */
  plain?: boolean;
}

export function isMac(platform: string): boolean {
  return platform === 'darwin';
}

/** Kürzel-Taste allein: „Strg“ bzw. „⌘“ */
export function modifierKey(platform: string): string {
  return isMac(platform) ? '⌘' : 'Strg';
}

/** Alt-Taste: „Alt“ bzw. „⌥“ */
export function altKey(platform: string): string {
  return isMac(platform) ? '⌥' : 'Alt';
}

/** z. B. shortcut('K', {}, 'win32') = „Strg+K“, shortcut('Z', { shift: true }, 'darwin') = „⇧⌘Z“ */
export function shortcut(key: string, modifiers: ShortcutModifiers = {}, platform: string): string {
  if (isMac(platform)) {
    return `${modifiers.control ? '⌃' : ''}${modifiers.alt ? '⌥' : ''}${modifiers.shift ? '⇧' : ''}${modifiers.plain || modifiers.control ? '' : '⌘'}${key}`;
  }
  const parts: string[] = [];
  if (!modifiers.plain || modifiers.control) parts.push('Strg');
  if (modifiers.alt) parts.push('Alt');
  if (modifiers.shift) parts.push('Umschalt');
  parts.push(key);
  return parts.join('+');
}

/** „Strg+Klick“ bzw. „⌘-Klick“ */
export function shortcutClick(platform: string): string {
  return isMac(platform) ? '⌘-Klick' : 'Strg+Klick';
}

/** Ist im Tastaturereignis die Kürzel-Taste gedrückt? (Mac ⌘, sonst Strg) */
export function shortcutPressed(event: { ctrlKey: boolean; metaKey: boolean }, platform: string): boolean {
  return isMac(platform) ? event.metaKey : event.ctrlKey;
}
