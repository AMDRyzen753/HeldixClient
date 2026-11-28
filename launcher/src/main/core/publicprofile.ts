// Öffentliches Spielerprofil (Heldix-Dienst 1.14.0): Schalter „Öffentliches Profil“ unter Skins & Cosmetics und
// „Profil im Browser ansehen“ (https://<Webseite>/spieler/<name>).
//
// - GET /v1/account/public-profile bzw. PUT mit allen Feldern { enabled, bio, showCosmetics, showWorlds, showBadges,
//   showFriendsButton } (angemeldet). Der Launcher ändert nur enabled und schickt die übrigen Felder so zurück, wie der
//   Dienst sie geliefert hat (Bio und Schalter bearbeitet man auf der Webseite).
// - Dienst ohne öffentliche Profile (404): Bereich aus.

import { ServiceError } from './heldixservice';

export interface PublicProfileSettings {
  enabled: boolean;
  bio: string;
  showCosmetics: boolean;
  showWorlds: boolean;
  showBadges: boolean;
  showFriendsButton: boolean;
}

/** Antwort von GET/PUT /v1/account/public-profile (fehlende Schalter: an, wie auf der Webseite vorgeschlagen) */
export function mapPublicProfile(raw: unknown): PublicProfileSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const bio = typeof r.bio === 'string' ? [...r.bio.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')].slice(0, 160).join('') : '';
  return {
    enabled: r.enabled === true,
    bio,
    showCosmetics: flag(r.showCosmetics, true),
    showWorlds: flag(r.showWorlds, true),
    showBadges: flag(r.showBadges, true),
    showFriendsButton: flag(r.showFriendsButton, true),
  };
}

/** Profilseite https://<Webseite>/spieler/<name> (nur https-Webseiten und gültige Minecraft-Namen), sonst null */
export function publicProfileUrl(website: string, name: unknown): string | null {
  const base = website.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(base) || typeof name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(name)) return null;
  return `${base}/spieler/${encodeURIComponent(name)}`;
}

/** Teil von core/social.ts, den das öffentliche Profil braucht */
export interface PublicProfileAuth {
  authed<T>(route: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, options?: { offlineMessage?: string; quiet?: boolean }): Promise<T>;
}

export const PUBLIC_PROFILE_OFFLINE = 'Ein öffentliches Profil gibt es nur mit einem Microsoft-Konto.';

export class PublicProfileClient {
  constructor(private readonly auth: PublicProfileAuth | null) {}

  private require(): PublicProfileAuth {
    if (!this.auth) throw new Error('Kein Heldix-Dienst eingerichtet.');
    return this.auth;
  }

  /** null = Dienst ohne öffentliche Profile (404) */
  async get(): Promise<PublicProfileSettings | null> {
    try {
      return mapPublicProfile(await this.require().authed<unknown>('/v1/account/public-profile', {}, { offlineMessage: PUBLIC_PROFILE_OFFLINE }));
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) return null;
      throw error;
    }
  }

  /** Öffentlich schalten bzw. verbergen; die übrigen Felder bleiben, wie sie sind */
  async setEnabled(enabled: boolean): Promise<PublicProfileSettings> {
    const current = await this.get();
    if (!current) throw new Error('Der Heldix-Dienst kennt noch keine öffentlichen Profile.');
    const body: PublicProfileSettings = { ...current, enabled };
    const raw = await this.require().authed<unknown>('/v1/account/public-profile', { method: 'PUT', body }, { offlineMessage: PUBLIC_PROFILE_OFFLINE });
    // manche Dienste antworten nur mit { ok: true }: dann gilt, was geschickt wurde
    return raw && typeof raw === 'object' && 'enabled' in raw ? mapPublicProfile(raw) : body;
  }
}
