StandBuddy is a small desktop tray (system tray / menu bar) app that reminds users to stand up and take a short break at a chosen interval.  
Primary target: Windows. Secondary target: macOS build parity.

---

## 1) Product Summary

**What it is:**  
A lightweight tray app that runs silently in the background and periodically shows a full-screen break overlay to encourage movement.

**Core promise:**  
“Every X minutes, it nudges you to stand and blocks interaction for Y seconds (except mouse movement/click), with an emergency unlock option.”

**Primary user flow (Windows):**
1. User launches app → it lives in the tray.
2. User sets:
   - Reminder interval (minutes)
   - Break duration (seconds/minutes)
3. Every interval → break overlay appears with a single tip.
4. User completes break → overlay closes, stats update.

---

## 2) Core Features (v1.0.x)

### A) Break scheduling
- Reminder interval selectable from presets and/or manual input.
- Break duration selectable from presets and/or manual input.
- Default preset intervals: **30, 35, 40, 45, 50, 60** minutes.

### B) Break overlay
- Blocks keyboard input and regular interaction during the break.
- Allows mouse movement/click (basic interaction allowed).
- Shows **one tip per break**.
- Emergency override:
  - Hold mouse button for **5 seconds** to dismiss.
  - Emergency dismiss **does NOT count** as a completed break.
  - Anti-bypass: only a continuous 5-second hold of the **same** button can dismiss (other buttons must not dismiss).
  - Prevent right-click context menu on the overlay.

### C) Tray UX
- Right-click tray menu stays minimal:
  - Pause/Resume
  - Settings
  - Stats
  - Quit
- Tooltip on hover shows live status (multi-line if OS supports it):
  - App name
  - Next break countdown (ticks live)
  - Today completed breaks
  - Active streak (ignores days when app wasn’t used)

### D) Tips content
- Tips are in **English**.
- Stored in `tips.json`.
- Displayed randomly or sequentially (implementation choice), always **one tip per break**.

---

## 3) Stats & Achievements (v1.0.2+)

### A) Stats window (tray → Stats)
Shows:
- Today: **Completed / Emergency / Shown / Break Minutes**
- Active streak: consecutive **used** days with ≥ 1 completed break
- Last 7 days: completed breaks per day
- Achievements: **16 total** (4×4)

### B) Local storage (offline)
- Stored locally in `stats.json` (no cloud, no accounts).
- Daily aggregates include: `completed`, `emergency`, `shown`, `breakMinutes`, `usedDays`.

### C) Used-day + streak rules
- A day becomes **used** when any break event is recorded (shown/completed/emergency).
- Days when the app wasn’t used are ignored (they do not break streak).
- A used day with **0 completed breaks** breaks the streak.

### D) Reset stats
- "Reset stats…" with confirmation.
- Clears `stats.json` and resets UI/achievements to empty state.
- Does not auto-mark today as used; the first break event after reset will mark today as used.

---

## 4) Sleep Mode (v1.0.4+)

A bedtime enforcement feature that helps users maintain a consistent sleep schedule by shutting down the computer at a set time.

### A) Configuration (Settings)
- **Sleep Mode toggle**: Enable/disable the feature.
- **Bedtime picker**: Set daily bedtime (same time every day, e.g., "22:00").
- Settings persist in `settings.json`.

### B) Pre-bedtime warnings
Full-screen warnings appear at:
- **30 minutes** before bedtime
- **15 minutes** before bedtime
- **5 minutes** before bedtime

Warning behavior:
- Shows for **5 seconds**, then auto-closes.
- Cannot be dismissed early (forces user to see it).
- Displays remaining time until bedtime.

### C) Shutdown prompt (at bedtime)
- Full-screen prompt with 30-second countdown.
- **Snooze button**: Delays shutdown by 5 minutes.
  - Maximum **3 snoozes** allowed.
  - Shows remaining snooze count.
- **Shut Down Now** button: Immediate shutdown.
- After countdown expires or snoozes exhausted → executes `shutdown /s /t 0`.

### D) Platform support
- **Windows only** (uses Windows shutdown command).
- Only active when app is running (no background service).

### E) Files
- `sleep-warning.html`: Pre-bedtime warning overlay.
- `shutdown-prompt.html`: Bedtime shutdown prompt with snooze.

---

## 5) Themes (v1.0.4+)

A color theme system that applies consistently across all app windows.

### A) Available themes
Six palettes, each with light mode (settings, stats) and dark mode (overlays) variants:

| Theme | Accent Color | Vibe |
|-------|--------------|------|
| **Warm** (default) | Golden amber | Cozy, inviting |
| **Ocean** | Soft blue | Calm, professional |
| **Forest** | Sage green | Natural, refreshing |
| **Lavender** | Soft purple | Soothing, modern |
| **Slate** | Cool gray | Minimal, focused |
| **Rose** | Dusty pink | Gentle, friendly |

### B) Configuration
- **Theme picker**: Located at the top of Settings window.
- **Visual selector**: 6 colored circles showing each theme's accent.
- **Live preview**: Theme applies immediately on click (before saving).
- **Persistence**: Selected theme saved in `settings.json`.

### C) Scope
Theme applies to all windows:
- Settings window (light mode)
- Stats window (light mode)
- Break overlay (dark mode)
- Sleep warning overlay (dark mode)
- Shutdown prompt overlay (dark mode)

### D) Architecture
- `themes.css`: Centralized theme definitions with CSS variables.
- Each HTML file links to `themes.css` and applies theme via class on `<html>`.
- Main process sends theme to all windows via IPC on load.

---

## 6) Game Limiter (v1.0.5+)

A daily gaming time budget that detects when a listed game is the active window,
accrues play time, warns ahead of the limit, then closes the game when the budget runs out.

### A) Configuration (Settings)
- **Game Limiter toggle**: Enable/disable the feature.
- **Daily limit**: Total hours allowed per day (default **4h**, configurable, min 0.5h).
- **Games list**: User-defined list of game executables (e.g., `cs2.exe`).
  - Added via an `.exe` file picker (`dialog.showOpenDialog`); stored as lowercase basenames.
  - Alternatively, **"Scan Steam games"** detects installed Steam titles and
    suggests them in a checklist; the main executable is auto-picked per game
    (best-guess by name/size, with redistributables and crash handlers excluded).
  - **Friendly names**: the list shows the game's display name (e.g. `Apex Legends`)
    instead of the exe when one is known; the exe is shown as a hover tooltip. Steam
    scan supplies the name automatically; entries added via the manual `.exe` picker
    show the exe (no name source). Detection/enforcement always match on the exe.
  - Single **shared** budget across all listed games (not per-game).
- Settings persist in `settings.json` (`gameLimiterEnabled`, `gameLimitHours`,
  `gameList`, `gameNames`). `gameNames` is a display-only map of exe → friendly name,
  pruned to entries still in `gameList`.

### B) Detection
- A hidden, persistent PowerShell helper (`game-monitor.js`) reports the **foreground**
  window's process name via stdio — no native modules, no visible windows/console.
- **Adaptive polling**: every 10 min while idle, every 1 min during an active game session.
  After the daily limit is reached, polling stays at the 1-min cadence so a relaunch
  is detected and closed within ~1 min (previously it could run up to ~10 min).
- Counts only the actively-focused game (alt-tabbing away pauses accrual).
- **Sleep-aware**: OS sleep/suspend is not counted as play time — accrued time is
  flushed when the system suspends and the session baseline is reset on resume
  (`powerMonitor`), so a machine left asleep with a game focused doesn't burn the budget.
- Daily total stored as `gameMinutes` in `stats.json` day aggregate; resets at midnight
  via the existing date-key logic.
- **Crash-safe persistence**: play time is accrued in memory and flushed to `stats.json`
  on each active poll and on session end, limit enforcement, system sleep, and app quit.
- **Restart-safe helper**: the foreground monitor survives a Settings save (which restarts
  the limiter) — a stale exit event from the old PowerShell process no longer kills the
  freshly spawned one.

### C) Warnings (non-blocking)
Corner toast overlays appear at:
- **30 minutes** of game time remaining
- **5 minutes** remaining

Warning behavior:
- Small, frameless, transparent, always-on-top, **click-through** window (never blocks the game).
- Themed via `themes.css`; plays a short chime (Web Audio).
- Auto-dismisses after a few seconds.
- Precise timing via `setTimeout` (scheduled at session start), independent of poll interval.

### D) Enforcement (at the limit)
- Closes the game via an **elevated, on-demand Windows Scheduled Task**
  (`StandBuddy-KillGame`) that runs `taskkill /f /im <game>.exe`. Elevation is
  required because anti-cheat/elevated games (e.g. **Apex Legends** under EAC)
  reject `taskkill` from the app's non-elevated process ("Access denied").
  - The task is registered once (one UAC prompt) when the user enables the feature,
    with `RunLevel=HighestAvailable` and **no trigger** (it never fires on its own).
  - To kill, the app writes the target exe to `kill-target.txt` (in `userData`) and
    runs `schtasks /run` — silent, no per-kill UAC. The task's script validates the
    target and **cross-checks it against `gameList`**, so it can only ever kill a
    listed game, not an arbitrary process.
  - Falls back to a direct (non-elevated) `taskkill` if the task is absent (e.g. UAC
    declined); failures are logged instead of silently retried.
- Shows a short full-screen block overlay ("Game Limit Reached"), then auto-closes.
- **No emergency bypass** — while enabled, the limit can only be lifted by disabling
  the feature in Settings.
- Any **relaunch** of a listed game the same day is closed within ~1 min (fast polling
  continues after the limit is hit — see Detection).

### E) Platform & limitations
- **Windows only** (PowerShell foreground detection + `taskkill`).
- Only active while the app is running.
- Corner warnings are visible only over **borderless/windowed** games. In true
  **exclusive fullscreen**, the OS blocks external overlays (injection is out of scope),
  so only the chime is heard — but time tracking and the kill still work in any mode.

### F) Steam game discovery
- `steam-scan.js` locates Steam (registry `HKCU\Software\Valve\Steam\SteamPath`,
  then default paths), parses `libraryfolders.vdf` for all library drives, and
  reads each `appmanifest_*.acf` for the game name + install dir.
- For each game it scans `common\<installdir>` for `.exe` files and auto-picks the
  most likely one (name similarity + file size + root-level location; known
  redistributable/launcher/crash-handler exes and non-game apps are filtered).
- Best-effort: returns `[]` on any failure; the manual `.exe` picker remains the
  fallback. Steam-only (Epic/GOG/etc. not covered).

### G) Tray
- Tooltip gains a line when enabled: `Game time today: Xh Ym / 4h`.

### H) Files
- `game-monitor.js`: hidden PowerShell foreground-detection helper.
- `steam-scan.js`: Steam library + game-executable discovery for the games picker.
- `game-warning.html`: non-blocking corner warning toast.
- `game-blocked.html`: full-screen limit-reached overlay.
- Runtime artifacts (written to `userData`, not source): `kill-game.ps1` (elevated
  kill helper), `kill-task.xml` (Scheduled Task definition), `kill-target.txt`
  (current kill target, validated against `gameList`).

### I) Pause reminders during games (v1.0.5+)
- Per-game opt-in checkbox in the games list ("Pause reminders").
- When a flagged game is the foreground app, break reminders are **fully paused**
  (timer stops) and resume when the game session ends. Tray shows `Paused (gaming)`.
- A manual tray Pause/Resume overrides the auto-pause. Stored in `settings.json`
  as `gamePauseList` (pruned to exes still in `gameList`).
- Only active while Game Limiter is enabled (shares its games list).
