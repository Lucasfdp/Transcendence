# Fix Plan — Invite Matches: Missing HUD Borders & Stuck "Launching…"

## Scope

Two reported bugs, both only when a match is entered **via a private-lobby invite**
(HomePage → accept invite → auto-join), not via normal matchmaking:

1. **Borders / HUD panels don't load** — the side panels (e.g. the left
   `TEMPLE CURLING` info panel and the right `SCORE LOG` panel) are missing.
2. **Shells never fire** — after both players aim and release, the status shows
   `Launching…` forever and no shell is thrown.

This is a diagnosis + implementation plan **for another agent**. No code has been
changed yet.

---

## Root cause (shared by both bugs)

An invite match is created but **never started**. It stays in status `pending`,
so the game engine ignores all input and the client scenes never reach the
`active` phase that renders the HUD and enables firing.

### Two launch paths, only one of which starts the match

**Normal matchmaking (works):**

1. `queue:join` → server matches players → emits `match:found` to both.
2. Each client, on `match:found`, emits `room:ready`
   (`frontend/src/routes/GamePage.tsx:370`, and the ShellPicker equivalent).
3. Server `onRoomReady` → `RoomService.setReady` → `GameSessionService.startIfReady`.
   `startIfReady` only starts once **every** player is `ready`
   (`backend/src/modules/matchmaking/game-session.service.ts:65-79`). It sets
   `room.status = "active"` and `state.phase = "active"`, then broadcasts
   `game:state`.
4. Client launches the scene only when it receives a `game:state` with
   `phase === "active"` (`GamePage.tsx` `onState` guard, ~line 380).

**Invite / private lobby (broken):**

1. Invitee accepts → `lobby:join` → `PrivateLobbiesService.joinLobby` creates a
   room via `RoomService.createRoom`. `createRoom` hard-codes
   `status: "pending"` and every player `ready: false`
   (`backend/src/modules/matchmaking/room.service.ts:30,39`).
2. `onLobbyJoin` emits `lobby:matched` + `game:state` (with the **pending**
   state) to both players
   (`backend/src/modules/matchmaking/matchmaking.gateway.ts:589-595`).
   It **never** marks players ready and **never** calls `startIfReady`.
3. HomePage `onLobbyMatched` navigates to `/play/:gameId` with
   `{ autoJoinMatch: true }` (`frontend/src/pages/HomePage.tsx:701-704`).
4. GamePage's auto-join effect calls `rejoinActiveMatch`, which emits **only**
   `match:rejoin` (`GamePage.tsx:305`). `match:rejoin` just reconnects the
   socket and re-emits the current state — it does **not** set ready or start
   the session (`matchmaking.gateway.ts:255-265`).

Net result: nobody ever emits `room:ready` on the invite path, so `startIfReady`
is never satisfied. The match is stuck at `status: "pending"` / `phase: "pending"`.

### Why bug 2 (stuck "Launching…") follows

On release, the scene emits `game:input` `action:"release"` and locally sets the
status to `"Launching…"`, expecting a `game:state` / `game:throw` back
(`ShellCurlScene.ts:617-652`, and equivalents in the other scenes at
`BellClashScene.ts:449-450`, `KameKnockScene.ts:518-519`,
`BambooBashScene.ts:641`). But every engine's `handleInput` bails when the room
isn't active:

- `shell-curl.engine.ts:106` / `:131` → `if (!player || room.status !== "active") return null;`
- `bell-clash.engine.ts:107,136,166` → `room.status !== "active" || state.phase !== "active"`

`handleInput` returns `null`, no state is broadcast, the client waits forever.
→ "Launching…" hangs.

### Why bug 1 (missing HUD borders) follows — and why it's game-specific

The scene is launched with the **pending** snapshot. In `applyOnlineSnapshot`,
any non-active phase returns early with a "Waiting…" status **before** the code
that begins the turn and builds the side panels:

- `ShellCurlScene.ts:1673-1677` → `if (snapshot.phase !== "active") { updateOnlineStatus("Waiting for opponent…"); return; }`
  In Temple Curling the side panels are only created inside `beginTurn()` /
  `updateSidePanels()`, which run **after** that early return. So on the invite
  path the panels are never created → **no borders** (matches screenshot 1 vs 2).

- Bell Clash and Kame Knock call `updateSidePanels()` unconditionally in
  `create()` (`BellClashScene.ts:332`, `KameKnockScene.ts:390`), so their HUD
  renders even in the pending state — which is exactly why screenshot 4 (Bell
  Clash via invite) shows a full HUD but still hangs on "Launching…".

So bug 1 is a **secondary symptom** of the same never-started match, made visible
in Temple Curling by its phase-gated panel creation.

---

## Fix strategy

Primary fix is **server-side**: start the match when the invite lobby is joined,
mirroring the normal matchmaking hand-off. This resolves both bugs for all four
games with no dependency on fragile client ready round-trips. A small
**client/scene hardening** step makes Temple Curling's HUD robust to any future
non-active launch.

### Task A — Start the match on lobby join (primary, backend)

Goal: after a private lobby is joined and the room is created, the match should
transition to `active` exactly as it does in normal matchmaking, and both
players should receive an `active` `game:state`.

Where: `backend/src/modules/matchmaking/matchmaking.gateway.ts`, `onLobbyJoin`
(~lines 564-597), and/or `PrivateLobbiesService.joinLobby`
(`private-lobbies.service.ts:102-157`).

Recommended implementation (in the gateway, where `this.rooms` and
`this.sessions` are already injected):

1. After `joinLobby` returns `{ matchId, room }` and presence is synced, mark
   **both** players ready:
   - For each `player` in `room.players`, call
     `this.rooms.setReady(room.matchId, player.user.id)`.
   - (`setReady` already exists at `room.service.ts:77-83`.)
2. Start the session: `const started = await this.sessions.startIfReady(room.matchId);`
   - `startIfReady` will now find all players ready, set `status/phase = "active"`,
     update the DB row, and return the started room
     (`game-session.service.ts:65-79`).
3. Broadcast the **active** state to the match room instead of (or in addition to)
   the current pending `game:state`:
   - Replace the per-socket `s.emit("game:state", room.state)` with a single
     `if (started?.status === "active") this.emitState(started.matchId);`
     after the `lobby:matched` emits. `emitState` re-reads the room, syncs
     presence, captures a replay frame, and emits `game:state` to the whole
     match room (`matchmaking.gateway.ts:657-665`) — consistent with how
     `onRoomReady` broadcasts.
   - Keep emitting `lobby:matched` per socket so HomePage still navigates.

Notes / gotchas for the implementer:
- Preserve ordering: players must `s.join(matchId)` **before** `emitState`, so
  the room broadcast reaches them. The existing loop already joins each socket;
  make sure the `emitState` call happens after that loop.
- `startIfReady` early-returns unless `room.status === "pending"` and all players
  ready — so calling it once, after both `setReady`s, is correct and idempotent.
- This mirrors the existing `onRoomReady` path
  (`matchmaking.gateway.ts:281-291`), so behavior stays consistent with normal
  matchmaking (replay recording, DB `startedAt`, etc. all handled by
  `startIfReady`).
- Consider whether replay/`startedAt` side-effects should fire for private
  casual matches — they already do in normal casual play, so no change expected.

Why not fix it purely client-side (emit `room:ready` in `rejoinActiveMatch`)?
That would require **both** clients' rejoin round-trips to succeed and race-free
before `startIfReady` can pass, and the auto-join snapshot would still initially
be `pending`. Server-side start is deterministic because both players are known
at `lobby:join` time. Do **not** rely on the client for the primary fix.

### Task B — Make the auto-join snapshot the active one (verify, backend/frontend)

After Task A, when GamePage mounts and emits `match:status`
(`GamePage.tsx:205`), the server's `emitUserMatchStatus`
(`matchmaking.gateway.ts:685-696`) returns `snapshot: room.state` with
`phase: room.status` — which will now be `active`. The auto-join effect
(`GamePage.tsx:290-312`) then launches with an active snapshot. Verify:

- There is no race where GamePage emits `match:status` before the room reaches
  `active`. Because Task A starts the match synchronously inside `onLobbyJoin`
  (before the client has even navigated), the room is already `active` by the
  time `match:status` arrives. Confirm with a manual two-client test.
- `rejoinActiveMatch` emitting `match:rejoin` after the match is active is
  harmless (`onMatchRejoin` just re-emits state); leave it as-is.

No code change is expected here if Task A is done correctly — this is a
verification step. If a race is observed, have the auto-join effect wait for a
`game:state` with `phase === "active"` (reuse the `onState` pattern from
`findOnlineMatch`) instead of launching immediately from `match:status`.

### Task C — Harden Temple Curling HUD against non-active launch (frontend, defensive)

Goal: the `TEMPLE CURLING` / `SCORE LOG` panels should render even if the scene
is ever launched (or reconnected) in a `waiting`/`pending` phase, matching Bell
Clash and Kame Knock.

Where: `frontend/src/games/shell-curl/ShellCurlScene.ts`.

- Call `this.updateSidePanels()` once during `create()` (or in `initOnlineMatch`,
  before the early `return`s in `applyOnlineSnapshot`), the same way
  `BellClashScene.ts:332` and `KameKnockScene.ts:390` already do.
- Ensure the early-return branch for `snapshot.phase !== "active"` in
  `applyOnlineSnapshot` (`ShellCurlScene.ts:1673-1677`) still calls
  `updateSidePanels()` (or that panels were already built in `create()`), so the
  "Waiting for opponent…" state shows a full HUD.
- This is defense-in-depth; with Task A the invite path launches active, but this
  removes the phase coupling that made the bug visible and protects the
  reconnect/spectator paths.

---

## Verification checklist (for the implementing agent)

Add/adjust automated coverage, then do manual two-client checks.

Backend unit/integration (Jest, `cd backend && npm run test`):
- `matchmaking.gateway.spec.ts` / `private-lobbies.service.spec.ts`: after
  `lobby:join`, assert the room `status === "active"` and that an `active`
  `game:state` is emitted to both sockets.
- Assert both `match-player` rows persist and `match.status`/`startedAt` are set
  (as `startIfReady` does for normal matches).
- Edge: invitee tries to join a lobby while already in an active match → still
  rejected (`joinLobby` `hasActiveRoom` guard, `private-lobbies.service.ts:112`).
- Edge: host disconnects between invite and join → no crash; match not started
  with a missing player.

Manual (two browsers / two accounts, `make dev`):
1. Host invites friend → friend accepts → **both** land in gameplay with full HUD
   borders (Temple Curling especially) — fixes bug 1.
2. Both aim and release a shell → shell fires, status leaves "Launching…",
   `SCORE LOG` updates — fixes bug 2.
3. Repeat for all four games: `temple-curling`, `bell-clash`, `kame-knock`,
   `bamboo-bash`.
4. Regression: normal matchmaking (`Find Online Match`) still works end-to-end.
5. Regression: mid-match reconnect (refresh a tab) still rejoins and can throw.

Document manual frontend validation in the delivery per CLAUDE.md testing rules.

---

## File reference index

Backend:
- `backend/src/modules/matchmaking/matchmaking.gateway.ts` — `onLobbyJoin`
  (~564), `onRoomReady` (281), `onMatchRejoin` (255), `emitState` (657),
  `emitUserMatchStatus` (685).
- `backend/src/modules/matchmaking/private-lobbies.service.ts` — `joinLobby` (102).
- `backend/src/modules/matchmaking/room.service.ts` — `createRoom` (15, status
  `pending` at 39), `setReady` (77).
- `backend/src/modules/matchmaking/game-session.service.ts` — `startIfReady`
  (65), `handleInput` (59).
- `backend/src/modules/matchmaking/engines/shell-curl.engine.ts` — `handleInput`
  active guards (106, 131), `start` (77).
- `backend/src/modules/matchmaking/engines/bell-clash.engine.ts` — active guards
  (107, 136, 166).

Frontend:
- `frontend/src/pages/HomePage.tsx` — `onLobbyMatched` (701).
- `frontend/src/routes/GamePage.tsx` — auto-join effect (290), `rejoinActiveMatch`
  (300), normal-path `room:ready` (370), `onState` active guard (~380).
- `frontend/src/games/shell-curl/ShellCurlScene.ts` — `initOnlineMatch` (1393),
  `applyOnlineSnapshot` (1618, non-active early return 1673), `updateSidePanels`
  (2232), `onLaunch` "Launching…" (651).
- `frontend/src/games/bell-clash/BellClashScene.ts` — `updateSidePanels` in
  create (332), "Launching…" (449).
- `frontend/src/games/kame-knock/KameKnockScene.ts` — `updateSidePanels` in
  create (390), "Launching…" (518).

---

## Summary

Single root cause: **private-lobby invite matches are created `pending` and never
started**, because the invite path never triggers the `room:ready` →
`startIfReady` hand-off that normal matchmaking uses. That leaves the engine
rejecting input (stuck "Launching…") and the scene stuck in a pre-active phase
(Temple Curling's phase-gated side panels never render → missing borders).

Fix: start the match server-side inside the lobby-join flow (Task A), verify the
auto-join snapshot is now active (Task B), and decouple Temple Curling's HUD from
the active phase for robustness (Task C).
