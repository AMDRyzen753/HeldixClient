import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { HeldixApi } from '../shared/api';

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: HeldixApi = {
  appInfo: () => ipcRenderer.invoke('app:info'),
  listVersions: () => ipcRenderer.invoke('versions:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),

  listInstances: () => ipcRenderer.invoke('instances:list'),
  createInstance: (data) => ipcRenderer.invoke('instances:create', data),
  updateInstance: (id, patch) => ipcRenderer.invoke('instances:update', id, patch),
  deleteInstance: (id) => ipcRenderer.invoke('instances:delete', id),
  selectInstance: (id) => ipcRenderer.invoke('instances:select', id),

  listContent: (id, kind) => ipcRenderer.invoke('content:list', id, kind),
  listBundledAddons: (id) => ipcRenderer.invoke('addons:bundled', id),
  installBundledAddon: (id, file) => ipcRenderer.invoke('addons:installBundled', id, file),
  setContentEnabled: (id, kind, file, enabled) => ipcRenderer.invoke('content:setEnabled', id, kind, file, enabled),
  removeContent: (id, kind, file) => ipcRenderer.invoke('content:remove', id, kind, file),
  addContentFiles: (id, kind, paths) => ipcRenderer.invoke('content:add', id, kind, paths),
  // Pfad einer per Drag & Drop abgelegten Datei (seit Electron 32 nicht mehr über file.path)
  pathForFile: (file) => webUtils.getPathForFile(file),

  searchModrinth: (id, query, offset) => ipcRenderer.invoke('modrinth:search', id, query, offset),
  installModrinth: (id, projectId) => ipcRenderer.invoke('modrinth:install', id, projectId),
  installPerformancePack: (id) => ipcRenderer.invoke('modrinth:performance', id),

  listShaderpacks: (id) => ipcRenderer.invoke('shaders:list', id),
  searchShaderpacks: (id, query, offset) => ipcRenderer.invoke('shaders:search', id, query, offset),
  installShaderpack: (id, projectId) => ipcRenderer.invoke('shaders:install', id, projectId),
  setActiveShaderpack: (id, file) => ipcRenderer.invoke('shaders:setActive', id, file),
  removeShaderpack: (id, file) => ipcRenderer.invoke('shaders:remove', id, file),
  addShaderpackFiles: (id, paths) => ipcRenderer.invoke('shaders:add', id, paths),

  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  getSkin: () => ipcRenderer.invoke('accounts:skin'),
  listNews: () => ipcRenderer.invoke('news:list'),
  loaderLogos: () => ipcRenderer.invoke('loader:logos'),
  getNewsBody: (id) => ipcRenderer.invoke('news:body', id),
  addMicrosoftAccount: () => ipcRenderer.invoke('accounts:addMicrosoft'),
  addOfflineAccount: (name) => ipcRenderer.invoke('accounts:addOffline', name),
  addAccountViaLauncher: () => ipcRenderer.invoke('accounts:addViaLauncher'),
  cancelBridge: () => ipcRenderer.invoke('bridge:cancel'),
  reopenOfficialLauncher: () => ipcRenderer.invoke('bridge:reopen'),
  onBridgeState: (callback) => subscribe('bridge:state', callback),
  onAccountsChanged: (callback) => subscribe('accounts:changed', () => callback()),
  getDeveloperStatus: () => ipcRenderer.invoke('developer:status'),
  importDeveloperKey: () => ipcRenderer.invoke('developer:import'),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  selectAccount: (id) => ipcRenderer.invoke('accounts:select', id),

  launch: (instanceId, target) => ipcRenderer.invoke('game:launch', instanceId, target),
  listQuickPlay: (instanceId) => ipcRenderer.invoke('instances:quickPlay', instanceId),
  killGame: () => ipcRenderer.invoke('game:kill'),
  getGameState: () => ipcRenderer.invoke('game:state'),
  openFolder: (kind, instanceId) => ipcRenderer.invoke('folder:open', kind, instanceId),

  onProgress: (callback) => subscribe('progress', callback),
  onLog: (callback) => subscribe('log', callback),
  onGameState: (callback) => subscribe('game:state', callback),
  getDiscordStatus: () => ipcRenderer.invoke('discord:status'),
  onDiscordStatus: (callback) => subscribe('discord:status', callback),

  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => subscribe('update:state', callback),

  openWebAccount: (target) => ipcRenderer.invoke('web:account', target),
  openWebsite: (page) => ipcRenderer.invoke('web:open', page),
  getWhatsNew: () => ipcRenderer.invoke('whatsnew:get'),
  markWhatsNewSeen: () => ipcRenderer.invoke('whatsnew:seen'),
};

contextBridge.exposeInMainWorld('heldix', api);
