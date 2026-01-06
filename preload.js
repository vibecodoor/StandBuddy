const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onSettingsLoad: (callback) => ipcRenderer.on('settings-load', (event, settings) => callback(settings)),
  saveSettings: (settings) => ipcRenderer.send('settings-save', settings),
  cancelSettings: () => ipcRenderer.send('settings-cancel'),
  onBreakStart: (callback) => ipcRenderer.on('break-start', (event, data) => callback(data)),
  skipBreak: () => ipcRenderer.send('break-skip')
});
