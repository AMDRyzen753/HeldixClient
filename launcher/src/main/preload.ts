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
  setContentEnabled: (id, kind, file, enabled) => ipcRenderer.invoke('content:setEnabled', id, kind, file, enabled),
  removeContent: (id, kind, file) => ipcRenderer.invoke('content:remove', id, kind, file),
  addContentFiles: (id, kind, paths) => ipcRenderer.invoke('content:add', id, kind, paths),
  // Pfad einer per Drag & Drop abgelegten Datei (seit Electron 32 nicht mehr über file.path)
  pathForFile: (file) => webUtils.getPathForFile(file),

  searchModrinth: (id, query, offset) => ipcRenderer.invoke('modrinth:search', id, query, offset),
  installModrinth: (id, projectId) => ipcRenderer.invoke('modrinth:install', id, projectId),

  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addMicrosoftAccount: () => ipcRenderer.invoke('accounts:addMicrosoft'),
  addOfflineAccount: (name) => ipcRenderer.invoke('accounts:addOffline', name),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  selectAccount: (id) => ipcRenderer.invoke('accounts:select', id),

  launch: (instanceId) => ipcRenderer.invoke('game:launch', instanceId),
  killGame: () => ipcRenderer.invoke('game:kill'),
  getGameState: () => ipcRenderer.invoke('game:state'),
  openFolder: (kind, instanceId) => ipcRenderer.invoke('folder:open', kind, instanceId),

  onProgress: (callback) => subscribe('progress', callback),
  onLog: (callback) => subscribe('log', callback),
  onGameState: (callback) => subscribe('game:state', callback),
  getDiscordStatus: () => ipcRenderer.invoke('discord:status'),
  onDiscordStatus: (callback) => subscribe('discord:status', callback),
};

contextBridge.exposeInMainWorld('heldix', api);
