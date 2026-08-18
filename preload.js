const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onSettingsLoad: (callback) => ipcRenderer.on('settings-load', (event, settings) => callback(settings)),
  saveSettings: (settings) => ipcRenderer.send('settings-save', settings),
  cancelSettings: () => ipcRenderer.send('settings-cancel'),
  onBreakStart: (callback) => ipcRenderer.on('break-start', (event, data) => callback(data)),
  skipBreak: () => ipcRenderer.send('break-skip'),
  onStatsLoad: (callback) => ipcRenderer.on('stats-load', (event, stats) => callback(stats)),
  onStatsReset: (callback) => ipcRenderer.on('stats-reset', (event, stats) => callback(stats)),
  resetStats: () => ipcRenderer.send('stats-reset-request'),
  closeStats: () => ipcRenderer.send('stats-close'),
  // Sleep mode
  onSleepWarningStart: (callback) => ipcRenderer.on('sleep-warning-start', (event, data) => callback(data)),
  closeSleepWarning: () => ipcRenderer.send('sleep-warning-close'),
  onShutdownPromptStart: (callback) => ipcRenderer.on('shutdown-prompt-start', (event, data) => callback(data)),
  snoozeShutdown: (snoozesLeft) => ipcRenderer.send('shutdown-snooze', snoozesLeft),
  executeShutdown: () => ipcRenderer.send('shutdown-execute'),
  // Game limiter
  onGameWarningStart: (callback) => ipcRenderer.on('game-warning-start', (event, data) => callback(data)),
  onGameBlockedStart: (callback) => ipcRenderer.on('game-blocked-start', (event, data) => callback(data)),
  pickGameExe: () => ipcRenderer.invoke('game-pick-exe'),
  scanSteamGames: () => ipcRenderer.invoke('steam-list-games')
});
