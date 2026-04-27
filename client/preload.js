const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] ✅ Initialized - No Firebase in sandbox');

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth via server
  login:             (p) => ipcRenderer.invoke('login', p),
  register:          (p) => ipcRenderer.invoke('register', p),
  getMe:             (p) => ipcRenderer.invoke('get-me', p),
  
  // Token & Config
  getToken:          ()  => ipcRenderer.invoke('get-token'),
  saveToken:         (t) => ipcRenderer.invoke('save-token', t),
  clearToken:        ()  => ipcRenderer.invoke('clear-token'),
  getServerUrl:      ()  => ipcRenderer.invoke('get-server-url'),
  saveServerUrl:     (u) => ipcRenderer.invoke('save-server-url', u),
  
  // Search & Chat
  search:            (p) => ipcRenderer.invoke('search', p),
  chat:              (p) => ipcRenderer.invoke('chat', p),
  pitch:             (p) => ipcRenderer.invoke('pitch', p),
  
  // Support Messaging
  supportMessages:     (method, token) => ipcRenderer.invoke('supportMessages', method, token),
  createSupportMessage: (p) => ipcRenderer.invoke('createSupportMessage', p),
  
  // Saved Searches
  saveSearch:        (t, d) => ipcRenderer.invoke('save-search', t, d),
  loadSavedSearches: (t) => ipcRenderer.invoke('load-saved-searches', t),
  deleteSavedSearch: (t, id) => ipcRenderer.invoke('delete-saved-search', t, id),
  
  // Pipeline (token optional — main will use stored token if omitted)
  pipeline:          (method, id, data) => ipcRenderer.invoke('pipeline', method, null, id, data),
  // Assignments (GET, POST, PUT) — token optional
  assignments:        (method, id, data) => ipcRenderer.invoke('assignments', method, null, id, data),
  
  // External
  openExternal:      (u) => ipcRenderer.invoke('open-external', u),
});

console.log('[Preload] ✅ ElectronAPI exposed to renderer');
