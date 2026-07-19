---
name: verify
description: Runtime verification recipe for the Transcendence games (headless Firefox + Selenium against the Docker stack)
---

# Verifying the games at runtime

## Launch

- `make dev` starts the stack; the app is served at `https://localhost:42424`
  (self-signed certificate — accept insecure certs). `MONITORING_PORT` must be
  `3001` in `.env` or the monitoring service collides with the frontend.
- Frontend readiness: `curl -sk https://localhost:42424/` returns 200.

## Browser automation

- No Node or Playwright on the host; use host Firefox with Selenium.
  One-off setup in a scratch directory:
  `python3 -m venv venv && venv/bin/pip install selenium`
  (Selenium Manager downloads geckodriver automatically.)
- Firefox options: `-headless`, capability `acceptInsecureCerts: true`.
- If a run hangs with an urllib3 read timeout, kill stray processes:
  `pkill -f geckodriver; pkill -f "firefox.*-headless"`.

## Sessions and routes

- Game routes are `/play/:gameId` with ids `temple-curling`, `bamboo-bash`,
  `bell-clash`, `kame-knock` (`/game/...` does not exist; it redirects home).
- All game routes require auth. Fastest session: load `/auth`, then from the
  browser run `fetch('/api/auth/csrf-token')` and POST
  `/api/auth/register` (`{username, email, password}`) with the
  `X-CSRF-Token` header and `credentials: 'include'`; fall back to
  `/api/auth/login` (`{identifier, password}`) if the user exists.
- Use fresh usernames per run: a user who left a match mid-game keeps an
  active-match lock on the server (reconnect window) and cannot create or
  join private rooms until it expires or is abandoned.

## Driving a match

- Local play: on `/play/:gameId` click "Play Solo" or "Start Local VS".
- Online play (two drivers): player A clicks "Create" in the Private Online
  card and the PIN appears in the page text as `Private room <PIN>`; player B
  types it into `input[aria-label='Private room PIN']` and clicks "Join".
  Both clients get a canvas once matched.
- Input is drag-and-release on the canvas, starting **on the player's piece**
  (offsets from canvas centre at 1440×814): temple-curling shell at
  (-390, 10); kame-knock turtle at (0, 0); bell-clash blue turtle at
  (0, -151); bamboo-bash turtle near centre.
- Console errors: Selenium Firefox has no `get_log`; inject hooks for
  `console.error`, `window.onerror` and `unhandledrejection` into a
  `window.__errs` array after each navigation and read it back.
- Evidence: screenshot both clients before and after a shot; the remote
  client must show the moved piece, its trail, and score-log updates.
