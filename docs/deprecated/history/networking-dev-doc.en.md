# Networking, Sockets, and Matchmaking Dev Doc

This document explains how the online game networking layer is implemented in this project: Socket.IO transport, matchmaking, match rooms, game sessions, reconnection, spectators, and persistence.

## Main Files

- `frontend/src/services/network/gameSocket.ts` defines the shared Socket.IO client and the client-side snapshot/event types.
- `frontend/src/routes/GamePage.tsx` starts and cancels matchmaking, handles `match:found`, waits for the first active `game:state`, and launches the Phaser scene.
- `frontend/src/games/*/*Scene.ts` listens to online snapshots and throw events, and emits gameplay inputs.
- `backend/src/modules/matchmaking/matchmaking.gateway.ts` is the Socket.IO gateway and event router.
- `backend/src/modules/matchmaking/matchmaking.service.ts` owns in-memory matchmaking queues.
- `backend/src/modules/matchmaking/room.service.ts` owns live in-memory match rooms, players, spectators, and reconnect timers.
- `backend/src/modules/matchmaking/game-session.service.ts` starts sessions, routes inputs to engines, persists finished matches, and applies rewards/Elo.
- `backend/src/modules/matchmaking/engines/*.engine.ts` contains per-game authoritative state logic.
- `infra/reverse-proxy/conf/default.conf.template` routes `/ws/` WebSocket traffic to the backend.

## Transport Layer

The frontend uses Socket.IO over WebSocket only:

```ts
io("/", {
  path: "/ws/",
  withCredentials: true,
  transports: ["websocket"],
});
```

The backend gateway is mounted on the same path:

```ts
@WebSocketGateway({
  path: "/ws/",
  cors: { origin: ..., credentials: true },
})
```

Nginx exposes that path and forwards upgrade headers:

- `/ws/` is proxied to `http://backend:8000`.
- `Upgrade` and `Connection` headers are passed through.
- `proxy_read_timeout` and `proxy_send_timeout` are set to `3600s`.
- ModSecurity is disabled for `/ws/`.

The Content Security Policy also allows `ws://` and `wss://` localhost connections.

## Authentication And Presence

On every socket connection, the gateway reads the auth cookie named by `COOKIE_NAME`, verifies it with `JwtService`, and loads the user through `UsersService`.

If validation fails, the socket receives:

```ts
error: { message: "Unauthorized websocket connection" }
```

Then the socket is forcibly disconnected.

If the user is authenticated:

- `socket.data.user` is set to `{ id, username, isGuest }`.
- `PresenceService.connect(socket.id, user)` marks the user online.
- Guest sockets get a timer based on the JWT expiration; when the token expires, the socket disconnects.
- If the user already belongs to an active room, `RoomService.reconnect()` is attempted immediately.

Presence is in memory. A user is online while at least one socket ID is registered for that user.

## Matchmaking Queue

The client joins matchmaking with:

```ts
queue:join {
  gameId: string,
  mode: "casual" | "ranked",
  playerCount: number,
  shellSelection: string[],
}
```

Important backend rules:

- `playerCount` is clamped between `2` and `5`.
- `mode` defaults to `casual`.
- Guests cannot join ranked matches.
- A user cannot be queued or in an active room already.
- Non-guest shell selections are validated through `ShellsService`.
- Queues are keyed by `gameId:mode:playerCount`.
- Queues are in memory, not Redis/Postgres.

If there are not enough players, the client receives:

```ts
queue:joined { gameId, mode }
```

When enough unique users are queued:

1. The first `playerCount` entries are removed from the queue.
2. A `matches` row is created with status `pending`.
3. `RoomService.createRoom()` creates the live room.
4. `match_players` rows are created with side and shell selection.
5. Every player socket joins a Socket.IO room named with the match ID.
6. Every player receives `match:found`.

```ts
match:found {
  matchId: string,
  side: number,
  playerCount: number,
  opponents: string[],
}
```

Queue cancellation uses:

```ts
queue:leave
```

The backend removes the user from the queue and emits:

```ts
queue:left
```

If queueing fails, the backend emits:

```ts
queue:error { message: string }
```

## Room Lifecycle

Live rooms are stored in `RoomService`:

```ts
MatchRoom {
  matchId,
  gameId,
  mode,
  status,
  players,
  spectators,
  seq,
  state,
  rewardsGranted?
}
```

Each player gets a `side` index starting at `0`. That side is used by snapshots, scores, turns, and winner calculation.

Room phases are:

- `pending`: match exists, but not all players are ready.
- `active`: all players sent `room:ready` and the engine started.
- `finished`: game ended normally.
- `abandoned`: a player abandoned or failed to reconnect.

After `match:found`, the frontend emits:

```ts
room:ready { matchId }
```

The backend marks the player ready, emits the updated `game:state`, and calls `GameSessionService.startIfReady()`. When all players are ready:

1. `RoomService.start()` calls the selected game engine's `start()`.
2. The DB match status becomes `active` and `startedAt` is set.
3. A new `game:state` snapshot is broadcast.
4. The frontend launches the online Phaser scene after seeing an active snapshot for the selected game.

## Game State Snapshots

The backend broadcasts snapshots through:

```ts
game:state GameSnapshot
```

All snapshots include:

- `matchId`
- `seq`
- `gameId`
- `mode`
- `phase`
- `players`
- `winnerSide`

The `seq` counter is incremented whenever the room state changes. Clients can use it as a monotonic update marker.

Each game has a specific snapshot shape:

- `temple-curling`: turns, ends, stones, map bumpers, settled objects.
- `bamboo-bash`: timed rounds, live round scores, shared bamboo objects.
- `kame-knock`: turns, rounds, targets, score.
- `bell-clash`: rounds, shot counts, scoring zones.

## Gameplay Input Flow

Clients send gameplay actions with:

```ts
game:input {
  matchId: string,
  action: string,
  payload?: Record<string, unknown>,
}
```

Supported actions are defined in `matchmaking.types.ts`:

- `aim`
- `power`
- `release`
- `settled`
- `round:score`
- `bamboo:hit`
- `bamboo:sync`
- `target:hit`
- `bell:hit`

The gateway passes inputs to `GameSessionService.handleInput()`, which fetches the room and delegates to the registered engine for that `gameId`.

The engines validate basic authority rules, such as:

- the room must be active;
- the user must be a player in the room;
- turn-based games require the current player's side;
- round and turn numbers must match the snapshot;
- repeated scoring for the same round/shot is rejected.

The server owns the canonical snapshot, but some games still trust client-calculated physics or hit results. For example:

- `temple-curling` accepts client `settled` object positions.
- `bamboo-bash` accepts `bamboo:hit` and updates shared bamboo state server-side.
- `kame-knock` accepts `target:hit` with combo/perfect data.
- `bell-clash` accepts `bell:hit` point values.

This means the server is authoritative over turn order, match phase, score aggregation, and persistence, but not fully authoritative over all physics outcomes.

## Throw Events

For responsive visuals, the gateway emits extra throw events on `release` before or alongside snapshots:

- `temple-curling`: `game:throw`
- `bamboo-bash`: `game:bamboo-throw`
- `kame-knock`: `game:kame-throw`
- `bell-clash`: `game:bell-throw`

These events include `matchId`, `side`, velocity, power, and game-specific round/shot fields. Phaser scenes listen to these events to animate remote player throws.

## Finishing Matches

After input handling, the gateway emits the latest `game:state`. If an engine has marked the room as `finished` or `abandoned`, the gateway calls `GameSessionService.finishIfEnded()` and emits:

```ts
game:end GameSnapshot
```

`GameSessionService` persists finished rooms in a transaction:

- updates `matches.status`, `winnerUserId`, `winnerSide`, and `finishedAt`;
- updates every `match_players.outcome`;
- submits non-abandoned results to `GameResultsService` for connected, non-guest users;
- applies Elo if the match was `ranked` and has a winner.

`rewardsGranted` prevents duplicate reward persistence for the same room.

On backend boot, any DB match still marked `active` is changed to `abandoned`. This prevents stale active matches after a server restart.

## Reconnection And Abandonment

The reconnect timeout is `45_000ms`.

On socket disconnect:

1. The socket is removed from matchmaking queues.
2. The socket is removed from spectator maps.
3. If the socket belonged to a live player, that player is marked disconnected.
4. `reconnectExpiresAt` is set to `Date.now() + 45_000`.
5. A disconnect timer is started.
6. The updated `game:state` is broadcast.

If the player reconnects before the timeout:

- the new socket ID replaces the old one;
- the disconnect timer is cleared;
- `connected` becomes `true`;
- `reconnectExpiresAt` is cleared;
- the socket rejoins the Socket.IO match room;
- the client receives `reconnect`, `game:state`, and `match:status`.

Manual status/rejoin events:

```ts
match:status { away?: boolean }
match:rejoin
match:abandon
```

`match:status` returns either:

```ts
match:status { inMatch: false }
```

or:

```ts
match:status {
  inMatch: true,
  matchId,
  gameId,
  phase,
  side,
  reconnectExpiresAt,
  snapshot,
}
```

When `away: true` is sent, the backend treats the player as temporarily away and starts the same reconnect timeout.

If the timeout expires or the player sends `match:abandon`, `GameSessionService.abandon()` asks the game engine to choose a winner from the remaining connected players, marks the room abandoned, persists it, and emits `game:end`.

## Spectators

Spectator events are:

```ts
spectator:join { matchId }
spectator:leave
```

On join, the backend:

- checks that the room exists and is not finished/abandoned;
- adds the socket to the room's in-memory spectator map;
- joins the Socket.IO room;
- emits the current `game:state` to that socket.

Current spectator membership is in memory. The `MatchSpectator` entity exists, but the gateway does not currently persist spectator joins/leaves.

## HTTP Match Endpoints

`MatchesController` exposes regular REST endpoints under the global `/api` prefix:

- `GET /api/matches/active`: latest pending/active matches with players.
- `GET /api/matches/:id`: one match with players and spectators.

These endpoints read persisted DB rows. They do not expose the live in-memory snapshot.

## Adding A New Online Game

To add another online game:

1. Create a new engine implementing `GameEngine`.
2. Add its snapshot/input types to `matchmaking.types.ts` and frontend `gameSocket.ts`.
3. Register the engine in `GameEngineRegistry`.
4. Make `createInitialState()` return the game-specific pending snapshot.
5. Implement `start()`, `handleInput()`, and `abandon()`.
6. Add frontend matchmaking support in `GamePage` data if needed.
7. In the Phaser scene, listen to `game:state`, `game:end`, and any game-specific throw events.
8. Emit `game:input` with `matchId`, `action`, and payload.

## Important Development Notes

- Matchmaking queues, live rooms, spectators, reconnect timers, and presence are in memory. Multiple backend instances would not share state.
- The DB stores match metadata and final outcomes, not live snapshots.
- Socket auth depends on cookies, so the client must use `withCredentials: true`.
- The Socket.IO path is `/ws/`, not the default `/socket.io/`.
- Ranked matches are blocked for guests.
- Finished and abandoned rooms remove users from the active-room index, but room objects remain in the room map until process restart.
- Client-side physics/hit reporting is still trusted in several games; hard anti-cheat would require more server-side simulation or validation.
