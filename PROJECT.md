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
