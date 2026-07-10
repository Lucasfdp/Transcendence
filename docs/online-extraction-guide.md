# Online logic extraction guide

This guide documents the repeatable steps used to extract the online /
multiplayer logic of a game scene into a companion **online controller
class**, as performed for `kame-knock`. Apply the same pattern to the
remaining games (`bamboo-bash`, `bell-clash`, `shell-curl`) when resuming.

The goal is to keep each scene focused on offline gameplay and rendering,
while a single composed controller owns the matchmaking state, socket wiring,
remote-ball synchronisation and network input emission.

---

## 1. Create the controller file `XxxOnline.ts`

Create `frontend/src/games/<game>/XxxOnline.ts` next to the scene.

### 1.1 Types and guard

- Move the per-game `OnlineBallState` interface here (it extends `BallState`
  with optional `scale`, `alpha`, `power`, `trail`, `stateFlags`).
- Move the `isXxxSnapshot(snapshot)` type guard here.

### 1.2 The scene contract interface

Define `XxxOnlineScene` describing the minimal surface the controller needs
from the owning scene. Keep it small: only what the controller reads or
writes. Typical members:

- State the controller mutates: `arena`, `ball`, `playerShellSkins`,
  `ballTrails`, `powerBalls`, `launchedThisBall`, `running`, `activePower`,
  `powerSidePanel`, `ballText`, `score`, `localPlayerCount`, `currentBallIndex`,
  `nextTargetId`, and a `targets` get/set accessor.
- A helper the controller calls to clear power-ball textures and return the
  new texture count: `clearPowerBalls(): number`.
- Rendering callbacks the controller triggers: `drawTargets()`, `drawBall()`,
  `updateScoreHud()`, `updateSidePanels()`, `showPowerPanel()`,
  `isBallMoving(ball)`, `syncSlingshotForTurn()`, `showOnlineEndScreen(snapshot)`.
- `syncSlingshotForTurn()` and `showOnlineEndScreen()` stay on the scene
  because they touch scene-only state (`launchInput`, `overlay`,
  `powerSidePanel`); the controller only calls back into them.

### 1.3 The controller class

`export class XxxOnlineController`:

- Constructor receives `scene: Phaser.Scene & XxxOnlineScene` and stores it.
  Type the scene as the **intersection** so Phaser members (`add`, `scale`,
  `tweens`, `time`, `registry`) are available without adding them to the
  interface.
- Hold all online state privately: `match: OnlineMatchContext | null`,
  `lastSeq`, `balls` (a `Map`/`WorldMapRuntime`), `pendingTargetHits`,
  `replayThrower`, `replayTurnNumber`, `settledSubmitted`, `releasePending`,
  `visibleBallSide`, plus the online status `Text` and countdown `Text`.
- Expose public getters the scene consults in its offline/online branches:
  `isActive`, `snapshot`, `side`, `spectator`, `ballMap` (read-only view of
  `balls`), `currentTurn`, `snapshotScore`, `snapshotRoundNumber`,
  `snapshotTurnNumber`, `replaySide`, `replayTurn`, `releasePendingFlag`,
  `visibleSide`.
- Implement the network methods: `bindFromRegistry()`, `init()`, `shutdown()`,
  `applyInitialSnapshot()`, socket handlers `handleState` / `handleThrow` /
  `handlePowerPickup`, `createStatusText()`, `updateStatus()`,
  `repositionStatus()`, `markAway()`, `applyOnlineSnapshot()`,
  `startOnlineCountdown()` + `beginOnlinePlay()`, `playOnlineThrow()`,
  `reportTargetHit()`, `emitRelease()`, `onLocalBallSettled()`,
  `isLocalTurn()`, `ballForOnlineSide()`, `syncBalls()`, `resetBallForPlayer()`,
  `resetOnlineBall()`, `formatBallText()`.

---

## 2. Refactor the scene

### 2.1 Imports and declaration

- Import the controller, `OnlineBallState` and `XxxOnlineScene` from
  `./XxxOnline`.
- Remove the local `OnlineBallState` and `isXxxSnapshot` definitions.
- Change the class header to
  `export class XxxScene extends ResponsiveScene implements XxxOnlineScene`.

### 2.2 Compose the controller

- Add `private readonly online: XxxOnlineController;` and assign it in the
  constructor body: `this.online = new XxxOnlineController(this);`.
- Remove the inline online state fields (`onlineMatch`, `lastOnlineSeq`,
  `onlineStatusText`, `pendingOnlineTargetHits`, `onlineReplayThrower`,
  `onlineReplayTurnNumber`, `onlineSettledSubmitted`, `onlineReleasePending`,
  `visibleBallSide`) and any online `WorldMapRuntime` of balls.
- Make every interface-required member **public** (drop the `private`
  modifier): `arena`, `ball`, `playerShellSkins`, `launchedThisBall`,
  `running`, `activePower`, `powerSidePanel`, `ballText`, `score`,
  `localPlayerCount`, `currentBallIndex`, `nextTargetId`, `ballTrails`,
  `powerBalls`, and the `targets` get/set accessor.
- Add the public `clearPowerBalls(): number` method (wraps the existing
  `clearXxxPowerBalls(this, this.powerBalls, this.powerBallTexCount)` call).

### 2.3 Remove socket-handler fields

Delete the inline arrow fields `handleOnlineState` / `handleOnlineThrow` /
`handleOnlinePowerPickup` — they now live in the controller.

### 2.4 Delegate from lifecycle and gameplay

Replace the inline online logic with controller calls:

- `localReplay` `shouldSkip`: `() => !this.online.isActive`.
- `create()`: replace the registry read, state reset, initial snapshot,
  `initOnlineMatch()` and `startOnlineCountdown()` with
  `this.online.bindFromRegistry()`, `this.online.applyInitialSnapshot()`
  (guarded by `this.online.snapshot`), `this.online.init()`,
  `this.online.createStatusText()`, and
  `this.online.startOnlineCountdown()` when `snapshot.phase === "active"`.
- `cleanupSceneResources()`: call `this.online.shutdown()`.
- `update`: gate local-replay capture with `!this.online.isActive`.
- `onLaunch` online branch → `this.online.emitRelease({ ... })`.
- `resolveStopBomb` / `resolveStopRepel` online branches →
  `this.online.reportTargetHit(target, 1, false)`.
- `currentPlayerIndex` online branch → `this.online.currentTurn`.
- `checkTargetHits` online branch → `this.online.reportTargetHit(...)`.
- `finishBallRound` online branch →
  `this.online.onLocalBallSettled(this.activeBall())`.
- `showPowerPanel` online guard → `this.online.isActive` and
  `this.online.releasePendingFlag`.
- `buildHud` / `relayout` `markOnlineAway()` → `this.online.markAway()`.
- `hudPlayerLabel` online players → `this.online.snapshot?.players`.
- `buildGameRuleHooks` `onRelease` capture → `!this.online.isActive`.
- `currentScoresForRules` / `currentScores` / `buildTurnDots` /
  `currentTurnPhase` / `formatBallText` online branches → use
  `this.online.isActive`, `this.online.snapshotScore`, `this.online.currentTurn`.
- `activeBall` online branch → delegate to
  `this.online.ballForOnlineSide(side)`.
- `drawBall` / `recordBallTrails` / `drawBallTrails` online branches →
  `this.online.isActive` and `this.online.ballMap`.
- `relayout` online branch → `this.online.ballMap` and
  `this.online.repositionStatus(...)`.

### 2.5 Delete migrated methods

Remove these methods from the scene (they now live in the controller):

`initOnlineMatch`, `startOnlineCountdown`, `beginOnlinePlay`,
`createOnlineStatusText`, `updateOnlineStatus`, `markOnlineAway`,
`applyOnlineSnapshot`, `playOnlineThrow`, `reportOnlineTargetHit`,
`syncOnlineBalls`, `resetBallForPlayer`, `resetOnlineBall`,
`ballForOnlineSide`, `onlineRoundNumber`, `onlineTurnNumber`.

Keep and adapt: `syncSlingshotForTurn()` (delegate the condition to
`this.online.isActive` / `this.online.isLocalTurn()` / `this.online.releasePendingFlag`
and keep the `launchInput.attach()/destroy()`), `isLocalOnlineTurn()`
(return `this.online.isLocalTurn()`), and `showOnlineEndScreen()` (rewrite to
read `this.online.side` instead of `this.onlineMatch.side`).

---

## 3. Controller gotchas

- **Import `PowerType` as a value**, not `import type`, whenever it is used as
  a value (`PowerType.NONE`, `Object.values(PowerType)`). The scene already
  imports it normally; the controller must do the same.
- **Type the scene as `Phaser.Scene & XxxOnlineScene`** in the controller so
  `scene.add`, `scene.scale`, `scene.tweens`, `scene.time` and
  `scene.registry` resolve without polluting the interface.
- **Access getters without parentheses**: `this.snapshotRoundNumber`,
  `this.snapshotTurnNumber`, `this.replayTurn`, `this.currentTurn`, etc. Using
  `()` on a `get` accessor is a compile error.
- Keep `showOnlineEndScreen` and `syncSlingshotForTurn` on the scene and call
  them through the interface; they own scene-only state.

---

## 4. Verify

Type-check the frontend (the repo `tsconfig` sets `ignoreDeprecations: "6.0"`,
which is invalid for the installed TypeScript 5.9, so override it):

```bash
cd frontend
npx tsc --noEmit --ignoreDeprecations 5.0
```

Confirm there are **no errors** in the two touched game files
(`XxxScene.ts` and `XxxOnline.ts`). Any other reported errors are pre-existing
in unrelated files and outside the scope of this extraction.

The project builds with Vite/esbuild, which does not type-check, so a clean
`tsc` pass is the authoritative correctness check for the refactor.

---

## Checklist per game

- [ ] `XxxOnline.ts` created with `OnlineBallState`, `isXxxSnapshot`,
      `XxxOnlineScene`, `XxxOnlineController`.
- [ ] Scene `implements XxxOnlineScene`; interface members made public.
- [ ] `online` field composed and assigned in constructor.
- [ ] Online state fields and `WorldMapRuntime` of balls removed from scene.
- [ ] All `this.onlineMatch` branches routed through `this.online.*`.
- [ ] Migrated methods removed from scene; `syncSlingshotForTurn`,
      `isLocalOnlineTurn`, `showOnlineEndScreen` kept and adapted.
- [ ] `clearPowerBalls()` added to scene.
- [ ] `tsc --noEmit` clean for the game files.
