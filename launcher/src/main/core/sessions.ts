import type { MicrosoftTokens, MinecraftSession } from './auth';
import type { GameAccount } from './launch';

export const OFFLINE_LOCKED = 'Offline-Konten gibt es nur in der Entwicklungsversion von HeldixClient.';

/** Was die Sitzungen von einem gespeicherten Konto brauchen (StoredAccount in store.ts) */
export interface SessionAccount {
  id: string;
  type: 'microsoft' | 'offline';
  name: string;
  uuid: string;
  xuid?: string;
  expiresAt?: number;
}

export interface SessionDeps<A extends SessionAccount> {
  /** entschlüsselte Tokens des Kontos */
  secrets(account: A): { accessToken: string; refreshToken: string };
  /** erneuerte Sitzung speichern – ohne das aktive Konto zu ändern */
  save(session: MinecraftSession): Promise<unknown>;
  clientId: string;
  refreshMicrosoft(clientId: string, refreshToken: string): Promise<MicrosoftTokens>;
  loginMinecraft(tokens: MicrosoftTokens): Promise<MinecraftSession>;
  offlineAllowed(): boolean;
  log(text: string): void;
  now?(): number;
}

/** So lange vor Ablauf wird ein Minecraft-Token schon erneuert */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/**
 * Gültige Minecraft-Sitzungen für die Konten des Launchers (Spielstart, Freunde, Skins und der Konto-Wechsel im Spiel).
 * Läuft das Token bald ab, wird es über das Refresh-Token erneuert; gleichzeitige Anfragen für dasselbe Konto teilen
 * sich eine Erneuerung.
 */
export class SessionManager<A extends SessionAccount> {
  private readonly refreshes = new Map<string, Promise<GameAccount>>();

  constructor(private readonly deps: SessionDeps<A>) {}

  async sessionFor(account: A): Promise<GameAccount> {
    const { deps } = this;
    if (account.type === 'offline') {
      if (!deps.offlineAllowed()) throw new Error(OFFLINE_LOCKED);
      return { name: account.name, uuid: account.uuid, accessToken: '0', userType: 'legacy' };
    }
    const secrets = deps.secrets(account);
    const now = deps.now?.() ?? Date.now();
    if (secrets.accessToken && (account.expiresAt ?? 0) > now + REFRESH_MARGIN_MS) {
      return { name: account.name, uuid: account.uuid, accessToken: secrets.accessToken, xuid: account.xuid, userType: 'msa' };
    }
    if (!secrets.refreshToken) {
      // früher über den offiziellen Minecraft Launcher angemeldet (ohne Refresh-Token) – diesen Weg gibt es nicht mehr
      throw new Error(`Die Anmeldung von ${account.name} ist abgelaufen. Bitte unten links mit Microsoft neu anmelden.`);
    }
    if (!deps.clientId) throw new Error('Microsoft-Client-ID fehlt (siehe README).');
    let refresh = this.refreshes.get(account.id);
    if (!refresh) {
      refresh = (async (): Promise<GameAccount> => {
        deps.log('Erneuere Microsoft-Anmeldung …');
        const ms = await deps.refreshMicrosoft(deps.clientId, secrets.refreshToken);
        const session = await deps.loginMinecraft(ms);
        // das Konto bleibt dabei, wie es ist (nicht aktiv machen: im Hintergrund könnte inzwischen ein anderes gewählt sein)
        await deps.save(session);
        return { name: session.name, uuid: session.uuid, accessToken: session.accessToken, xuid: session.xuid, userType: 'msa' };
      })().finally(() => this.refreshes.delete(account.id));
      this.refreshes.set(account.id, refresh);
    }
    return refresh;
  }
}
