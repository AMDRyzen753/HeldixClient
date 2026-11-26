import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { HeldixApi } from '../shared/api';

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: HeldixApi = {
  platform: process.platform,
  openUpdateDownload: () => ipcRenderer.invoke('update:download-page'),
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
  listStoreAddons: (id) => ipcRenderer.invoke('addons:store', id),
  installStoreAddon: (id, addonId) => ipcRenderer.invoke('addons:installStore', id, addonId),
  getStoreOverview: () => ipcRenderer.invoke('store:overview'),
  uninstallStoreAddon: (id, addonId) => ipcRenderer.invoke('store:uninstall', id, addonId),
  getAddonDetails: (addonId) => ipcRenderer.invoke('store:details', addonId),
  getAddonScreenshot: (addonId, index) => ipcRenderer.invoke('store:screenshot', addonId, index),
  rateAddon: (addonId, stars) => ipcRenderer.invoke('store:rate', addonId, stars),
  reportAddon: (addonId, reason, note) => ipcRenderer.invoke('store:report', addonId, reason, note),
  updateAllAddons: () => ipcRenderer.invoke('store:updateAll'),
  onStoreOpen: (callback) => subscribe('store:open', () => callback()),
  onStoreChanged: (callback) => subscribe('store:changed', callback),
  listInstanceContent: (id) => ipcRenderer.invoke('content:listAll', id),
  setContentEnabled: (id, kind, file, enabled) => ipcRenderer.invoke('content:setEnabled', id, kind, file, enabled),
  removeContent: (id, kind, file) => ipcRenderer.invoke('content:remove', id, kind, file),
  addContentFiles: (id, kind, paths) => ipcRenderer.invoke('content:add', id, kind, paths),
  importContentFiles: (id, paths) => ipcRenderer.invoke('content:import', id, paths),
  // Pfad einer per Drag & Drop abgelegten Datei (seit Electron 32 nicht mehr über file.path)
  pathForFile: (file) => webUtils.getPathForFile(file),

  searchModrinth: (id, query, offset) => ipcRenderer.invoke('modrinth:search', id, query, offset),
  installModrinth: (id, projectId) => ipcRenderer.invoke('modrinth:install', id, projectId),
  listModrinthUpdates: (id) => ipcRenderer.invoke('modrinth:updates', id),
  updateModrinthMod: (id, file) => ipcRenderer.invoke('modrinth:update', id, file),
  installPerformancePack: (id) => ipcRenderer.invoke('modrinth:performance', id),

  listShaderpacks: (id) => ipcRenderer.invoke('shaders:list', id),
  searchShaderpacks: (id, query, offset) => ipcRenderer.invoke('shaders:search', id, query, offset),
  installShaderpack: (id, projectId) => ipcRenderer.invoke('shaders:install', id, projectId),
  setActiveShaderpack: (id, file) => ipcRenderer.invoke('shaders:setActive', id, file),
  removeShaderpack: (id, file) => ipcRenderer.invoke('shaders:remove', id, file),
  addShaderpackFiles: (id, paths) => ipcRenderer.invoke('shaders:add', id, paths),

  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  getSkin: () => ipcRenderer.invoke('accounts:skin'),

  getSocial: () => ipcRenderer.invoke('social:get'),
  refreshSocial: () => ipcRenderer.invoke('social:refresh'),
  onSocial: (callback) => subscribe('social:update', callback),
  onSocialOpen: (callback) => subscribe('social:open', callback),
  sendFriendRequest: (name) => ipcRenderer.invoke('social:request', name),
  acceptFriendRequest: (uuid) => ipcRenderer.invoke('social:accept', uuid),
  removeFriendRequest: (uuid) => ipcRenderer.invoke('social:removeRequest', uuid),
  removeFriend: (uuid) => ipcRenderer.invoke('social:removeFriend', uuid),
  listConversations: () => ipcRenderer.invoke('social:conversations'),
  getMessages: (uuid, before) => ipcRenderer.invoke('social:messages', uuid, before),
  sendMessage: (uuid, text) => ipcRenderer.invoke('social:send', uuid, text),
  markRead: (uuid) => ipcRenderer.invoke('social:read', uuid),
  listBlocked: () => ipcRenderer.invoke('social:blocked'),
  blockPlayer: (uuid) => ipcRenderer.invoke('social:block', uuid),
  unblockPlayer: (uuid) => ipcRenderer.invoke('social:unblock', uuid),
  reportPlayer: (uuid, reason, note) => ipcRenderer.invoke('social:report', uuid, reason, note),
  getSocialPrivacy: () => ipcRenderer.invoke('social:privacy'),
  setSocialPrivacy: (patch) => ipcRenderer.invoke('social:setPrivacy', patch),
  joinFriend: (uuid, instanceId) => ipcRenderer.invoke('social:join', uuid, instanceId),
  getPlayerSkin: (uuid) => ipcRenderer.invoke('social:skin', uuid),

  getProfile: (refresh) => ipcRenderer.invoke('profile:get', refresh),
  importSkins: (paths) => ipcRenderer.invoke('profile:import', paths),
  updateSavedSkin: (id, patch) => ipcRenderer.invoke('profile:updateSkin', id, patch),
  deleteSavedSkin: (id) => ipcRenderer.invoke('profile:deleteSkin', id),
  applySkin: (id) => ipcRenderer.invoke('profile:applySkin', id),
  resetSkin: () => ipcRenderer.invoke('profile:resetSkin'),
  setMojangCape: (id) => ipcRenderer.invoke('profile:mojangCape', id),
  setHeldixCape: (id) => ipcRenderer.invoke('profile:heldixCape', id),
  getCosmetics: (refresh) => ipcRenderer.invoke('cosmetics:get', refresh),
  setCosmetic: (slot, id) => ipcRenderer.invoke('cosmetics:set', slot, id),
  onCosmeticsChanged: (callback) => subscribe('cosmetics:changed', () => callback()),
  listNews: () => ipcRenderer.invoke('news:list'),
  loaderLogos: () => ipcRenderer.invoke('loader:logos'),
  getNewsBody: (id) => ipcRenderer.invoke('news:body', id),
  addMicrosoftAccount: () => ipcRenderer.invoke('accounts:addMicrosoft'),
  addOfflineAccount: (name) => ipcRenderer.invoke('accounts:addOffline', name),
  onAccountsChanged: (callback) => subscribe('accounts:changed', () => callback()),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  selectAccount: (id) => ipcRenderer.invoke('accounts:select', id),

  getLastCrash: () => ipcRenderer.invoke('crash:last'),
  getCrashPreview: (id, note, includeFiles) => ipcRenderer.invoke('crash:preview', id, note, includeFiles),
  sendCrashReport: (id, note, includeFiles) => ipcRenderer.invoke('crash:send', id, note, includeFiles),
  openCrashReport: (id) => ipcRenderer.invoke('crash:open', id),
  launch: (instanceId, target) => ipcRenderer.invoke('game:launch', instanceId, target),
  listQuickPlay: (instanceId) => ipcRenderer.invoke('instances:quickPlay', instanceId),
  getServerStatus: (instanceId, address) => ipcRenderer.invoke('instances:serverStatus', instanceId, address),
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
