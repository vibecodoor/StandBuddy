# StandBuddy — Decisions

<!-- DEV MEMORY KIT · append-only history. Lazy: read when "why did we…?".
     Supersede, never rewrite: to change a decision, set the old one's Status to
     "superseded YYYY-MM-DD → <new title>" and add a new entry on top. Newest first. -->

<!-- Dates below are the migration date; these were made during the v1.0.5 Game Limiter
     work and recovered from the pre-kit plan.md (archived in .memory-archive/). -->

### 2026-08-18 — Every window is created hidden and revealed on first paint

- **Decision:** all `BrowserWindow`s use `show: false` + a themed `backgroundColor`, are revealed
  from `ready-to-show` via the shared `revealWhenPainted()` helper (1.5s safety timeout), and get
  their IPC payload on `dom-ready` rather than `did-finish-load`.
- **Why:** `did-finish-load` waits on subresources, so the remote font request delayed content and
  the default-white unpainted window reached the screen first. Cost: an overlay can now be at most
  1.5s late in a pathological stall instead of appearing instantly-but-blank.
- **Status:** active

### 2026-08-18 — Web fonts must never block first paint

- **Decision:** the Google Fonts `<link>` in every window loads as
  `media="print" onload="this.media='all'"`; text renders immediately in the fallback and the
  webfont swaps in when it arrives.
- **Why:** a render-blocking network request sat on the critical path of the core loop — offline
  or on slow DNS the break overlay stalled. Interim fix only: the request still leaves the device
  on every break, which contradicts the offline invariant. Bundling the woff2 files locally is the
  real fix and is queued in STATE.
- **Status:** active

### 2026-08-18 — Kill games via an elevated scheduled task, not direct `taskkill`

- **Decision:** register a one-off Windows scheduled task `StandBuddy-KillGame`
  (`RunLevel=HighestAvailable`, **no trigger**) when the user enables the limiter; to kill,
  write the target exe to `kill-target.txt` in `userData` and run `schtasks /run`.
- **Why:** anti-cheat/elevated games (Apex Legends under EAC) reject `taskkill` from the app's
  non-elevated process with "Access denied". Costs one UAC prompt at enable time; buys silent
  kills afterwards. The task script validates the target against `gameList`, so it can never
  kill an arbitrary process. Falls back to direct non-elevated `taskkill` if the task is absent.
- **Status:** active
- **Supersedes:** "kill with `execFile('taskkill', ...)`" (the original plan.md decision)

### 2026-08-18 — Foreground detection via a hidden PowerShell helper

- **Decision:** `game-monitor.js` keeps one persistent, hidden PowerShell process that reports
  the foreground window's process name over stdio. No native modules, no visible console.
- **Why:** preserves the zero-runtime-dep and no-native-rebuild invariants. Cost: Windows-only.
- **Status:** active

### 2026-08-18 — Adaptive polling, with fast polling retained past the limit

- **Decision:** poll every 10 min while idle, every 1 min during an active game session — and
  stay at 1 min after the daily limit is hit.
- **Why:** cheap while nothing is running; without the post-limit fast cadence a relaunch could
  run up to ~10 min before being closed. Warnings/kills fire on precise `setTimeout`s scheduled
  at session start, so accuracy never depends on poll granularity.
- **Status:** active

### 2026-08-18 — One shared game budget, no emergency bypass

- **Decision:** a single daily budget (default 4h) shared across every listed game; the only way
  out is disabling the feature in Settings. Deliberately unlike breaks, which have a 5-second-hold escape.
- **Why:** per-game budgets are gameable by switching titles; a bypass button makes the limit advisory.
- **Status:** active

### 2026-08-18 — Time accrual is crash-safe and sleep-aware

- **Decision:** accrue in memory, flush `gameMinutes` into the `stats.json` day aggregate on every
  active poll and on session end, limit enforcement, system suspend, and app quit. On `powerMonitor`
  suspend, flush and reset the session baseline; resume starts a fresh baseline.
- **Why:** a crash or a machine left asleep with a game focused would otherwise lose or burn the
  whole budget. Daily reset reuses the existing `getTodayDateString()` key — no new scheduler.
- **Status:** active

### 2026-08-18 — All state stays in local files under `userData`

- **Decision:** config in `settings.json`, daily aggregates in `stats.json`. No server, no accounts, no sync.
- **Why:** the product promise is offline and private; it also keeps the app dependency-free.
- **Status:** active

### 2026-01-06 — Used-day streak semantics

- **Decision:** a day counts as *used* once any break event is recorded; unused days are skipped
  rather than breaking the streak, but a used day with zero completed breaks does break it.
- **Why:** not opening the laptop isn't a failure; ignoring every break is.
- **Status:** active
