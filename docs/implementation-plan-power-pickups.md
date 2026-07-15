# Implementation Plan: Power Pickups in Kame Knock, Bell Clash, and Shell Curl

## Summary

Add online power-pickup support to the three games that already have local
frontend infrastructure but do not yet have the corresponding online backend
wiring:

- **Bamboo Bash** is already complete and acts as the reference.
- **Kame Knock** has a working local frontend but needs backend and online wiring.
- **Bell Clash** has a working local frontend but needs backend and online wiring.
- **Shell Curl** has a working local frontend but needs backend and online wiring.

---

## Phase 1: Shared Backend Helper

**File:** `backend/src/modules/matchmaking/power-pickup.helper.ts`

Extract the common Bamboo Bash logic into a pure helper with no class
dependencies:

| Function | Purpose |
|---|---|
| `initPowerPickups(playerCount, powerupsEnabled, spawnCount)` | Build the initial state with N distributed pickups. |
| `tickPowerPickups(pickups, nextId, accMs, deltaMs, intervalMs)` | Accumulate time and spawn a pickup every `intervalMs` milliseconds. |
| `tryConsumePowerPickup(pickups, side, pickupId, usedPowersBySide, lastPowerBySide, lastPowerPickupIdBySide)` | Validate and consume a pickup; return `string \| null`. |
| `resetPowerPickups(playerCount)` | Reset all pickup state for a round. |
| `randomPowerPickupType()` | Select a random type from the power pool. |
| `randomPowerPickupSpot(existing, blockers?)` | Select a separated random normalised 2D position. |

---

## Phase 2: Shared Types

**File:** `backend/src/modules/matchmaking/matchmaking.types.ts`

1. Extract `PowerPickupEntry` into a shared interface. It already exists inline
   in `BambooBashSnapshot`.
2. Add the following fields to **`KameKnockSnapshot`**,
   **`BellClashSnapshot`**, and **`CurlingSnapshot`**:
   - `usedPowersBySide: string[][]`
   - `lastPowerBySide: string[]`
   - `lastPowerPickupIdBySide: Array<number | null>`
   - `powerPickups: PowerPickupEntry[]`
   - `nextPowerPickupId: number`
   - `powerPickupAccMs: number`, except in Curling if it does not tick pickups
   - `lastPowerPickupUpdateAt: number | null`
3. Add `"power-pickup"` to the `GameInputPayload["action"]` union if it is not
   already present.

---

## Phase 3: Backend Engine — Kame Knock

**File:** `backend/src/modules/matchmaking/engines/kame-knock.engine.ts`

- Call `initPowerPickups()` from `createInitialState()` and spread the result
  into the snapshot.
- Route `"power-pickup"` to `applyPowerPickup()` from `handleInput()`.
- In `applyPowerPickup()`, validate the turn, tick the pickup state, call
  `tryConsumePowerPickup()`, and refresh the state.
- Add a `tickPowerPickups(state)` wrapper that uses
  `Date.now() - state.lastPowerPickupUpdateAt` as its delta.
- Call `tickPowerPickups(state)` from `applyRelease()`, `applyTargetHit()`, and
  `applySettled()`.
- Call `resetPowerPickups()` from `resetRound()`.

---

## Phase 4: Backend Engine — Bell Clash

**File:** `backend/src/modules/matchmaking/engines/bell-clash.engine.ts`

Follow the Kame Knock pattern:

- Initialise the snapshot with `initPowerPickups()`.
- Route `"power-pickup"` from `handleInput()`.
- In `applyPowerPickup()`, confirm that the player has not already scored in
  the round, tick the state, and consume the pickup.
- Implement `tickPowerPickups()` in the same way as Kame Knock.
- Call `tickPowerPickups()` from `applyBellHit()` and `applyRoundScore()`.
- Call `resetPowerPickups()` from `resetRound()`.

---

## Phase 5: Backend Engine — Shell Curl

**File:** `backend/src/modules/matchmaking/engines/shell-curl.engine.ts`

In Shell Curl, pickups exist on the ice and a moving ball collects them:

- Initialise the snapshot with `initPowerPickups()`.
- Route `"power-pickup"` from `handleInput()`.
- In `applyPowerPickup()`, validate the turn, tick the state, consume the
  pickup, and refresh the snapshot.
- Call `tickPowerPickups()` from `applyRelease()` and `applySettled()`.
- Call `resetPowerPickups()` from the `resetEnd()` path when
  `state.throwsInEnd` reaches its limit.

---

## Phase 6: Gateway Broadcast Events

**File:** `backend/src/modules/matchmaking/matchmaking.gateway.ts`

Add three conditional blocks to the `game:input` handler immediately before
the final `this.emitState()`, following the `bamboo:power-pickup` pattern:

```typescript
// Kame Knock
if (payload.action === "power-pickup" && room.gameId === "kame-knock" && ...) {
    // Verify lastPowerPickupIdBySide and emit "game:kame-power-pickup".
}

// Bell Clash
if (payload.action === "power-pickup" && room.gameId === "bell-clash" && ...) {
    // Emit "game:bell-power-pickup".
}

// Shell Curl
if (payload.action === "power-pickup" && room.gameId === "temple-curling" && ...) {
    // Emit "game:curl-power-pickup".
}
```

Each event includes `matchId`, `roundNumber` or `turnNumber`, `side`, the
normalised position `(nx, ny)`, velocity `(vx, vy)`, and `power`.

---

## Phase 7: Online Frontend — Kame Knock

**File:** `frontend/src/games/kame-knock/KameKnockScene.ts`

1. In `spawnPowerPickup()`, when `onlineMatch` exists, read
   `snapshot.powerPickups` and call `this.powerPickups.setPickups()`, following
   Bamboo Bash.
2. After an online pickup is collected in `collectPowerPickup()`, emit a
   `game:input` event with `action: "power-pickup"`, including `pickupId` and
   the ball state.
3. Register a `game:kame-power-pickup` listener in `initOnlineMatch()`. Its
   handler updates the opponent's ball position and applies the power.
4. Adapt `recreatePowerPickups()` to use `setPickups()` online.

---

## Phase 8: Online Frontend — Bell Clash

**File:** `frontend/src/games/bell-clash/BellClashScene.ts`

Follow the Kame Knock pattern:

1. Use `setPickups()` from the online `spawnPowerPickup()` path.
2. Emit `"power-pickup"` from `collectPowerPickup()`.
3. Register a `game:bell-power-pickup` listener.
4. Update `recreatePowerPickups()`.

---

## Phase 9: Online Frontend — Shell Curl

**File:** `frontend/src/games/shell-curl/ShellCurlScene.ts`

Follow the same pattern, with collection occurring when the ball crosses a
pickup:

1. Use `setPickups()` from the online `spawnPowerPickup()` path.
2. Emit `"power-pickup"` from `collectPowerPickup()`, which is called from the
   ball update loop.
3. Register a `game:curl-power-pickup` listener.
4. Update `recreatePowerPickups()`.

---

## Phase 10: Validation

- Confirm that `git status` contains no unintended residual changes.
- Run `cd backend && npm run build` with no type errors.
- Run `cd frontend && npx tsc --noEmit` with no type errors.
- Validate each game manually with `make dev`: start an online match, confirm
  that pickups appear and can be collected, and confirm that the opponent sees
  the resulting state.

---

## Suggested Execution Order

1. Helper and types (Phases 1–2)
2. Bell Clash engine (Phase 4)
3. Kame Knock engine (Phase 3)
4. Shell Curl engine (Phase 5)
5. Gateway (Phase 6)
6. Bell Clash frontend (Phase 8)
7. Kame Knock frontend (Phase 7)
8. Shell Curl frontend (Phase 9)
9. Build and validation (Phase 10)
