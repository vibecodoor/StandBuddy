---
status: done
created: 2026-02-01
---
# Sleep Mode & Themes (v1.0.4)

> Load when: working on bedtime enforcement / shutdown, or on theming and window styling.
<!-- applies-to: sleep-warning.html, shutdown-prompt.html, themes.css, main.js (sleep mode section) -->

## Sleep Mode

Bedtime enforcement: warn ahead of a fixed daily bedtime, then shut the computer down.
Core requirement: "The system MUST show the pre-bedtime warnings undismissable, and MUST allow
at most 3 snoozes before shutting down."

### Configuration (Settings)

- Sleep Mode toggle; bedtime picker (same time every day, e.g. `22:00`). Persisted in `settings.json`.

### Pre-bedtime warnings

- Full-screen, at **30 / 15 / 5** minutes before bedtime.
- Shows for **5 seconds** then auto-closes; cannot be dismissed early. Displays time remaining.

### Shutdown prompt (at bedtime)

- Full-screen with a 30-second countdown.
- **Snooze**: +5 minutes, max **3** snoozes, remaining count shown.
- **Shut Down Now**: immediate. On countdown expiry or exhausted snoozes → `shutdown /s /t 0`.

### Platform

Windows only (Windows shutdown command). Active only while the app is running — no background service.

### Files

`sleep-warning.html` (pre-bedtime overlay) · `shutdown-prompt.html` (countdown + snooze).

## Themes

Six palettes, each with a light variant (settings, stats) and a dark variant (overlays):

| Theme | Accent | Vibe |
|---|---|---|
| **Warm** (default) | Golden amber | Cozy |
| **Ocean** | Soft blue | Calm, professional |
| **Forest** | Sage green | Natural |
| **Lavender** | Soft purple | Soothing |
| **Slate** | Cool gray | Minimal |
| **Rose** | Dusty pink | Gentle |

- Picker sits at the top of Settings: 6 colored circles, applied **live** on click before saving,
  persisted in `settings.json`.
- Applies to every window: settings + stats (light), break / sleep-warning / shutdown-prompt (dark).
- Architecture: `themes.css` holds all definitions as CSS variables; each HTML file links it and
  applies the theme as a class on `<html>`; main sends the theme to every window over IPC on load.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 **Warnings fire:** Given a bedtime of T, Then full-screen warnings appear at T-30, T-15, T-5 and auto-close after 5s.
- [x] #2 **Warnings are undismissable:** Given a warning is up, When the user clicks or presses keys, Then it stays for its full 5s.
- [x] #3 **Snooze cap:** Given 3 snoozes used, When the countdown expires, Then the machine shuts down with no further snooze offered.
- [x] #4 **Live theme preview:** Given Settings is open, When a theme circle is clicked, Then the UI restyles immediately without saving.
- [x] #5 **Theme propagates:** Given a saved theme, When any window opens, Then it renders in that theme's correct light/dark variant.
<!-- AC:END -->

## Notes

Shipped in v1.0.4 (`22f4489`). New windows must link `themes.css` and accept the IPC theme message
or they will render unthemed — see the Invariants in [../PROJECT.md](../PROJECT.md).
