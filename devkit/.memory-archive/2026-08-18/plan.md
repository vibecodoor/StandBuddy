# Plan — Game Limiter (StandBuddy)

Goal: limit gaming to a daily budget (default 4h). Detect foreground game process,
accrue daily game time, warn at 30 & 5 min remaining (non-blocking corner toast + sound),
then `taskkill /f` the game at the limit and re-kill any relaunch the same day.
Hard limit, no emergency bypass; only way out is disabling the feature in Settings.

## Locked decisions (from interview)
- Detection: persistent hidden PowerShell helper reading the FOREGROUND window process
  (no native deps, no visible windows/console). User-defined list of `*.exe`.
- Polling: adaptive — 10 min while idle, 1 min during an active game session.
- Warnings/kill fired via precise `setTimeout` (Sleep Mode pattern), not by poll granularity.
- Budget: single shared budget across all listed games, default 4h, configurable.
- Daily reset: via existing `getTodayDateString()` (new day = new stats key).
- Warnings at 30 & 5 min: frameless transparent always-on-top click-through corner window,
  themed via `themes.css`, + sound. Visible only in borderless; in exclusive fullscreen only
  the sound is heard (overlay over true-fullscreen impossible without injection — out of scope).
- At limit: `taskkill /f /im <game>` then short fullscreen block overlay (break.html pattern).
- After limit reached today: any relaunch of a listed game → immediate kill + overlay.
- Storage: config (list, limit, enabled) in settings.json; daily `gameMinutes` in stats.json.
- Tray tooltip gains a line: `Game time today: Xh Ym / 4h`.

## Data model
settings.json defaultSettings += `gameLimiterEnabled:false`, `gameLimitHours:4`, `gameList:[]`
stats.json day aggregate += `gameMinutes:0`
Runtime: `gameSessionStart`, `currentGameProcess`, `gameTimers[]`, `gameLimitReachedToday`,
plus a today-key guard to reset `gameLimitReachedToday` on day change.

## Files
New: game-monitor.js, game-warning.html, game-blocked.html, (optional assets/warning sound)
Edit: main.js, settings.html, package.json (build.files), preload.js (if new IPC channels)

## Work stages (commit per stage)
1. [DONE] Data model + load/save (settings + stats).
2. [DONE] game-monitor.js + detection (verified live: foreground reads, no windows, no load).
3. [DONE] Accrual logic + timers + enforcement (execFile taskkill). Stubs for windows.
   Live e2e deferred to stage 8 (needs interactive GUI foreground).
4. [DONE] game-warning.html (corner toast, click-through, Web Audio chime) + showGameWarning.
5. [DONE] game-blocked.html (fullscreen block overlay) + showGameBlockedWindow.
6. [DONE] Settings section + .exe picker (game-pick-exe handler) + restart limiter on save.
7. [DONE] Tray tooltip line (in stage 3).
8. [PARTIAL] package.json files (game-monitor.js added). Boot smoke test: app starts clean.
   Full e2e of new code NOT verified — local electron dev binary is broken
   ("Electron failed to install correctly"), and packaged StandBuddy.exe loads its embedded
   old app.asar (ignores source path arg). game-monitor.js verified live standalone (stage 2).

## Verification status (honest)
- node --check passes on main.js + game-monitor.js.
- Electron dev binary FIXED via `node node_modules/electron/install.js` (npm install said
  "up to date" and skipped the download; running the install script directly fixed it).
- App boots OUR source cleanly via `npx electron .`: logs "game-limiter: started", no JS errors.
- Detection pipeline PROVEN: GL_DEBUG run showed foreground correctly read (="claude", the
  actually-focused window). game-monitor.js also verified standalone in stage 2.
- Kill mechanism PROVEN: execFile('taskkill',['/f','/im','notepad.exe']) (exact copy of
  killGame, same regex guard) closed both notepad instances.
- NOT auto-verifiable here: the live focus-triggered full loop (real game becomes foreground
  -> accrue -> warnings -> kill), because OS window focus can't be driven from this automation
  (the test process never becomes the foreground window). This is the user's interactive check.

## Manual acceptance test (for user, once electron runs)
1. `npm install` to restore the electron binary, then `npm start`.
2. Settings -> Game Limiter ON, Daily limit 0.05 (3 min), Add game -> pick notepad.exe, Save.
3. Open Notepad, keep it focused. Tooltip should show "Game time today: ..".
4. ~2.5 min: corner warning toast + chime. At 3 min: Notepad closes (taskkill) + block overlay.
5. Reopen Notepad same day -> closed immediately. Disable feature to stop.

## Open (decide during impl, non-blocking)
- Helper interval switch: stdin command vs main-side setInterval.
- Sound: asset file vs shell.beep.
- Overlay copy/texts.
