---
status: in-progress
created: 2026-08-18
---
# Game Limiter (v1.0.5)

> Load when: working on game-time detection, the daily gaming budget, warnings, enforcement, the Steam picker, or auto-pausing reminders during games.
<!-- applies-to: game-monitor.js, steam-scan.js, game-warning.html, game-blocked.html, main.js (game limiter section), settings.html -->

## Description

A daily gaming budget: detect when a listed game is the **active** window, accrue play time,
warn ahead of the limit, then close the game when the budget runs out and re-close any relaunch
the same day.
Core requirement: "The system MUST close a listed game once the shared daily budget is spent, and
MUST NOT offer any bypass short of disabling the feature in Settings."

## Configuration (Settings)

- **Game Limiter toggle**. **Daily limit** in hours (default **4**, min 0.5, configurable).
- **Games list** — user-defined executables (e.g. `cs2.exe`), stored as lowercase basenames:
  - added via an `.exe` picker (`dialog.showOpenDialog`), or
  - via **"Scan Steam games"**, which suggests installed titles in a checklist with the main
    executable auto-picked per game.
  - **Friendly names**: the list shows a display name (`Apex Legends`) when known, exe as tooltip.
    Steam scan supplies names; manually picked exes have none. Detection always matches on the exe.
  - The budget is **shared** across all listed games, never per-game.
- `settings.json` keys: `gameLimiterEnabled`, `gameLimitHours`, `gameList`, `gameNames`
  (display-only exe→name map, pruned to `gameList`), `gamePauseList` (see below).
- `stats.json` day aggregate gains `gameMinutes`; resets at midnight via the existing date-key logic.

## Detection

- `game-monitor.js` keeps a hidden persistent PowerShell process reporting the **foreground**
  window's process name over stdio — no native modules, no visible window or console.
- **Adaptive polling**: every 10 min while idle, every 1 min during an active session, and it
  stays at 1 min after the limit is reached so a relaunch dies within ~1 min.
- Only the actively-focused game accrues — alt-tabbing pauses it.
- **Sleep-aware**: `powerMonitor` suspend flushes accrued time and resets the session baseline,
  so a sleeping machine with a game focused doesn't burn the budget.
- **Crash-safe**: time is flushed to `stats.json` on each active poll, session end, enforcement,
  suspend, and quit.
- **Restart-safe**: a Settings save restarts the limiter; a stale exit event from the old
  PowerShell process must not kill the new one (see [../JOURNAL.md](../JOURNAL.md)).

## Warnings (non-blocking)

- Corner toasts at **30 min** and **5 min** of remaining game time.
- Small, frameless, transparent, always-on-top, **click-through** — never blocks the game.
  Themed via `themes.css`, plays a short Web Audio chime, auto-dismisses after a few seconds.
- Fired by `setTimeout` scheduled at session start, so timing is independent of the poll interval.

## Enforcement (at the limit)

- Closes the game through the elevated, trigger-less scheduled task `StandBuddy-KillGame`
  running `taskkill /f /im <game>.exe`. Registered once (one UAC prompt) when the feature is
  enabled. To kill: write the target to `kill-target.txt` in `userData`, then `schtasks /run`.
  The task's script validates the target **against `gameList`** — it can only kill a listed game.
  Falls back to a direct non-elevated `taskkill` if the task is absent (UAC declined); failures
  are logged, not silently retried. Rationale: [../DECISIONS.md](../DECISIONS.md).
- Shows a short full-screen "Game Limit Reached" overlay, then auto-closes.
- **No emergency bypass** — only disabling the feature in Settings lifts it.

## Pause reminders during games

- Per-game opt-in checkbox in the games list. While a flagged game is foreground, break reminders
  are **fully paused** (timer stops) and resume when the session ends; the tray shows `Paused (gaming)`.
- A manual tray Pause/Resume overrides the auto-pause. Stored as `gamePauseList`, pruned to `gameList`.
- Only active while the Game Limiter is enabled (shares its games list).

## Steam discovery

`steam-scan.js` locates Steam (registry `HKCU\Software\Valve\Steam\SteamPath`, then default paths),
parses `libraryfolders.vdf` for every library drive, reads each `appmanifest_*.acf` for the game
name + install dir, then scans `common\<installdir>` for `.exe` files and auto-picks the likeliest
(name similarity + file size + root-level location; redistributables, launchers, crash handlers and
non-game apps filtered out). Best-effort — returns `[]` on any failure; the manual picker is the
fallback. Steam only (no Epic/GOG).

## Tray

Tooltip gains one line when enabled: `Game time today: Xh Ym / 4h`.

## Platform & limitations

- **Windows only** (PowerShell foreground detection, `taskkill`, `schtasks`).
- Active only while the app runs.
- Corner warnings are visible over **borderless/windowed** games only. In true exclusive
  fullscreen the OS blocks external overlays (injection is out of scope) — only the chime is
  heard, but tracking and the kill still work in every mode.

## Files

- `game-monitor.js` — hidden PowerShell foreground helper.
- `steam-scan.js` — Steam library + executable discovery.
- `game-warning.html` — non-blocking corner toast. `game-blocked.html` — full-screen limit overlay.
- Runtime artifacts in `userData` (not source): `kill-game.ps1`, `kill-task.xml`, `kill-target.txt`.

## Acceptance Criteria

<!-- AC:BEGIN — the manual run: Settings → Game Limiter ON, Daily limit 0.05 (3 min), Add game → notepad.exe, Save -->
- [ ] #1 **Accrual:** Given Notepad is listed and focused, When ~1 min passes, Then the tray tooltip shows growing `Game time today`.
- [ ] #2 **Warning:** Given the 3-min limit, When ~2.5 min of focus have accrued, Then the corner toast + chime fire and the toast does not block clicks.
- [ ] #3 **Enforcement:** Given the limit is reached, Then Notepad closes and the block overlay appears, then auto-closes.
- [ ] #4 **Relaunch:** Given the limit was hit today, When Notepad is reopened, Then it is closed within ~1 min.
- [ ] #5 **Release:** Given the feature is disabled in Settings, Then the game stays open.
- [ ] #6 **Elevated kill:** Given an EAC-protected game (Apex Legends) at the limit, Then the scheduled-task kill closes it. <!-- the case that motivated the design; never verified live -->
- [x] #7 **Detection proven:** foreground process name read correctly under `GL_DEBUG`.
- [x] #8 **Kill mechanism proven:** the `killGame` code path closed both running notepad instances.
- [x] #9 **Boots clean:** `npx electron .` logs `game-limiter: started`, no JS errors; `node --check` passes.
<!-- AC:END -->

## Notes

Written across 8 stages; stages 1–7 complete, stage 8 (packaging + e2e) partial. #1–#6 need a
human at the keyboard — OS window focus can't be driven from automation, which is exactly why
this stalled. Do not treat "notepad dies" as proof for #6: see [../JOURNAL.md](../JOURNAL.md).
Still uncommitted as of 2026-08-18.
