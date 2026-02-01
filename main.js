const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

let tray = null;
let settingsWindow = null;
let breakWindow = null;
let statsWindow = null;
let intervalTimer = null;
let breakTimer = null;
let isPaused = false;
let remainingTime = 0;
let nextBreakTime = null;
let tooltipInterval = null;
let breakSkipped = false;
let currentBreakStartTime = null;

// Sleep mode variables
let sleepWarningWindow = null;
let shutdownPromptWindow = null;
let sleepModeTimers = [];
let snoozesRemaining = 3;

const defaultSettings = {
  interval: 30,
  breakDuration: 60,
  nextTipIndex: 0,
  launchAtLogin: false,
  todayDate: '',
  todayBreaks: 0,
  activeDays: [],
  sleepModeEnabled: false,
  sleepModeBedtime: '22:00',
  theme: 'warm'
};

let settings = { ...defaultSettings };
let tips = [];

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatCountdown(ms) {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours >= 1) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function calculateStreak() {
  // Streak counts consecutive used days with at least 1 completed break.
  // Days when app was not used are ignored (don't break streak).
  if (!stats.usedDays || stats.usedDays.length === 0) return 0;

  const sortedUsedDays = [...stats.usedDays].sort().reverse();
  let streak = 0;

  for (const day of sortedUsedDays) {
    const completed = stats.days[day]?.completed ?? 0;

    if (completed >= 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function ensureTodayStats() {
  const today = getTodayDateString();
  if (settings.todayDate !== today) {
    settings.todayDate = today;
    settings.todayBreaks = 0;
    saveSettings();
  }
}

function recordCompletedBreak() {
  ensureTodayStats();
  settings.todayBreaks++;
  const today = getTodayDateString();
  if (!settings.activeDays) settings.activeDays = [];
  if (!settings.activeDays.includes(today)) {
    settings.activeDays.push(today);
  }
  saveSettings();
  recordBreakCompleted();
  updateTrayTooltip();
}

function pluralize(word, count) {
  return count === 1 ? word : word + 's';
}

function getCountdownText() {
  if (breakWindow) {
    return 'On break';
  }
  if (isPaused || !nextBreakTime) {
    return 'Paused';
  }
  const remaining = nextBreakTime - Date.now();
  return remaining > 0 ? formatCountdown(remaining) : '0:00';
}

function updateTrayTooltip() {
  if (!tray) return;
  ensureTodayStats();

  const countdown = getCountdownText();
  const streakDays = calculateStreak();
  const todayBreaks = settings.todayBreaks;

  const tooltip = `StandBuddy\r\nNext break in: ${countdown}\r\nToday: ${todayBreaks} ${pluralize('break', todayBreaks)}\r\nActive streak: ${streakDays} ${pluralize('day', streakDays)}`;
  tray.setToolTip(tooltip);
}

function startTooltipInterval() {
  if (tooltipInterval) clearInterval(tooltipInterval);
  tooltipInterval = setInterval(updateTrayTooltip, 1000);
}

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

// Stats data model
const defaultStats = {
  days: {},
  usedDays: [],
  totalCompleted: 0,
  achievements: {}
};

let stats = { ...defaultStats };

const ACHIEVEMENTS = [
  { id: 'first_break', name: 'First Steps', description: 'Complete your first break', icon: '🎯' },
  { id: 'daily_5', name: 'Getting Started', description: '5 breaks in a day', icon: '⭐' },
  { id: 'daily_10', name: 'Dedicated', description: '10 breaks in a day', icon: '🌟' },
  { id: 'daily_15', name: 'Health Champion', description: '15 breaks in a day', icon: '🏆' },
  { id: 'daily_20', name: 'Unstoppable', description: '20 breaks in a day', icon: '🚀' },
  { id: 'streak_3', name: 'Building Habits', description: '3-day streak', icon: '🔥' },
  { id: 'streak_7', name: 'One Week Strong', description: '7-day streak', icon: '💪' },
  { id: 'streak_14', name: 'Two Week Warrior', description: '14-day streak', icon: '⚡' },
  { id: 'streak_30', name: 'Monthly Master', description: '30-day streak', icon: '👑' },
  { id: 'streak_60', name: 'Iron Will', description: '60-day streak', icon: '💎' },
  { id: 'total_25', name: 'Quarter Century', description: '25 total breaks', icon: '🌱' },
  { id: 'total_100', name: 'Century Club', description: '100 total breaks', icon: '💯' },
  { id: 'total_300', name: 'Consistent', description: '300 total breaks', icon: '🎖️' },
  { id: 'total_500', name: 'Halfway Hero', description: '500 total breaks', icon: '🏅' },
  { id: 'total_750', name: 'Almost There', description: '750 total breaks', icon: '🥈' },
  { id: 'total_1000', name: 'Legendary', description: '1000 total breaks', icon: '🥇' }
];

function getStatsPath() {
  return path.join(app.getPath('userData'), 'stats.json');
}

function loadStats() {
  try {
    const data = fs.readFileSync(getStatsPath(), 'utf8');
    stats = { ...defaultStats, ...JSON.parse(data) };
    if (!stats.days) stats.days = {};
    if (!stats.usedDays) stats.usedDays = [];
    if (!stats.achievements) stats.achievements = {};
  } catch (err) {
    stats = { ...defaultStats };
  }
}

function saveStats() {
  try {
    fs.writeFileSync(getStatsPath(), JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error('Failed to save stats:', err);
  }
}

function touchUsedDay() {
  const today = getTodayDateString();
  if (!stats.usedDays.includes(today)) {
    stats.usedDays.push(today);
  }
}

function ensureTodayDayStats() {
  const today = getTodayDateString();
  if (!stats.days[today]) {
    stats.days[today] = {
      completed: 0,
      emergency: 0,
      shown: 0,
      breakMinutes: 0
    };
  }
  return stats.days[today];
}

function recordBreakShown() {
  touchUsedDay();
  const dayStats = ensureTodayDayStats();
  dayStats.shown++;
  currentBreakStartTime = Date.now();
  saveStats();
}

function recordBreakCompleted() {
  touchUsedDay();
  const dayStats = ensureTodayDayStats();
  dayStats.completed++;
  stats.totalCompleted++;

  if (currentBreakStartTime) {
    const elapsedMs = Date.now() - currentBreakStartTime;
    dayStats.breakMinutes += Math.round(elapsedMs / 60000 * 10) / 10;
  }
  currentBreakStartTime = null;

  checkAndUnlockAchievements();
  saveStats();
}

function recordEmergencyDismiss() {
  touchUsedDay();
  const dayStats = ensureTodayDayStats();
  dayStats.emergency++;
  currentBreakStartTime = null;
  saveStats();
}

function checkAndUnlockAchievements() {
  const today = getTodayDateString();
  const dayStats = stats.days[today] || { completed: 0 };
  const streak = calculateStreak();
  const total = stats.totalCompleted;

  const checks = [
    { id: 'first_break', condition: total >= 1 },
    { id: 'daily_5', condition: dayStats.completed >= 5 },
    { id: 'daily_10', condition: dayStats.completed >= 10 },
    { id: 'daily_15', condition: dayStats.completed >= 15 },
    { id: 'daily_20', condition: dayStats.completed >= 20 },
    { id: 'streak_3', condition: streak >= 3 },
    { id: 'streak_7', condition: streak >= 7 },
    { id: 'streak_14', condition: streak >= 14 },
    { id: 'streak_30', condition: streak >= 30 },
    { id: 'streak_60', condition: streak >= 60 },
    { id: 'total_25', condition: total >= 25 },
    { id: 'total_100', condition: total >= 100 },
    { id: 'total_300', condition: total >= 300 },
    { id: 'total_500', condition: total >= 500 },
    { id: 'total_750', condition: total >= 750 },
    { id: 'total_1000', condition: total >= 1000 }
  ];

  for (const check of checks) {
    if (check.condition && !stats.achievements[check.id]) {
      stats.achievements[check.id] = { unlockedAt: new Date().toISOString() };
    }
  }
}

function getStatsForWindow() {
  const today = getTodayDateString();
  const todayStats = stats.days[today] || { completed: 0, emergency: 0, shown: 0, breakMinutes: 0 };
  const streak = calculateStreak();

  // Last 7 days data
  const last7Days = [];
  const completedTimes = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayData = stats.days[dateStr] || { completed: 0 };
    last7Days.push({
      date: dateStr,
      dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
      completed: dayData.completed
    });
    if (dayData.completed > 0) {
      completedTimes.push(dayData.completed);
    }
  }

  // Calculate avg time between completed breaks (rough estimate based on interval setting)
  const avgMinutesBetween = completedTimes.length > 0 ? settings.interval : 0;

  // Achievements with unlock status
  const achievementsData = ACHIEVEMENTS.map(a => ({
    ...a,
    unlocked: !!stats.achievements[a.id],
    unlockedAt: stats.achievements[a.id]?.unlockedAt || null
  }));

  return {
    today: todayStats,
    streak,
    totalCompleted: stats.totalCompleted,
    last7Days,
    avgMinutesBetween,
    achievements: achievementsData
  };
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
    { label: 'Stats', click: openStatsWindow },
    { label: 'Settings...', click: openSettingsWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
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
  nextBreakTime = Date.now() + remainingTime;

  intervalTimer = setTimeout(() => {
    if (!isPaused) {
      showBreakWindow();
    }
  }, remainingTime);
  updateTrayTooltip();
}

function pauseTimer() {
  isPaused = true;
  nextBreakTime = null;
  if (intervalTimer) {
    clearTimeout(intervalTimer);
    intervalTimer = null;
  }
  updateTrayTooltip();
}

function resumeTimer() {
  isPaused = false;
  startIntervalTimer();
}

function showBreakWindow() {
  if (breakWindow) return;

  breakSkipped = false;
  nextBreakTime = null;
  updateTrayTooltip();

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
      tip: currentTip,
      theme: settings.theme
    });
    breakWindow.focus();
    recordBreakShown();
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

function closeBreakWindow(completed = true) {
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

  if (completed && !breakSkipped) {
    recordCompletedBreak();
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
    height: 580,
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

function openStatsWindow() {
  if (statsWindow) {
    statsWindow.focus();
    return;
  }

  statsWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  statsWindow.setMenu(null);
  statsWindow.loadFile('stats.html');

  statsWindow.webContents.on('did-finish-load', () => {
    const statsData = getStatsForWindow();
    statsData.theme = settings.theme;
    statsWindow.webContents.send('stats-load', statsData);
  });

  statsWindow.on('closed', () => {
    statsWindow = null;
  });
}

ipcMain.on('stats-close', () => {
  if (statsWindow) {
    statsWindow.close();
  }
});

ipcMain.on('stats-reset-request', () => {
  const statsPath = getStatsPath();
  if (fs.existsSync(statsPath)) {
    try {
      fs.unlinkSync(statsPath);
    } catch (err) {
      console.error('Failed to delete stats.json:', err);
    }
  }

  stats = { ...defaultStats };

  if (statsWindow) {
    statsWindow.webContents.send('stats-reset', getStatsForWindow());
  }
});

ipcMain.on('settings-save', (event, newSettings) => {
  settings.interval = newSettings.interval;
  settings.breakDuration = newSettings.breakDuration;
  settings.launchAtLogin = newSettings.launchAtLogin;
  settings.sleepModeEnabled = newSettings.sleepModeEnabled;
  settings.sleepModeBedtime = newSettings.sleepModeBedtime;
  settings.theme = newSettings.theme || 'warm';
  saveSettings();

  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin
  });

  if (!isPaused && !breakWindow) {
    startIntervalTimer();
  }

  // Reschedule sleep mode timers
  scheduleSleepModeTimers();

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
  breakSkipped = true;
  recordEmergencyDismiss();
  closeBreakWindow(false);
});

// =====================
// Sleep Mode Functions
// =====================

function getNextBedtime() {
  if (!settings.sleepModeBedtime) return null;

  const [hours, minutes] = settings.sleepModeBedtime.split(':').map(Number);
  const now = new Date();
  const bedtime = new Date();
  bedtime.setHours(hours, minutes, 0, 0);

  // If bedtime has passed today, schedule for tomorrow
  if (bedtime <= now) {
    bedtime.setDate(bedtime.getDate() + 1);
  }

  return bedtime;
}

function clearSleepModeTimers() {
  for (const timer of sleepModeTimers) {
    clearTimeout(timer);
  }
  sleepModeTimers = [];
}

function scheduleSleepModeTimers() {
  clearSleepModeTimers();

  if (!settings.sleepModeEnabled) {
    return;
  }

  const bedtime = getNextBedtime();
  if (!bedtime) return;

  const now = Date.now();
  const bedtimeMs = bedtime.getTime();

  // Schedule warnings at 30, 15, and 5 minutes before bedtime
  const warningMinutes = [30, 15, 5];

  for (const minutes of warningMinutes) {
    const warningTime = bedtimeMs - (minutes * 60 * 1000);
    const delay = warningTime - now;

    if (delay > 0) {
      const timer = setTimeout(() => {
        showSleepWarningWindow(minutes);
      }, delay);
      sleepModeTimers.push(timer);
    }
  }

  // Schedule shutdown prompt at bedtime
  const shutdownDelay = bedtimeMs - now;
  if (shutdownDelay > 0) {
    const timer = setTimeout(() => {
      snoozesRemaining = 3;
      showShutdownPromptWindow();
    }, shutdownDelay);
    sleepModeTimers.push(timer);
  }

  console.log(`Sleep mode scheduled. Bedtime: ${bedtime.toLocaleTimeString()}`);
}

function showSleepWarningWindow(minutesLeft) {
  if (sleepWarningWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  sleepWarningWindow = new BrowserWindow({
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

  sleepWarningWindow.setAlwaysOnTop(true, 'screen-saver');
  sleepWarningWindow.setVisibleOnAllWorkspaces(true);

  sleepWarningWindow.loadFile('sleep-warning.html');
  sleepWarningWindow.webContents.on('did-finish-load', () => {
    sleepWarningWindow.webContents.send('sleep-warning-start', {
      minutesLeft: minutesLeft,
      theme: settings.theme
    });
    sleepWarningWindow.focus();
  });

  sleepWarningWindow.on('closed', () => {
    sleepWarningWindow = null;
  });

  sleepWarningWindow.on('blur', () => {
    if (sleepWarningWindow) {
      sleepWarningWindow.focus();
    }
  });
}

function closeSleepWarningWindow() {
  if (sleepWarningWindow) {
    sleepWarningWindow.setClosable(true);
    sleepWarningWindow.setKiosk(false);
    sleepWarningWindow.destroy();
    sleepWarningWindow = null;
  }
}

function showShutdownPromptWindow() {
  if (shutdownPromptWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  shutdownPromptWindow = new BrowserWindow({
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

  shutdownPromptWindow.setAlwaysOnTop(true, 'screen-saver');
  shutdownPromptWindow.setVisibleOnAllWorkspaces(true);

  shutdownPromptWindow.loadFile('shutdown-prompt.html');
  shutdownPromptWindow.webContents.on('did-finish-load', () => {
    shutdownPromptWindow.webContents.send('shutdown-prompt-start', {
      snoozesLeft: snoozesRemaining,
      theme: settings.theme
    });
    shutdownPromptWindow.focus();
  });

  shutdownPromptWindow.on('closed', () => {
    shutdownPromptWindow = null;
  });

  shutdownPromptWindow.on('blur', () => {
    if (shutdownPromptWindow) {
      shutdownPromptWindow.focus();
    }
  });
}

function closeShutdownPromptWindow() {
  if (shutdownPromptWindow) {
    shutdownPromptWindow.setClosable(true);
    shutdownPromptWindow.setKiosk(false);
    shutdownPromptWindow.destroy();
    shutdownPromptWindow = null;
  }
}

function executeSystemShutdown() {
  closeShutdownPromptWindow();
  // Windows shutdown command
  exec('shutdown /s /t 0', (error) => {
    if (error) {
      console.error('Failed to execute shutdown:', error);
    }
  });
}

// Sleep mode IPC handlers
ipcMain.on('sleep-warning-close', () => {
  closeSleepWarningWindow();
});

ipcMain.on('shutdown-snooze', (event, newSnoozesLeft) => {
  snoozesRemaining = newSnoozesLeft;
  closeShutdownPromptWindow();

  // Schedule next shutdown prompt in 5 minutes
  const snoozeTimer = setTimeout(() => {
    showShutdownPromptWindow();
  }, 5 * 60 * 1000);
  sleepModeTimers.push(snoozeTimer);
});

ipcMain.on('shutdown-execute', () => {
  executeSystemShutdown();
});

app.whenReady().then(() => {
  loadSettings();
  loadStats();
  loadTips();

  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin
  });

  tray = new Tray(getTrayIconPath());
  updateTrayMenu();

  startIntervalTimer();
  startTooltipInterval();
  scheduleSleepModeTimers();

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });
});

app.on('before-quit', () => {
  if (intervalTimer) clearTimeout(intervalTimer);
  if (breakTimer) clearTimeout(breakTimer);
  if (tooltipInterval) clearInterval(tooltipInterval);
  clearSleepModeTimers();
});
