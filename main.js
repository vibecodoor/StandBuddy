const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const gameMonitor = require('./game-monitor');
const steamScan = require('./steam-scan');

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

// Game limiter variables
let gameSessionStart = null;
let currentGameProcess = null;
let gameTimers = [];
let gameLimitReachedToday = false;
let gameLimitDayKey = '';
let gameWarningWindow = null;
let gameWarningCloseTimer = null;
let gameBlockedWindow = null;
let gameBlockedCloseTimer = null;
let gameAutoPaused = false; // reminders auto-paused because a pause-flagged game is running

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
  theme: 'warm',
  gameLimiterEnabled: false,
  gameLimitHours: 4,
  gameList: [],
  gameNames: {}, // exe (lowercase) -> friendly display name; display only
  gamePauseList: [] // exes (lowercase) that pause break reminders while running
};

let settings = { ...defaultSettings };
let tips = [];

// Window background the OS paints before the renderer's first frame. Without it
// Electron uses its default white, which flashes for a frame on every overlay.
// Values mirror --overlay-bg-1 / --bg-base in themes.css.
const THEME_BG = {
  warm:     { overlay: '#1a1612', light: '#faf8f5' },
  ocean:    { overlay: '#0d1520', light: '#f5f8fa' },
  forest:   { overlay: '#0d150d', light: '#f5f8f5' },
  lavender: { overlay: '#150d18', light: '#f8f5fa' },
  slate:    { overlay: '#12151a', light: '#f5f6f7' },
  rose:     { overlay: '#180d10', light: '#faf5f6' }
};

function themeBg(kind) {
  return (THEME_BG[settings.theme] || THEME_BG.warm)[kind];
}

// Windows are created hidden and revealed only once they have actually painted,
// so no unpainted (white) frame ever reaches the screen. The timeout is a safety
// net: an overlay that never appears is worse than one that flashes.
function revealWhenPainted(win, reveal = (w) => w.show()) {
  let done = false;
  const showOnce = () => {
    if (done || !win || win.isDestroyed()) return;
    done = true;
    reveal(win);
  };
  win.once('ready-to-show', showOnce);
  setTimeout(showOnce, 1500);
}

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

function ensureGameDay() {
  // Reset the "limit reached" flag when the calendar day changes.
  const today = getTodayDateString();
  if (gameLimitDayKey !== today) {
    gameLimitDayKey = today;
    gameLimitReachedToday = false;
  }
}

function getTodayGameMinutes() {
  const today = getTodayDateString();
  return stats.days[today]?.gameMinutes ?? 0;
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
    return gameAutoPaused ? 'Paused (gaming)' : 'Paused';
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

  let tooltip = `StandBuddy\r\nNext break in: ${countdown}\r\nToday: ${todayBreaks} ${pluralize('break', todayBreaks)}\r\nActive streak: ${streakDays} ${pluralize('day', streakDays)}`;

  if (settings.gameLimiterEnabled) {
    const used = liveGameMinutes();
    const limitMin = (settings.gameLimitHours || 4) * 60;
    const fmt = (m) => {
      const h = Math.floor(m / 60);
      const min = Math.floor(m % 60);
      return h > 0 ? `${h}h ${min}m` : `${min}m`;
    };
    tooltip += `\r\nGame time today: ${fmt(used)} / ${settings.gameLimitHours || 4}h`;
  }

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
      breakMinutes: 0,
      gameMinutes: 0
    };
  }
  if (stats.days[today].gameMinutes === undefined) {
    stats.days[today].gameMinutes = 0;
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
        // A manual pause/resume takes over from any game auto-pause.
        gameAutoPaused = false;
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
    show: false,
    backgroundColor: themeBg('overlay'),
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
  // dom-ready, not did-finish-load: the payload (theme, tip, duration) must land
  // before the first paint, and did-finish-load also waits on the web fonts.
  breakWindow.webContents.on('dom-ready', () => {
    if (!breakWindow) return;
    breakWindow.webContents.send('break-start', {
      duration: settings.breakDuration,
      tip: currentTip,
      theme: settings.theme
    });
  });

  revealWhenPainted(breakWindow, (win) => {
    win.show();
    win.focus();
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
    height: 760,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: themeBg('light'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile('settings.html');

  settingsWindow.webContents.on('dom-ready', () => {
    if (!settingsWindow) return;
    settingsWindow.webContents.send('settings-load', settings);
  });

  revealWhenPainted(settingsWindow);

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
    show: false,
    backgroundColor: themeBg('light'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  statsWindow.setMenu(null);
  statsWindow.loadFile('stats.html');

  statsWindow.webContents.on('dom-ready', () => {
    if (!statsWindow) return;
    const statsData = getStatsForWindow();
    statsData.theme = settings.theme;
    statsWindow.webContents.send('stats-load', statsData);
  });

  revealWhenPainted(statsWindow);

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
  settings.gameLimiterEnabled = newSettings.gameLimiterEnabled || false;
  settings.gameLimitHours = newSettings.gameLimitHours || 4;
  settings.gameList = Array.isArray(newSettings.gameList) ? newSettings.gameList : [];
  settings.gameNames = (newSettings.gameNames && typeof newSettings.gameNames === 'object')
    ? newSettings.gameNames : {};
  // Pause-reminders list: lowercased and pruned to exes still in gameList.
  const listLower = settings.gameList.map((e) => String(e).toLowerCase());
  settings.gamePauseList = (Array.isArray(newSettings.gamePauseList) ? newSettings.gamePauseList : [])
    .map((e) => String(e).toLowerCase())
    .filter((e) => listLower.includes(e));
  saveSettings();

  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin
  });

  if (!isPaused && !breakWindow) {
    startIntervalTimer();
  }

  // Reschedule sleep mode timers
  scheduleSleepModeTimers();

  // Restart the game limiter with the new config.
  stopGameLimiter();
  startGameLimiter();

  // Ensure the elevated kill task exists (one UAC prompt) whenever the limiter is
  // on. Only prompts if the task is missing — re-saving with it present is silent.
  if (settings.gameLimiterEnabled) {
    ensureKillTask();
  }

  if (settingsWindow) {
    settingsWindow.close();
  }
});

ipcMain.handle('game-pick-exe', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select a game executable',
    properties: ['openFile'],
    filters: [{ name: 'Executables', extensions: ['exe'] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return path.basename(result.filePaths[0]).toLowerCase();
});

// Scan installed Steam games and suggest each game's main executable.
// Returns [] on any failure (Steam not found, permission, etc.).
ipcMain.handle('steam-list-games', async () => {
  try {
    return await steamScan.listGames();
  } catch (err) {
    console.error('steam-scan: failed to list games:', err.message);
    return [];
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
    show: false,
    backgroundColor: themeBg('overlay'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  sleepWarningWindow.setAlwaysOnTop(true, 'screen-saver');
  sleepWarningWindow.setVisibleOnAllWorkspaces(true);

  sleepWarningWindow.loadFile('sleep-warning.html');
  sleepWarningWindow.webContents.on('dom-ready', () => {
    if (!sleepWarningWindow) return;
    sleepWarningWindow.webContents.send('sleep-warning-start', {
      minutesLeft: minutesLeft,
      theme: settings.theme
    });
  });

  revealWhenPainted(sleepWarningWindow, (win) => {
    win.show();
    win.focus();
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
    show: false,
    backgroundColor: themeBg('overlay'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  shutdownPromptWindow.setAlwaysOnTop(true, 'screen-saver');
  shutdownPromptWindow.setVisibleOnAllWorkspaces(true);

  shutdownPromptWindow.loadFile('shutdown-prompt.html');
  shutdownPromptWindow.webContents.on('dom-ready', () => {
    if (!shutdownPromptWindow) return;
    shutdownPromptWindow.webContents.send('shutdown-prompt-start', {
      snoozesLeft: snoozesRemaining,
      theme: settings.theme
    });
  });

  revealWhenPainted(shutdownPromptWindow, (win) => {
    win.show();
    win.focus();
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

// =====================
// Game Limiter
// =====================

const GAME_POLL_IDLE_MS = 10 * 60 * 1000;   // 10 min while not gaming
const GAME_POLL_ACTIVE_MS = 60 * 1000;      // 1 min during an active session
const GAME_STATS_WRITE_MS = 5 * 60 * 1000;  // throttle disk writes during play
let gamePollTimer = null;
let gamePollMode = null;
let lastGameStatsWrite = 0;

function normalizeProcName(name) {
  return String(name || '').toLowerCase().replace(/\.exe$/, '');
}

// Returns the matching gameList entry (e.g. "cs2.exe") or null.
function matchGameProcess(name) {
  const n = normalizeProcName(name);
  if (!n) return null;
  for (const entry of (settings.gameList || [])) {
    if (normalizeProcName(entry) === n) return entry;
  }
  return null;
}

function toImageName(entry) {
  const n = normalizeProcName(entry);
  // Keep only safe image-name characters.
  if (!n || !/^[a-z0-9._-]+$/.test(n)) return '';
  return `${n}.exe`;
}

// Live daily total incl. the in-progress session (for tooltip display).
function liveGameMinutes() {
  let total = getTodayGameMinutes();
  if (gameSessionStart) {
    total += (Date.now() - gameSessionStart) / 60000;
  }
  return total;
}

// Accrue elapsed game time into the day stats and reset the session baseline
// (crash-safe, no double count). The in-memory total is always current; the disk
// write is throttled during play and forced on session end / enforce / suspend / stop.
function flushGameTime(force = false) {
  if (!gameSessionStart) return;
  const now = Date.now();
  const elapsedMin = (now - gameSessionStart) / 60000;
  const day = ensureTodayDayStats();
  day.gameMinutes = Math.round((day.gameMinutes + elapsedMin) * 10) / 10;
  gameSessionStart = now;
  if (force || now - lastGameStatsWrite >= GAME_STATS_WRITE_MS) {
    lastGameStatsWrite = now;
    saveStats();
  }
}

function clearGameTimers() {
  for (const t of gameTimers) clearTimeout(t);
  gameTimers = [];
}

function setGamePollMode(mode) {
  if (gamePollMode === mode && gamePollTimer) return;
  gamePollMode = mode;
  if (gamePollTimer) clearInterval(gamePollTimer);
  const ms = mode === 'active' ? GAME_POLL_ACTIVE_MS : GAME_POLL_IDLE_MS;
  gamePollTimer = setInterval(() => gameMonitor.poll(), ms);
}

function scheduleGameTimers() {
  clearGameTimers();
  const limitMin = (settings.gameLimitHours || 4) * 60;
  const remaining = limitMin - getTodayGameMinutes();

  if (remaining <= 0) {
    enforceGameLimit();
    return;
  }

  const min = (m) => Math.max(0, m) * 60 * 1000;
  if (remaining > 30) {
    gameTimers.push(setTimeout(() => showGameWarning(30), min(remaining - 30)));
  }
  if (remaining > 5) {
    gameTimers.push(setTimeout(() => showGameWarning(5), min(remaining - 5)));
  }
  gameTimers.push(setTimeout(() => enforceGameLimit(), min(remaining)));
}

// Is this game flagged to pause break reminders while it runs?
function gameShouldPauseReminders(entry) {
  const base = normalizeProcName(entry);
  return (settings.gamePauseList || []).some((e) => normalizeProcName(e) === base);
}

// Pause break reminders for a pause-flagged game. No-op if the user already paused
// manually (we don't take over a manual pause).
function applyGamePause(entry) {
  if (gameAutoPaused || isPaused) return;
  if (!gameShouldPauseReminders(entry)) return;
  pauseTimer();
  gameAutoPaused = true;
  updateTrayMenu();
  updateTrayTooltip();
  console.log(`game-limiter: break reminders paused for ${entry}`);
}

// Resume reminders if they were auto-paused by a game (manual pause is left alone).
function clearGamePause() {
  if (!gameAutoPaused) return;
  gameAutoPaused = false;
  if (!breakWindow) resumeTimer();
  updateTrayMenu();
  updateTrayTooltip();
  console.log('game-limiter: break reminders resumed after game');
}

function startGameSession(matchedEntry) {
  gameSessionStart = Date.now();
  currentGameProcess = matchedEntry;
  setGamePollMode('active');
  scheduleGameTimers();
  applyGamePause(matchedEntry);
  updateTrayTooltip();
  console.log(`game-limiter: session start (${matchedEntry})`);
}

// Clear session runtime state without persisting (used after flush/enforce).
function resetGameSessionState() {
  gameSessionStart = null;
  currentGameProcess = null;
  clearGameTimers();
  setGamePollMode('idle');
  clearGamePause();
}

function endGameSession() {
  flushGameTime(true);
  console.log(`game-limiter: session end (today ${getTodayGameMinutes().toFixed(1)} min)`);
  resetGameSessionState();
  updateTrayTooltip();
}

// --- Elevated kill via a Windows Scheduled Task ---------------------------
// Protected/elevated games (e.g. Apex Legends under EAC) reject `taskkill` from
// our non-elevated process ("Access denied"). To kill them we register a single
// on-demand Scheduled Task with HighestAvailable run level (one UAC prompt, when
// the user enables the feature), then trigger it silently via `schtasks /run`.
// The task is inert otherwise — it has no trigger, so it never fires on its own.
const KILL_TASK_NAME = 'StandBuddy-KillGame';

function getKillScriptPath() { return path.join(app.getPath('userData'), 'kill-game.ps1'); }
function getKillTargetPath() { return path.join(app.getPath('userData'), 'kill-target.txt'); }
function getKillTaskXmlPath() { return path.join(app.getPath('userData'), 'kill-task.xml'); }

// The elevated helper script. Reads the target exe from kill-target.txt, validates
// it, cross-checks it against gameList in settings.json (so a tampered target file
// can only ever kill a listed game, never an arbitrary process), then taskkills it.
// String.raw keeps backslashes literal; the script uses no ${...} so interpolation
// does not fire. All paths are derived from the script's own folder ($PSScriptRoot),
// which is userData — alongside settings.json and kill-target.txt.
const KILL_SCRIPT = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
$targetFile = Join-Path $dir 'kill-target.txt'
$cfgFile = Join-Path $dir 'settings.json'
if (-not (Test-Path $targetFile)) { return }
$img = (Get-Content -Raw -LiteralPath $targetFile).Trim().ToLower()
if ($img -notmatch '^[a-z0-9._-]+\.exe$') { return }
$base = $img -replace '\.exe$', ''
$allowed = $false
try {
  $cfg = Get-Content -Raw -LiteralPath $cfgFile | ConvertFrom-Json
  foreach ($g in $cfg.gameList) {
    if ((([string]$g) -replace '\.exe$', '').ToLower() -eq $base) { $allowed = $true; break }
  }
} catch { }
if ($allowed) { & taskkill.exe /f /im $img | Out-Null }
`;

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Task XML: no <Triggers> (never self-fires), on-demand only, HighestAvailable so
// the kill runs with the user's elevated token.
function buildKillTaskXml() {
  const args = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${getKillScriptPath()}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>StandBuddy game-limiter enforcement (kills a listed game when the daily limit is reached).</Description>
  </RegistrationInfo>
  <Triggers />
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

// Is the elevated kill task registered?
function killTaskExists() {
  return new Promise((resolve) => {
    execFile('schtasks', ['/query', '/tn', KILL_TASK_NAME], (error) => resolve(!error));
  });
}

// Register the kill task. Creating a HighestAvailable task requires admin, so the
// `schtasks /create` runs through one UAC prompt (Start-Process -Verb RunAs).
// Resolves true once the task is verifiably present.
async function ensureKillTask() {
  if (await killTaskExists()) return true;
  try {
    fs.writeFileSync(getKillScriptPath(), KILL_SCRIPT, 'utf8');
    // schtasks expects UTF-16 XML with a BOM.
    fs.writeFileSync(getKillTaskXmlPath(), '﻿' + buildKillTaskXml(), 'utf16le');
  } catch (err) {
    console.error('game-limiter: failed to write kill task files:', err.message);
    return false;
  }
  const createArgs = `/create /tn ${KILL_TASK_NAME} /xml "${getKillTaskXmlPath()}" /f`;
  const psCmd = `try { $p = Start-Process -FilePath schtasks.exe -ArgumentList '${createArgs.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru; exit $p.ExitCode } catch { exit 1 }`;
  await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], () => resolve());
  });
  const ok = await killTaskExists();
  if (!ok) console.error('game-limiter: kill task was not registered (UAC declined?)');
  return ok;
}

// Direct (non-elevated) taskkill. Works for unprotected games or if the app itself
// is elevated; surfaces stderr instead of swallowing it (silent-loop bug fix).
function directTaskkill(image) {
  execFile('taskkill', ['/f', '/im', image], (error, stdout, stderr) => {
    if (error) {
      const msg = (stderr && stderr.trim()) || error.message;
      console.error(`game-limiter: taskkill failed for ${image}: ${msg}`);
    } else {
      console.log(`game-limiter: killed ${image}`);
    }
  });
}

function killGame(entry) {
  const image = toImageName(entry);
  // Image name is normalized to [a-z0-9._-]+.exe; reject anything else as a guard.
  if (!image || !/^[a-z0-9._-]+\.exe$/.test(image)) return;
  // Hand the target to the elevated task, then trigger it. The task is the only
  // way to kill protected games; if it isn't registered, fall back to a direct
  // (likely failing, but now visible) taskkill.
  let wroteTarget = false;
  try {
    fs.writeFileSync(getKillTargetPath(), image, 'utf8');
    wroteTarget = true;
  } catch (err) {
    console.error('game-limiter: failed to write kill target:', err.message);
  }
  if (!wroteTarget) {
    directTaskkill(image);
    return;
  }
  execFile('schtasks', ['/run', '/tn', KILL_TASK_NAME], (error) => {
    if (error) {
      console.error('game-limiter: kill task unavailable, falling back to direct taskkill:', error.message);
      directTaskkill(image);
    } else {
      console.log(`game-limiter: kill task triggered for ${image}`);
    }
  });
}

function enforceGameLimit() {
  flushGameTime(true);
  gameLimitReachedToday = true;
  gameLimitDayKey = getTodayDateString();
  const proc = currentGameProcess;
  resetGameSessionState();
  // Keep polling fast for the rest of the day so a relaunch is killed within
  // one active interval instead of up to one idle interval (~10 min) later.
  setGamePollMode('active');
  if (proc) killGame(proc);
  showGameBlockedWindow();
  updateTrayTooltip();
  console.log('game-limiter: daily limit reached, enforcing');
}

function handleForeground(name) {
  if (!settings.gameLimiterEnabled) return;
  ensureGameDay();

  const matched = matchGameProcess(name);

  // Limit already reached today: kill any relaunch of a listed game.
  if (gameLimitReachedToday) {
    if (gameSessionStart) resetGameSessionState();
    if (matched) {
      killGame(matched);
      showGameBlockedWindow();
    }
    return;
  }

  if (matched) {
    if (!gameSessionStart) {
      startGameSession(matched);
    } else {
      currentGameProcess = matched;
      flushGameTime();        // persist incremental time (crash-safe)
      updateTrayTooltip();
    }
  } else if (gameSessionStart) {
    endGameSession();
  }
}

function closeGameWarning() {
  if (gameWarningCloseTimer) {
    clearTimeout(gameWarningCloseTimer);
    gameWarningCloseTimer = null;
  }
  if (gameWarningWindow) {
    gameWarningWindow.destroy();
    gameWarningWindow = null;
  }
}

function showGameWarning(minutesLeft) {
  closeGameWarning(); // replace any existing toast

  const W = 380;
  const H = 150;
  const primaryDisplay = screen.getPrimaryDisplay();
  const area = primaryDisplay.workArea; // excludes taskbar
  const x = area.x + area.width - W;
  const y = area.y + area.height - H;

  gameWarningWindow = new BrowserWindow({
    width: W,
    height: H,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  gameWarningWindow.setAlwaysOnTop(true, 'screen-saver');
  gameWarningWindow.setVisibleOnAllWorkspaces(true);
  gameWarningWindow.setIgnoreMouseEvents(true); // click-through, never blocks the game

  gameWarningWindow.loadFile('game-warning.html');
  gameWarningWindow.webContents.on('dom-ready', () => {
    if (!gameWarningWindow) return;
    gameWarningWindow.webContents.send('game-warning-start', {
      minutesLeft,
      theme: settings.theme
    });
  });

  // showInactive: appear without stealing focus from the game.
  revealWhenPainted(gameWarningWindow, (win) => win.showInactive());

  gameWarningWindow.on('closed', () => {
    gameWarningWindow = null;
  });

  // Auto-dismiss after the toast's slide-out animation (~7s).
  gameWarningCloseTimer = setTimeout(closeGameWarning, 7500);
}

function closeGameBlockedWindow() {
  if (gameBlockedCloseTimer) {
    clearTimeout(gameBlockedCloseTimer);
    gameBlockedCloseTimer = null;
  }
  if (gameBlockedWindow) {
    gameBlockedWindow.setClosable(true);
    gameBlockedWindow.setKiosk(false);
    gameBlockedWindow.destroy();
    gameBlockedWindow = null;
  }
}

function showGameBlockedWindow() {
  // Guard: re-launch attempts after the limit shouldn't stack overlays.
  if (gameBlockedWindow) {
    if (gameBlockedCloseTimer) clearTimeout(gameBlockedCloseTimer);
    gameBlockedCloseTimer = setTimeout(closeGameBlockedWindow, 5500);
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  gameBlockedWindow = new BrowserWindow({
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
    show: false,
    backgroundColor: themeBg('overlay'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  gameBlockedWindow.setAlwaysOnTop(true, 'screen-saver');
  gameBlockedWindow.setVisibleOnAllWorkspaces(true);

  gameBlockedWindow.loadFile('game-blocked.html');
  gameBlockedWindow.webContents.on('dom-ready', () => {
    if (!gameBlockedWindow) return;
    gameBlockedWindow.webContents.send('game-blocked-start', {
      theme: settings.theme,
      limitHours: settings.gameLimitHours || 4
    });
  });

  revealWhenPainted(gameBlockedWindow, (win) => {
    win.show();
    win.focus();
  });

  gameBlockedWindow.on('closed', () => {
    gameBlockedWindow = null;
  });

  // Game is already killed; no reason to hold the screen — auto-close.
  gameBlockedCloseTimer = setTimeout(closeGameBlockedWindow, 5500);
}

let gamePowerHooksRegistered = false;

// Register once: don't count OS sleep/suspend as game time.
function registerGamePowerHooks() {
  if (gamePowerHooksRegistered) return;
  gamePowerHooksRegistered = true;
  // Credit play time accrued right up to the moment of sleep.
  powerMonitor.on('suspend', () => {
    if (gameSessionStart) flushGameTime(true);
  });
  // Discard the suspended interval so it isn't billed as game time.
  powerMonitor.on('resume', () => {
    if (gameSessionStart) gameSessionStart = Date.now();
  });
}

function startGameLimiter() {
  if (!settings.gameLimiterEnabled) return;
  ensureGameDay();
  gameMonitor.startMonitor(handleForeground);
  setGamePollMode('idle');
  gameMonitor.poll(); // immediate first read
  console.log('game-limiter: started');
}

function stopGameLimiter() {
  if (gameSessionStart) flushGameTime(true);
  closeGameWarning();
  closeGameBlockedWindow();
  resetGameSessionState();
  if (gamePollTimer) {
    clearInterval(gamePollTimer);
    gamePollTimer = null;
    gamePollMode = null;
  }
  gameMonitor.stopMonitor();
}

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
  registerGamePowerHooks();
  startGameLimiter();

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });
});

app.on('before-quit', () => {
  if (intervalTimer) clearTimeout(intervalTimer);
  if (breakTimer) clearTimeout(breakTimer);
  if (tooltipInterval) clearInterval(tooltipInterval);
  clearSleepModeTimers();
  stopGameLimiter();
});
