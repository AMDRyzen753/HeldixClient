import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { AccountInfo, Settings } from '../shared/api';
import type { MinecraftSession } from './core/auth';
import { readJson, writeJson } from './core/fsutil';

export interface StoredAccount {
  id: string;
  type: 'microsoft' | 'offline';
  name: string;
  uuid: string;
  xuid?: string;
  skinUrl?: string;
  /** verschlüsselt (Windows: DPAPI, macOS: Schlüsselbund) */
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  /** früher über den offiziellen Minecraft Launcher angemeldet (Brücke, bis 0.13): kein Refresh-Token – nach Ablauf neu anmelden */
  source?: 'launcher';
}

interface AccountsFile {
  activeId: string | null;
  accounts: StoredAccount[];
}

function defaultSettings(): Settings {
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  const memoryMb = Math.max(2048, Math.min(4096, Math.floor(totalMb / 4 / 512) * 512));
  return {
    selectedInstanceId: null,
    memoryMb,
    hideLauncherOnLaunch: false,
    resolution: null,
    jvmArgs: '',
    javaPath: '',
    discordPresence: true,
    discordShowServer: true,
    discordInviteButtons: true,
    discordShowDetails: true,
    discordShowWorldName: false,
    discordShowParty: true,
    discordShowVoice: true,
    discordShowHead: true,
    discordMinimal: false,
    closeToTray: true,
    autoUpdate: true,
    lastSeenVersion: null,
    graphicsApi: 'vulkan',
    jvmTuning: true,
    social: true,
    socialNotifications: true,
    partyAutoFollow: false,
    addonUpdateNotifications: true,
    addonAutoUpdate: false,
    gameAccountSwitch: true,
    // fehlt in älteren Dateien: entscheidet beim Start setupStart (core/setup.ts), bevor etwas anderes es liest
    setupDone: false,
  };
}

/** Ältere Einstellungsdateien: fehlende oder ungültige Schalter bekommen den Standard. */
function migrateSettings(stored: Partial<Settings>): Partial<Settings> {
  const next = { ...stored };
  for (const key of ['social', 'socialNotifications', 'partyAutoFollow', 'addonUpdateNotifications', 'addonAutoUpdate', 'gameAccountSwitch', 'discordInviteButtons', 'setupDone',
    'discordShowDetails', 'discordShowWorldName', 'discordShowParty', 'discordShowVoice', 'discordShowHead', 'discordMinimal', 'closeToTray'] as const) {
    if (key in next && typeof next[key] !== 'boolean') delete next[key];
  }
  return next;
}

function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(value).toString('base64')}`;
  return `raw:${value}`;
}

function decrypt(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
  return value.replace(/^raw:/, '');
}

export class Store {
  private readonly settingsFile: string;
  private readonly accountsFile: string;
  /** Offline-Konten zeigen und nutzen (nur beim Entwickeln; die fertige App blendet alte aus) */
  private readonly offline: boolean;

  constructor(root: string, options: { offline?: boolean } = {}) {
    this.settingsFile = path.join(root, 'launcher-settings.json');
    this.accountsFile = path.join(root, 'launcher-accounts.json');
    this.offline = options.offline ?? true;
  }

  /** Konten, die diese App nutzen darf */
  private usable(accounts: StoredAccount[]): StoredAccount[] {
    return this.offline ? accounts : accounts.filter((a) => a.type !== 'offline');
  }

  /** aktives Konto unter den nutzbaren (sonst das erste) */
  private activeOf(data: AccountsFile): StoredAccount | null {
    const usable = this.usable(data.accounts);
    return usable.find((a) => a.id === data.activeId) ?? usable[0] ?? null;
  }

  async getSettings(): Promise<Settings> {
    return { ...defaultSettings(), ...migrateSettings((await readJson<Partial<Settings>>(this.settingsFile)) ?? {}) };
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...patch };
    await writeJson(this.settingsFile, next);
    return next;
  }

  /**
   * Für den Einrichtungs-Assistenten (core/setup.ts, vor ensureInstances): die gespeicherten Einstellungen ohne
   * Standardwerte (null = keine Datei) und die Zahl der gespeicherten Konten (auch alte Offline-Konten).
   */
  async setupProbe(): Promise<{ stored: Record<string, unknown> | null; accounts: number }> {
    const stored = await readJson<unknown>(this.settingsFile);
    const accounts = (await this.readAccounts()).accounts;
    return {
      stored: stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : stored === null ? null : {},
      accounts: Array.isArray(accounts) ? accounts.length : 0,
    };
  }

  private async readAccounts(): Promise<AccountsFile> {
    return (await readJson<AccountsFile>(this.accountsFile)) ?? { activeId: null, accounts: [] };
  }

  private async writeAccounts(data: AccountsFile): Promise<void> {
    await writeJson(this.accountsFile, data);
  }

  async listAccounts(): Promise<AccountInfo[]> {
    const data = await this.readAccounts();
    const activeId = this.activeOf(data)?.id ?? null;
    return this.usable(data.accounts).map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      uuid: a.uuid,
      skinUrl: a.skinUrl,
      via: a.source,
      active: a.id === activeId,
    }));
  }

  async getActiveAccount(): Promise<StoredAccount | null> {
    return this.activeOf(await this.readAccounts());
  }

  /** Ein nutzbares Konto (fertige App: kein Offline-Konto) */
  async getAccount(id: string): Promise<StoredAccount | null> {
    return this.usable((await this.readAccounts()).accounts).find((a) => a.id === id) ?? null;
  }

  /**
   * Fügt ein Microsoft-Konto hinzu oder aktualisiert es (gleiche UUID).
   * Sitzungen über den offiziellen Launcher haben kein Refresh-Token: Hat das Konto schon eins (eigene Anmeldung), bleibt es.
   * activate = false: Ein neues Konto wird nur aktiv, wenn es noch kein nutzbares gibt (Anmeldung aus dem Spiel).
   */
  async upsertMicrosoft(session: MinecraftSession, activate = true): Promise<StoredAccount> {
    const data = await this.readAccounts();
    const hadActive = this.activeOf(data) !== null;
    const existing = data.accounts.find((a) => a.type === 'microsoft' && a.uuid === session.uuid);
    const keepRefresh = !session.refreshToken && existing?.refreshToken && decrypt(existing.refreshToken);
    const account: StoredAccount = {
      id: existing?.id ?? randomUUID(),
      type: 'microsoft',
      name: session.name,
      uuid: session.uuid,
      xuid: session.xuid,
      skinUrl: session.skinUrl,
      accessToken: encrypt(session.accessToken),
      refreshToken: keepRefresh ? existing!.refreshToken : session.refreshToken ? encrypt(session.refreshToken) : undefined,
      expiresAt: session.expiresAt,
      source: session.refreshToken || keepRefresh ? undefined : 'launcher',
    };
    data.accounts = existing ? data.accounts.map((a) => (a.id === existing.id ? account : a)) : [...data.accounts, account];
    if (activate || (!existing && !hadActive)) data.activeId = account.id;
    await this.writeAccounts(data);
    return account;
  }

  async addOffline(name: string, uuid: string): Promise<StoredAccount> {
    if (!this.offline) throw new Error('Offline-Konten gibt es nur in der Entwicklungsversion von HeldixClient.');
    const data = await this.readAccounts();
    const existing = data.accounts.find((a) => a.type === 'offline' && a.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      data.activeId = existing.id;
      await this.writeAccounts(data);
      return existing;
    }
    const account: StoredAccount = { id: randomUUID(), type: 'offline', name, uuid };
    data.accounts.push(account);
    data.activeId = account.id;
    await this.writeAccounts(data);
    return account;
  }

  async remove(id: string): Promise<void> {
    const data = await this.readAccounts();
    data.accounts = data.accounts.filter((a) => a.id !== id);
    if (data.activeId === id) data.activeId = this.usable(data.accounts)[0]?.id ?? null;
    await this.writeAccounts(data);
  }

  async select(id: string): Promise<void> {
    const data = await this.readAccounts();
    if (this.usable(data.accounts).some((a) => a.id === id)) {
      data.activeId = id;
      await this.writeAccounts(data);
    }
  }

  /** Neuer aktiver Skin bei Mojang (Skins & Capes): Adresse für die Figur auf der Startseite */
  async setSkinUrl(id: string, skinUrl: string | null): Promise<void> {
    const data = await this.readAccounts();
    const account = data.accounts.find((a) => a.id === id);
    if (!account) return;
    if (skinUrl) account.skinUrl = skinUrl;
    else delete account.skinUrl;
    await this.writeAccounts(data);
  }

  secrets(account: StoredAccount): { accessToken: string; refreshToken: string } {
    return { accessToken: decrypt(account.accessToken), refreshToken: decrypt(account.refreshToken) };
  }
}
