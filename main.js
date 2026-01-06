const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let settingsWindow = null;
let breakWindow = null;
let intervalTimer = null;
let breakTimer = null;
let isPaused = false;
let remainingTime = 0;

const defaultSettings = {
  interval: 30,
  breakDuration: 60,
  nextTipIndex: 0,
  launchAtLogin: false
};

let settings = { ...defaultSettings };
let tips = [];

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf8');
    settings = { ...defaultSettings, ...JSON.parse(data) };
  } catch (err) {
    settings = { ...defaultSettings };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function loadTips() {
  try {
    // In packaged app, use path relative to __dirname (inside asar)
    const tipsPath = path.join(__dirname, 'tips.json');
    const data = fs.readFileSync(tipsPath, 'utf8');
    tips = JSON.parse(data);
  } catch (err) {
    console.error('Failed to load tips:', err);
    tips = [];
  }
}

function getNextTip() {
  if (tips.length === 0) {
    return null;
  }
  const index = settings.nextTipIndex % tips.length;
  const tip = tips[index];
  settings.nextTipIndex = (index + 1) % tips.length;
  saveSettings();
  return tip;
}

function getTrayIconPath() {
  const iconName = process.platform === 'win32' ? 'tray.ico' : 'tray.png';

  // First try: packaged app (resourcesPath)
  const resourcePath = path.join(process.resourcesPath, 'assets', iconName);
  if (fs.existsSync(resourcePath)) {
    console.log(`Tray icon path: ${resourcePath} (exists: true)`);
    return resourcePath;
  }

  // Fallback: development mode (__dirname)
  const devPath = path.join(__dirname, 'assets', iconName);
  const exists = fs.existsSync(devPath);
  console.log(`Tray icon path: ${devPath} (exists: ${exists})`);
  return devPath;
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: isPaused ? 'Resume' : 'Pause',
      click: () => {
        if (isPaused) {
          resumeTimer();
        } else {
          pauseTimer();
        }
        updateTrayMenu();
      }
    },
    {
      label: 'Settings...',
      click: () => {
        openSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
}

function updateTrayMenu() {
  if (tray) {
    tray.setContextMenu(buildContextMenu());
  }
}

function startIntervalTimer() {
  if (intervalTimer) {
    clearTimeout(intervalTimer);
  }

  remainingTime = settings.interval * 60 * 1000;

  intervalTimer = setTimeout(() => {
    if (!isPaused) {
      showBreakWindow();
    }
  }, remainingTime);
}

function pauseTimer() {
  isPaused = true;
  if (intervalTimer) {
    clearTimeout(intervalTimer);
    intervalTimer = null;
  }
}

function resumeTimer() {
  isPaused = false;
  startIntervalTimer();
}

function showBreakWindow() {
  if (breakWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  breakWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true,
    fullscreen: true,
    simpleFullscreen: true,
    kiosk: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  breakWindow.setAlwaysOnTop(true, 'screen-saver');
  breakWindow.setVisibleOnAllWorkspaces(true);

  const currentTip = getNextTip();

  breakWindow.loadFile('break.html');
  breakWindow.webContents.on('did-finish-load', () => {
    breakWindow.webContents.send('break-start', {
      duration: settings.breakDuration,
      tip: currentTip
    });
    breakWindow.focus();
  });

  breakWindow.on('closed', () => {
    breakWindow = null;
  });

  breakWindow.on('blur', () => {
    if (breakWindow) {
      breakWindow.focus();
    }
  });

  startBreakTimer();
}

function startBreakTimer() {
  if (breakTimer) {
    clearTimeout(breakTimer);
  }

  breakTimer = setTimeout(() => {
    closeBreakWindow();
  }, settings.breakDuration * 1000);
}

function closeBreakWindow() {
  if (breakTimer) {
    clearTimeout(breakTimer);
    breakTimer = null;
  }

  if (breakWindow) {
    breakWindow.setClosable(true);
    breakWindow.setKiosk(false);
    breakWindow.destroy();
    breakWindow = null;
  }

  if (!isPaused) {
    startIntervalTimer();
  }
}

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 380,
    height: 420,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile('settings.html');

  settingsWindow.webContents.on('did-finish-load', () => {
    settingsWindow.webContents.send('settings-load', settings);
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

ipcMain.on('settings-save', (event, newSettings) => {
  settings.interval = newSettings.interval;
  settings.breakDuration = newSettings.breakDuration;
  settings.launchAtLogin = newSettings.launchAtLogin;
  saveSettings();

  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin
  });

  if (!isPaused && !breakWindow) {
    startIntervalTimer();
  }

  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.on('settings-cancel', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.on('break-skip', () => {
  closeBreakWindow();
});

app.whenReady().then(() => {
  loadSettings();
  loadTips();

  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin
  });

  tray = new Tray(getTrayIconPath());
  tray.setToolTip('StandBuddy');
  updateTrayMenu();

  startIntervalTimer();

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });
});

app.on('before-quit', () => {
  if (intervalTimer) clearTimeout(intervalTimer);
  if (breakTimer) clearTimeout(breakTimer);
});
