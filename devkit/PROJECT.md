# StandBuddy — Project Control Plane

<!-- DEV MEMORY KIT · self-contained, no external deps · drop into any repo.
     This file is the spine AND the kit's own manual (see ## Dev Memory Protocol, bottom).
     Stable content only. Volatile state → STATE.md. History → DECISIONS.md.
     Smallest complete map to understand, continue, and verify this project. ~5-min read.
     Soft budget ≤150 lines. Order: stable → volatile. Supersede, don't append. -->

## Project Card

| Field | Value |
|---|---|
| Status | active |
| Started | 2026-01-06 |
| Owner | vibecodoor |
| Type | code — Electron desktop app |
| Stack | Electron 35, plain JS (no framework), self-contained HTML windows, electron-builder; zero runtime deps |
| Source of truth | git for source; user data in Electron `userData` (`settings.json`, `stats.json`) |

## What This Is

A Windows tray app that interrupts you on purpose: a full-screen break overlay every N minutes,
a bedtime enforcer that shuts the machine down, and a daily gaming budget that closes the game
when it runs out. Everything is local — no cloud, no accounts, no telemetry.

## Core Value

The interruption has to be hard to ignore — escapable only by a deliberate 5-second hold, or not at all.

## User & Problem

| Field | Answer |
|---|---|
| Primary user | Solo Windows desktop worker/gamer who sits too long and stays up too late (author, dogfooding) |
| Pain | Soft reminders get dismissed reflexively; ordinary timers suggest, they don't enforce |
| Trigger | Gaming and bedtime overruns were the concrete failures worth hard-stopping <!-- TODO: confirm --> |

## Core Loop

```text
interval elapses -> fullscreen overlay + one tip -> user stands (or 5s-hold emergency skip)
  -> stats.json day aggregate updated -> tray tooltip / streak reflect it -> next interval
```

## Scope

### Validated

- [x] Break scheduling, overlay, tray UX, tips — v1.0.2
- [x] Stats, used-day streak rules, 16 achievements, local `stats.json` — v1.0.2
- [x] Sleep Mode: 30/15/5-min warnings + shutdown prompt with ≤3 snoozes — v1.0.4 (`22f4489`)
- [x] Themes: 6 palettes across all windows via `themes.css` — v1.0.4 (`22f4489`)
- [x] Game Limiter: Steam scan, shared daily budget, elevated kill, reminder auto-pause — v1.0.5
- [x] Flash-free overlays: hidden until painted, content before first paint — v1.0.5, verified live

### Active

- [ ] Game Limiter (v1.0.5) — shipped, but the live focus-triggered end-to-end run still has
      not happened (released on the owner's call). See [STATE.md](STATE.md).
- [ ] Bundle the web fonts locally — overlays still fetch them from Google on every break,
      which contradicts the offline invariant below.

### Out of Scope

- macOS parity — original secondary target, but Sleep Mode and Game Limiter are Windows-only
  by construction (`shutdown`, PowerShell foreground, `taskkill`) <!-- TODO: confirm -->
- Cloud sync / accounts — all data stays on device by design
- Overlays over exclusive-fullscreen games — needs injection; the chime is the fallback

## Memory Map & Routing

> The dev-memory surfaces and when to read each. Precedence for "what do I do now": **STATE > DECISIONS > PROJECT**.
> Read only the surface whose trigger matches the task — not all of them. If one is already in context, reuse it; don't re-read.

| Surface | Holds | Load when |
|---|---|---|
| `PROJECT.md` (this) | why / scope / architecture / invariants — the stable spine | always (you're in it) |
| `STATE.md` | current task · next · blockers — the live cursor | resuming work / "where was I?" |
| `DECISIONS.md` | append-only decisions + rationale | "why did we…?" / revisiting a choice |
| `JOURNAL.md` | problem → dead-end → fix → lesson | "have we hit this before?" / a recurring bug |
| `specs/<slug>.md` | per-feature spec + acceptance criteria | working that feature (match its `> Load when:`) |
| `main.js` | the whole main process — timers, tray, IPC, every window, sleep mode, game limiter (~1.5k lines) | **start here** for any behavior change |
| `*.html` (repo root) | one file per window, self-contained inline CSS/JS, each links `themes.css` | UI work on that window |
| `game-monitor.js` · `steam-scan.js` | detached helpers: PowerShell foreground reader; Steam library/exe discovery | game limiter work |
| `scripts/set-icon.js` | post-build rcedit icon fix, runs after `npm run dist:zip` | packaging / release |

## Invariants

- Never: add an npm dependency without explicit approval — the shipped app has **zero runtime deps**.
- Never: send user data off-device — no accounts, no telemetry; `settings.json` / `stats.json` stay in `userData`.
- Never: kill an arbitrary process — the elevated helper cross-checks its target against `gameList` first.
- Never: native modules — Windows integration goes through child processes (`powershell`, `schtasks`,
  `shutdown`, `taskkill`) so the app stays rebuild-free across Electron versions.
- Required: every new window links `themes.css` and receives its theme from main over IPC on load.
- Required: every new window is created with `show: false` + `backgroundColor` and revealed via
  `revealWhenPainted()`; send its payload on `dom-ready`, never `did-finish-load`.
- Required: every new root source file is added to `package.json` → `build.files`, or it won't ship in the zip.
- Security: the elevated `StandBuddy-KillGame` scheduled task is registered once with no trigger; it never fires on its own.

## Canonical References

| File / Link | What it decides | Load when |
|---|---|---|
| `README.md` | the user-facing feature list + install steps | editing public docs / releasing |
| `.claude/CLAUDE.md` | agent behavior rules (npm approval gate, UX principles) — not project memory | always (auto-loaded) |
| `devkit/.memory-archive/` | pre-kit originals (old `PROJECT.md`, `plan.md`) | verifying nothing was lost in migration |

<!-- Volatile sections last: State + Decisions digest are the only parts that churn — keeping them
     at the bottom means their changes don't bust the cache of the stable spine above. -->

## State

> Current task, next action, blockers → **[STATE.md](STATE.md)**.
> Headline: Game Limiter (v1.0.5) is written and boots clean; the live game→accrue→warn→kill
> loop is unverified and needs an interactive run on the user's machine.

## Decisions

> Full history → **[DECISIONS.md](DECISIONS.md)** (append-only; supersede, don't rewrite).
> Active digest:
> - Game kills go through an elevated **scheduled task**, not direct `taskkill` — EAC games reject a non-elevated kill.
> - Foreground detection is a hidden **PowerShell** helper, not a native module — keeps the zero-dep, no-rebuild invariant.
> - Game budget is **single and shared** across all listed games, with **no emergency bypass** (unlike breaks).
> - All state is local files in `userData`; there is no server, ever.
> - Windows are created hidden and revealed on first paint — no unpainted white frame ever ships.

---

## Dev Memory Protocol

<!-- Self-contained. This kit = the root surfaces below, no external deps. Read once; it governs the rest. -->

**Surfaces**

- `PROJECT.md` — stable spine (this file): why / scope / architecture / invariants. Edit on structural change.
- `STATE.md` — cursor: current task / next / blockers. Overwrite freely. ≤40 lines.
- `DECISIONS.md` — append-only history (forward commitments). Supersede, never rewrite.
- `JOURNAL.md` — append-only problem/solution log: what broke, dead ends, fix, lesson. **Lazy — never always-loaded** (it grows unbounded + is only sometimes relevant). Want an always-visible nudge? Keep a 2-line "Lessons" note in the spine, not the whole journal. (DECISIONS = what we'll do; JOURNAL = what we hit & learned.)
- `specs/<slug>.md` — per-feature spec + acceptance criteria (copy `specs/_template.md`). **Lazy** — each starts with a `> Load when:` trigger; load only the one whose trigger/`applies-to` matches the task, not all specs. If a lazy file is already in this context, reuse it — don't re-read it (re-reading after `/compact` is fine; thrashing it every turn is not).

**Create on demand — never pre-create empty stubs**

- `STATE.md` → on the first "where was I?" (work spans more than one session)
- `DECISIONS.md` → on the 3rd recorded decision
- `JOURNAL.md` → on the first non-trivial problem worth not repeating (cost real time, had dead ends, or non-obvious fix)
- `specs/<slug>.md` → when a feature will outlive a single session

**Always-loaded budget** — what rides in *every* session = **spine + cursor + decisions digest** (~1k tokens, <1% of the context window). Everything else (full DECISIONS log, JOURNAL, other specs) is fetched on a trigger. This is the design for **every tier** — a $20 sub and a Max sub run the same shape; lean memory isn't a cheap mode, it's what leaves the window free for the actual code.

**Merge vs Split** — default is **one file** (`PROJECT.md` with inline State + a ≤7-line Decisions digest). Split a surface out **only** when it hits one of two physical pressures — never for tidiness:
1. **Unbounded growth** — the full decisions log / journal / a feature spec would bloat the spine → extract it, keep a small digest/pointer inline.
2. **Volatility (cache)** — a section that rewrites every session dirties the stable spine → extract the cursor to `STATE.md`.
A surface with neither pressure stays merged. Triggers are *permissions to grow, not obligations*; solo/small work may sit at ~one file indefinitely. Never pre-create empty stubs.

**Precedence** for "what do I do now": `STATE > DECISIONS > PROJECT`.
STATE is a cursor, not truth. A *standing* contradiction is a bug → fix by editing PROJECT or appending to DECISIONS.

**Boundary** — this kit holds only build-time facts (how the project is made). Anything the running product needs at runtime belongs in the product's own storage, not here.

**Hygiene** — supersede, don't append. If `PROJECT.md` outgrows ~150 lines, move content out (→ STATE / DECISIONS / specs / delete). Re-check staleness whenever you resume cold or onboard someone.

**Autonomous upkeep** — the agent keeps these surfaces current as a normal part of doing the work, without waiting for a user command. Record a decision when it's made, journal a non-trivial problem when it's solved, advance STATE as the cursor moves, flip a spec AC `[ ]→[x]` when verified. Write on the event, not every turn (thrashing the files each turn is noise). Update PROJECT.md on: purpose/user change · requirement validated/invalidated/cut · major architecture decision · source-of-truth change · milestone done — a *structural* PROJECT.md rewrite is fine to make, but surface it in your reply so the owner sees it.

**`end session` checkpoint** — when the user signals end of work ("end session", "конец сессии", "wrapping up", or equivalent), run a memory sweep before stopping:
1. STATE — refresh `Now` / `Recent:` / `Next` / `Blockers` / `In flight` so a cold resume is cheap. (Born here if it doesn't exist yet and work spans sessions.)
2. DECISIONS — append any decision made this session (file born on the 3rd decision).
3. JOURNAL — append any non-trivial problem→fix→lesson (file born on the first one).
4. specs — flip any verified AC `[ ]→[x]`.
5. PROJECT.md — check staleness; update if a milestone/scope change landed.
6. Report a ≤3-line summary of what was written where. Write nothing if nothing changed — an empty sweep is a valid outcome, not a reason to invent entries.

**Working when** — sessions resume without re-explaining, decisions don't get re-litigated, and the context window stays mostly code, not memory overhead. If you're re-explaining the project each session, the kit is stale, not done.
