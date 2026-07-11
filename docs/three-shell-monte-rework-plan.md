# Three-Shell Monte Rework

## Purpose

Three-Shell Monte now follows the classic three-cup rhythm: reveal the ball,
cover it, shuffle the cups, let the player choose, then reveal and settle the
round. The game is intentionally fixed to three cups.

## Backend Contract

- `GET /casino/monte` still returns the Monte configuration, wager bounds, RTP
  and current balance.
- `POST /casino/monte/rounds` starts a committed round. It validates and debits
  the stake, creates three cup ids, commits to the server seed and winning cup,
  returns the visible ball cup for the preview, and returns the updated balance.
- `POST /casino/monte/rounds/:roundId/resolve` accepts the selected cup id,
  verifies it against the stored round, credits any payout, writes the wager
  audit row, and reveals the fairness data.

Only one active pending Monte round is reused per user. Starting another round
while one is still valid returns the pending round without charging the player
again. Expired pending rounds are recorded as losses before a new round starts.

## Fairness And Security

The backend remains authoritative. The client never tells the server whether a
choice won; it only submits the selected cup id. The server compares that id to
the committed ball cup id and applies the payout.

The implementation uses the existing provably-fair primitives: a server seed is
committed by SHA-256 hash, the client seed and nonce are mixed into the HMAC
roll, and the server seed is revealed after settlement. The round also includes
a winning-cup commitment hash that binds the server seed, client seed, nonce and
ball cup id.

A browser-rendered shell game cannot be perfectly protected from developer
tools, because the browser must know enough to draw the preview and cup motion.
This is treated as a display limitation rather than a source of authority.

## Frontend Flow

The React modal uses explicit phases:

- `idle`: stake and optional client seed are editable.
- `preview`: cups lift and the ball is visible under the server-selected cup.
- `covering`: cups lower over the ball.
- `shuffling`: cup ids swap positions.
- `choosing`: the player selects a cup and checks the result.
- `revealing`: the backend settles the round and the final ball position is
  shown.

Shuffle timing starts at 1000 ms per swap and eases down to 250 ms over the
configured swap count. Reduced-motion mode shortens the preview and skips the
long shuffle while preserving the same settlement path.
