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
  /** angemeldet über den offiziellen Minecraft Launcher (Brücke): kein Refresh-Token, neue Sitzungen kommen von dort */
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
    autoUpdate: true,
    lastSeenVersion: null,
    graphicsApi: 'vulkan',
    jvmTuning: true,
    developerMode: false,
  };
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

  constructor(root: string) {
    this.settingsFile = path.join(root, 'launcher-settings.json');
    this.accountsFile = path.join(root, 'launcher-accounts.json');
  }

  async getSettings(): Promise<Settings> {
    return { ...defaultSettings(), ...((await readJson<Partial<Settings>>(this.settingsFile)) ?? {}) };
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...patch };
    await writeJson(this.settingsFile, next);
    return next;
  }

  private async readAccounts(): Promise<AccountsFile> {
    return (await readJson<AccountsFile>(this.accountsFile)) ?? { activeId: null, accounts: [] };
  }

  private async writeAccounts(data: AccountsFile): Promise<void> {
    await writeJson(this.accountsFile, data);
  }

  async listAccounts(): Promise<AccountInfo[]> {
    const data = await this.readAccounts();
    return data.accounts.map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      uuid: a.uuid,
      skinUrl: a.skinUrl,
      via: a.source,
      active: a.id === data.activeId,
    }));
  }

  async getActiveAccount(): Promise<StoredAccount | null> {
    const data = await this.readAccounts();
    return data.accounts.find((a) => a.id === data.activeId) ?? data.accounts[0] ?? null;
  }

  /**
   * Fügt ein Microsoft-Konto hinzu oder aktualisiert es (gleiche UUID).
   * Sitzungen über den offiziellen Launcher haben kein Refresh-Token: Hat das Konto schon eins (eigene Anmeldung), bleibt es.
   */
  async upsertMicrosoft(session: MinecraftSession): Promise<StoredAccount> {
    const data = await this.readAccounts();
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
    data.activeId = account.id;
    await this.writeAccounts(data);
    return account;
  }

  async addOffline(name: string, uuid: string): Promise<StoredAccount> {
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
    if (data.activeId === id) data.activeId = data.accounts[0]?.id ?? null;
    await this.writeAccounts(data);
  }

  async select(id: string): Promise<void> {
    const data = await this.readAccounts();
    if (data.accounts.some((a) => a.id === id)) {
      data.activeId = id;
      await this.writeAccounts(data);
    }
  }

  secrets(account: StoredAccount): { accessToken: string; refreshToken: string } {
    return { accessToken: decrypt(account.accessToken), refreshToken: decrypt(account.refreshToken) };
  }
}
