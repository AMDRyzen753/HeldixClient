// Fehler des Welten-Wächters: eine deutsche Meldung (verständlich für Spieler und Team) und ein grober Code, an dem der
// Dienst entscheiden kann, was er anzeigt (z. B. „full“ → „Gerade sind alle Plätze belegt …“).

export type AgentErrorCode =
  /** Anfrage passt nicht (Welt-ID, Name, Pfad, Wert, unbekanntes Feld) */
  | 'invalid'
  | 'not-found'
  /** geht nur bei gestoppter Welt */
  | 'running'
  /** geht nur bei laufender Welt */
  | 'not-running'
  /** alle Plätze belegt (HELDIX_WELTEN_MAX) */
  | 'full'
  | 'exists'
  | 'too-large'
  /** der Betreiber hat der Minecraft-EULA nicht zugestimmt */
  | 'eula'
  | 'download'
  | 'docker'
  | 'busy'
  /** nur im Dienst (AgentRunner): Wächter nicht erreichbar bzw. Verbindung weg */
  | 'unavailable'
  | 'timeout'
  | 'internal';

export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: AgentErrorCode = 'invalid',
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === code;
}

/** Macht aus beliebigen Fehlern eine AgentError (Dateisystem-Fehler mit verständlichem Text, Rest „intern“). */
export function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  const code = typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
  switch (code) {
    case 'ENOENT':
      return new AgentError('Datei oder Ordner gibt es nicht.', 'not-found');
    case 'ENOSPC':
    case 'EDQUOT':
      return new AgentError('Auf dem Server ist kein Speicherplatz mehr frei.', 'too-large');
    case 'ELOOP':
      return new AgentError('Symbolische Links sind nicht erlaubt.', 'invalid');
    case 'EEXIST':
      return new AgentError('Die Datei gibt es schon.', 'exists');
    case 'ENOTDIR':
    case 'EISDIR':
      return new AgentError('Pfad passt nicht (Datei statt Ordner oder umgekehrt).', 'invalid');
    default:
      return new AgentError('Interner Fehler im Welten-Wächter.', 'internal');
  }
}
