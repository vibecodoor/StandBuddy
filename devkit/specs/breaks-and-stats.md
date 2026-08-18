---
status: done
created: 2026-01-06
---
# Breaks, Tray & Stats (v1.0.2)

> Load when: working on break scheduling, the break overlay, tray UX, tips, or the stats/achievements window.
<!-- applies-to: break.html, stats.html, tips.json, main.js (timer/tray/stats sections) -->

## Description

The core product: a tray-resident timer that shows a full-screen break overlay on an interval,
and a local stats window that scores the habit.
Core requirement: "The system MUST block interaction for the break duration, and MUST NOT count
an emergency dismissal as a completed break."

## Break scheduling

- Reminder interval and break duration selectable from presets or manual input.
- Default preset intervals: **30, 35, 40, 45, 50, 60** minutes.

## Break overlay

- Blocks keyboard input and regular interaction; mouse movement/click stays allowed.
- Shows **one tip per break**, from `tips.json` (English), random or sequential.
- Emergency override: hold the mouse button **5 seconds** to dismiss.
  - Does **not** count as a completed break.
  - Anti-bypass: only a continuous 5-second hold of the **same** button dismisses; other buttons must not.
  - Right-click context menu is suppressed on the overlay.

## Tray UX

- Right-click menu stays minimal: Pause/Resume · Settings · Stats · Quit.
- Hover tooltip shows live status (multi-line where the OS supports it): app name · next-break
  countdown (ticks live) · today's completed breaks · active streak. Game Limiter adds one line
  when enabled (see [game-limiter.md](game-limiter.md)).

## Stats & achievements

- Today: **Completed / Emergency / Shown / Break Minutes**.
- Active streak: consecutive **used** days with ≥1 completed break.
- Last 7 days: completed breaks per day. Achievements: **16 total**, 4×4.
- Stored locally in `stats.json` (no cloud, no accounts). Day aggregate:
  `completed`, `emergency`, `shown`, `breakMinutes`, `usedDays`.

### Used-day + streak rules

- A day becomes **used** when any break event is recorded (shown / completed / emergency).
- Unused days are ignored — they do not break the streak.
- A used day with **0 completed** breaks **does** break the streak.

### Reset stats

- "Reset stats…" behind a confirmation; clears `stats.json`, resets UI and achievements to empty.
- Does not mark today as used — the first break event after the reset does that.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 **Interval fires:** Given an interval of N minutes, When N elapses, Then the overlay appears with exactly one tip.
- [x] #2 **Emergency is not a completion:** Given the overlay is up, When the user holds one button for 5s, Then it closes and `emergency` (not `completed`) increments.
- [x] #3 **Anti-bypass:** Given a 5s hold, When the user switches buttons mid-hold, Then the overlay does not dismiss.
- [x] #4 **Streak skips unused days:** Given a gap of days with no break events, When the app is used again, Then the streak continues rather than resetting.
- [x] #5 **Streak breaks on a used day:** Given a day with events but 0 completed, Then the streak resets.
<!-- AC:END -->

## Notes

Shipped in v1.0.2. Tips live in `tips.json` and are English-only by decision.
