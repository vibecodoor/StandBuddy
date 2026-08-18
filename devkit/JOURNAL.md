# StandBuddy — Journal

<!-- DEV MEMORY KIT · append-only problem→solution log. Lazy: read when "have we hit this before?".
     One entry = one problem. Signal only. Newest first. -->

### 2026-08-18 — White flash + stall before every overlay appeared

- **Problem:** a white frame flashed before the break overlay, and it sometimes hung for a
  moment before painting. Three causes stacked in the same path: (1) windows were created with
  `show` defaulting to true and no `backgroundColor`, so Electron's default white window was on
  screen before the renderer's first frame; (2) every overlay HTML pulls Google Fonts through a
  render-blocking `<link>`, putting a network round-trip on the critical path of first paint —
  in an app that is otherwise fully offline; (3) the payload was sent on `did-finish-load`, which
  waits for all subresources *including* that font request, so the theme class, tip and countdown
  landed after the window was already visible (and the overlay briefly rendered in the default
  warm theme even for an Ocean user).
- **Tried & rejected:** just setting `backgroundColor` — hides the white but not the stall, since
  first paint is still gated on the font request. Re-asserting `setAlwaysOnTop` after `show()` —
  added on suspicion that the hidden→show transition let the taskbar draw over the overlay;
  screenshots proved it changed nothing, so it was reverted rather than left in as dead defense.
- **Fix:** create every window with `show: false` + a themed `backgroundColor` and reveal it from
  `ready-to-show` (with a 1.5s safety timer — an overlay that never appears is worse than a
  flash); move the IPC payload to `dom-ready` so content lands before first paint; load the font
  stylesheet as `media="print" onload="this.media='all'"` so the network can never gate a paint.
- **Lesson:** `did-finish-load` is the wrong signal for anything user-visible — it waits on every
  subresource, so one remote asset makes the whole window late. `dom-ready` for content,
  `ready-to-show` for visibility. And a remote font in an offline-first app is a hidden
  dependency on the network in the middle of the core loop.

### 2026-08-18 — `npm install` won't repair a broken Electron dev binary

- **Problem:** `npm start` died with "Electron failed to install correctly", so nothing could be
  run locally — the Game Limiter work sat unverified behind it.
- **Tried & rejected:** `npm install` — reports "up to date" and skips the binary download
  entirely, so it never repairs this. Running the packaged `StandBuddy.exe` with a source path
  argument — it ignores the argument and loads its own embedded (stale) `app.asar`, so you end up
  testing the old build and thinking the new code is broken.
- **Fix:** run the postinstall script directly — `node node_modules/electron/install.js` — then
  `npx electron .`.
- **Lesson:** the Electron binary and the npm package are separate installs. "up to date" only
  speaks for the package. And never smoke-test source through a packaged build.

### 2026-08-18 — `taskkill` silently fails on anti-cheat games

- **Problem:** the limiter's kill did nothing against Apex Legends — `taskkill /f /im` returned
  "Access denied" because EAC-protected processes reject a kill from a non-elevated process.
  Locally it looked like working code: notepad.exe died fine on the same code path.
- **Tried & rejected:** running the app elevated (a UAC prompt on every launch, for a tray app);
  retrying the kill (the failure is a permission wall, not a race).
- **Fix:** an elevated, trigger-less scheduled task invoked with `schtasks /run` — see
  [DECISIONS.md](DECISIONS.md), "Kill games via an elevated scheduled task".
- **Lesson:** verifying a Windows kill path against an ordinary process proves nothing about a
  protected one. Test enforcement against the actual class of target.

### 2026-08-18 — Saving Settings killed the freshly spawned game monitor

- **Problem:** saving Settings restarts the limiter, which spawns a new PowerShell foreground
  helper — and the *old* process's delayed exit event arrived afterwards and tore down the new one.
  Game detection stopped silently until the app was restarted.
- **Fix:** the exit handler ignores events from a process that is no longer the current helper.
- **Lesson:** with restart-on-save on a long-lived child process, every async handler needs an
  identity check — the event you're handling may belong to the process you already replaced.
