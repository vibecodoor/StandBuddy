# StandBuddy — State

<!-- DEV MEMORY KIT · cursor, NOT truth (truth = PROJECT.md / DECISIONS.md).
     Overwrite freely. Keep ≤40 lines. -->

## Now

v1.0.5 released: Game Limiter + the overlay reveal fix, pushed to GitHub.
Recent: killed the white flash and the network-stall hang on every overlay — windows are now
created hidden with a themed `backgroundColor` and revealed on `ready-to-show`, payload moved
from `did-finish-load` to `dom-ready`, and the Google Fonts `<link>` is no longer render-blocking.
Verified live: break overlay renders fully populated in the correct theme ~1s after firing.

## Next

0. Publish the GitHub Release for tag `v1.0.5` manually (browser) and attach
   `dist/StandBuddy-1.0.5-win.zip`. Code + tag are pushed; only the binary is unpublished.
   GitHub CLI is not installed on this machine — that is why it was not automated.
1. Bundle the DM Sans / DM Serif woff2 files locally and drop the `fonts.googleapis.com` link.
   Every overlay still pings Google with the user's IP, which contradicts the offline invariant.
2. Game Limiter AC #1–#6 in [specs/game-limiter.md](specs/game-limiter.md) are still unverified —
   shipped on the owner's call. #6 (elevated kill vs EAC) is the one that most needs a live run.
3. Confirm whether the Windows taskbar really draws over the fullscreen break overlay
   (visible in test screenshots; unchanged by the reveal fix, so pre-existing if real).

## Blockers

- None. The focus-triggered Game Limiter path still needs a human at the keyboard, but it is
  no longer holding the release.

## In flight

- Nothing uncommitted.

_Last touched: 2026-08-18_
