# Shell Curl — Implementation Prompt

## Context

This is a minigame for **Shell Smash** (ft_transcendence), a Phaser 3 Japanese-themed hub.

### Existing reusable mechanics (study before writing anything new)

| File | What it provides |
|---|---|
| `game/arenas/arena.ts` | `ArenaDef` → `ArenaPixels` letterbox transform, `isInsideArena`, `arenaEdgeFraction`, `drawSumoRing` |
| `game/mechanics/ball.ts` | `BallState`, `stepBall` (integrate + ellipse reflect + friction), `drawShellBall` |
| `game/mechanics/slingshot.ts` | `Slingshot` drag-to-launch controller with `onLaunch` callback |
| `game/mechanics/hud.ts` | `buildReturnButton` |
| `hub/theme.ts` | `THEME` palette (gold, red, green, text, font) |

### Architecture rules already established

- All physics is in **source-pixel space**, scaled by `ArenaPixels.scale` at render time.
- On resize: rescale positions proportionally, rescale velocities by `newScale / oldScale`, cancel in-flight inputs.
- Game objects are drawn with `Phaser.GameObjects.Graphics` (no external textures needed yet).
- All constants that feed into physics must be named constants — no magic numbers inline.
- Each mechanic goes in its own file under `game/mechanics/` so other minigames can import it.

---

## What to build

### Game: Shell Curl (`game/shell-curl/ShellCurlScene.ts`)

A two-player **curling** minigame where turtle shells are slid across an ice sheet toward a scoring target (the "house"). Teams alternate delivering shells; after all shells are delivered the score is counted and a new "end" begins. The game is designed for two players at the same machine (hot-seat), but the turn/input layer must be architected so network turns could be dropped in later.

---

## 1. New shared mechanics (reusable by other games)

### `game/mechanics/stone.ts`

Generalises `BallState` for a **rectangular ice sheet** with very low friction and a horizontal curl drift.

```typescript
export interface StoneState {
  id: number;
  teamId: 0 | 1;          // which team owns this stone
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;              // radius in canvas px
  power: PowerType;       // active power-up (see powers.ts)
  stopped: boolean;
  /** Set by PowerType.SPINNING — additional lateral drift multiplier */
  curlBias: number;       // positive = curves right, negative = left
}

// Constants (all in source px, scaled by arena.scale at call sites)
export const STONE_SRC_R   = 28;
export const FRICTION_ICE  = 0.9982;   // per-frame at 60 fps — very low friction
export const BOUNCE_DAMP   = 0.55;     // speed retained on sheet-wall bounce
export const MIN_SPEED_SRC = 4;

/**
 * Advance one stone one frame.
 * arena: RectArenaPixels (see below)
 * Returns true while the stone is still moving.
 */
export function stepStone(s: StoneState, deltaMs: number, a: RectArenaPixels): boolean

/**
 * Elastic circle-circle collision between two stones.
 * Call after stepStone for every pair — O(n²) is fine for ≤ 16 stones.
 */
export function resolveStoneCollision(a: StoneState, b: StoneState): void

/** Draw the stone at its current position. Style is determined by teamId + power. */
export function drawStone(g: Phaser.GameObjects.Graphics, s: StoneState, isActive: boolean): void
```

**Physics details:**

- Position integration: `x += vx * dt; y += vy * dt` (dt in seconds).
- Curl drift: each frame apply `vx += s.curlBias * speed * dt * CURL_STRENGTH_SRC` (perpendicular to velocity). Default `curlBias = 0.04` (slight natural drift), overridden by powers.
- Wall bounce: rectangular bounds — reflect the relevant velocity component off the long side-walls only (the far end and start end are out-of-bounds lines, not walls — stone stops / is removed when it crosses those).
- Stone-stone elastic collision: exchange velocity components along the collision normal (equal-mass model), then rescale for `STONE_BOUNCE_DAMP = 0.92`.
- Frame-rate independence: `Math.pow(FRICTION_ICE, deltaMs / 16.67)`.

**Rendering — `drawStone()`:**

Draw the stone purely with `Phaser.GameObjects.Graphics`:

- Drop shadow (semi-transparent ellipse, offset +3px right, +4px down).
- Main body: filled circle. **Team 0 = `0x2255cc` (deep blue), Team 1 = `0xcc2222` (deep red).**
- Shell-plate pattern: 5 overlapping arcs drawn with `beginPath / arc / strokePath` in a slightly darker shade to give a segmented shell look.
- Power badge: small filled circle at top-right of stone in the power's accent colour (skip if `PowerType.NONE`).
- Active stone indicator: when `isActive = true`, draw a pulsing outer ring (gold, `0xd4a843`, alpha 0.6, radius `r * 1.45`). The pulse is handled by the scene tween, not inside this function — the function just draws the ring at full alpha and the scene tweens the graphics object's alpha.

---

### `game/mechanics/rect-arena.ts`

A rectangular arena — same coordinate-system contract as `arena.ts` but axis-aligned.

```typescript
export interface RectArenaDef {
  srcW: number;     // source canvas width
  srcH: number;     // source canvas height
  // Sheet bounds in source px (the playfield rectangle, not the full canvas)
  sheetX: number;   // left edge of sheet
  sheetY: number;   // top edge of sheet
  sheetW: number;   // sheet width
  sheetH: number;   // sheet height
  // House (target circles) — one at each end
  houseRadius: number;    // outermost ring radius in source px
  houseCentreOffset: number;  // distance from sheet end to house centre (source px)
}

export interface RectArenaPixels {
  // All values in canvas px
  sheetX: number; sheetY: number; sheetW: number; sheetH: number;
  houseTopCX: number;    houseTopCY: number;    // house at delivery end (top)
  houseBottomCX: number; houseBottomCY: number; // scoring house (bottom)
  houseRadii: number[];  // [outer, mid, inner, button] ring radii in canvas px
  deliveryLineY: number; // Y threshold — stone must cross to count as delivered
  hogLineY: number;      // Y threshold — stone must clear hog line or is removed
  scale: number;
}

export function rectArenaToScreen(def: RectArenaDef, canvasW: number, canvasH: number): RectArenaPixels

export function isStoneInHouse(s: StoneState, a: RectArenaPixels): boolean
export function distanceToHouseButton(s: StoneState, a: RectArenaPixels): number
export function drawIceSheet(g: Phaser.GameObjects.Graphics, a: RectArenaPixels): void
```

**`drawIceSheet()` — pure Graphics:**

1. Background rectangle: `0x0a1f3f` (deep navy).
2. Full sheet fill: `0xcce8ff` (pale ice blue).
3. Side-wall lines: `0x4499cc`, stroke 2px.
4. Centre line (horizontal, through sheet mid-height): `0x4499cc`, alpha 0.4.
5. Hog lines: `0xcc4444` dashed lines at top and bottom of playing area.
6. Delivery hack marks: small `0xffffff` cross at each corner of the delivery zone.
7. House at scoring end: 4 concentric filled circles — outer `0xcc2222` (red), second `0xffffff`, third `0x2255cc` (blue), centre button `0xffffff`. Radii from `a.houseRadii`.
8. House at delivery end: same rings but half-opacity.
9. Japanese flair: subtle bamboo-grid overlay on the background outside the sheet (`0x0e2240`, step 64 src px, alpha 0.3).

---

### `game/mechanics/turn-manager.ts`

Reusable turn state machine. Used by Shell Curl; importable by any turn-based game.

```typescript
export type TurnPhase =
  | 'aiming'      // player is setting aim / power
  | 'sweeping'    // stone is in flight, player can sweep
  | 'settling'    // all stones decelerating, no input
  | 'scoring'     // end has finished, showing score
  | 'gameover';   // all ends played

export interface TurnState {
  currentTeam: 0 | 1;
  currentEnd: number;       // 0-indexed
  stonesLeft: [number, number]; // stones remaining for [team0, team1] this end
  score: [number, number];  // cumulative score across ends
  phase: TurnPhase;
}

export class TurnManager {
  constructor(opts: { totalEnds: number; stonesPerTeam: number })
  readonly state: TurnState
  nextThrow(): void          // advance to next player's turn
  endEnd(): void             // tally scoring, advance end, reset stonesLeft
  isGameOver(): boolean
  /** Who throws next? Alternates per throw; last-stone advantage: team that
      scored previous end throws last this end. */
  upNext(): 0 | 1
}
```

---

### `game/mechanics/power-system.ts`

The extension system. Other games that want power-ups import from here.

```typescript
export enum PowerType {
  NONE      = 'none',
  HEAVY     = 'heavy',      // very hard to deflect; slower
  BOMB      = 'bomb',       // explodes on stop: pushes all nearby stones outward
  SPLITTER  = 'splitter',   // splits into 3 smaller stones on first collision
  GHOST     = 'ghost',      // passes through first stone it hits
  MAGNET    = 'magnet',     // on stop, pulls all stones in house toward it
  SPINNING  = 'spinning',   // extreme curl drift — curves dramatically
  BOUNCER   = 'bouncer',    // reflects off side-walls with no damping (normal BOUNCE_DAMP still applies to end walls)
  SHIELD    = 'shield',     // immune to being pushed out of scoring zone — if would exit house, stops at edge instead
  FREEZE    = 'freeze',     // freezes the nearest enemy stone in place (it cannot be moved for the rest of the end)
  SLICK     = 'slick',      // reduces friction to near-zero; travels much further than normal
}

export interface PowerDef {
  type: PowerType;
  label: string;         // display name
  accentColour: number;  // badge colour on stone + HUD icon
  description: string;   // one-line tooltip shown in power picker
  /** Mutate stone properties on launch */
  onApply(stone: StoneState, arena: RectArenaPixels): void;
  /** Called every frame while stone is moving (optional) */
  onUpdate?(stone: StoneState, deltaMs: number, arena: RectArenaPixels): void;
  /** Called when this stone collides with another (optional) */
  onCollide?(stone: StoneState, other: StoneState, arena: RectArenaPixels): void;
  /** Called when stone comes to rest (optional) */
  onStop?(stone: StoneState, arena: RectArenaPixels, allStones: StoneState[]): void;
}

/** Registry — games add only the powers they want to offer */
export class PowerRegistry {
  register(def: PowerDef): void
  get(type: PowerType): PowerDef
  available(): PowerDef[]
}

export const ALL_POWERS: Record<PowerType, PowerDef>
```

**Implement all powers listed in the enum.** Full implementation notes:

- **HEAVY**: `onApply` → `stone.r *= 1.40`, increase `stone.curlBias` resistance (lower effective drift). Mass scales with `r²`; in `resolveStoneCollision` check if either stone is HEAVY and scale impulse by a `heavyMassRatio = 2.5` constant.
- **BOMB**: `onStop` → iterate `allStones`, compute distance; any stone within `BOMB_RADIUS_SRC * scale` gets a radial velocity impulse `BOMB_IMPULSE_SRC * scale`. Play a screen-shake tween (`scene.cameras.main.shake(300, 0.012)`). Draw an expanding orange ring overlay via a short-lived Graphics tween.
- **SPLITTER**: `onCollide` (first hit only; guard with a `hasSplit` flag on the stone) → remove original stone, spawn 3 `StoneState` objects with radii `stone.r * 0.65` at ±15° and 0° from the collision normal.
- **GHOST**: `onCollide` → skip `resolveStoneCollision` for the first collision (guard with `ghostUsed` flag); the stone passes through, then becomes NONE.
- **MAGNET**: `onStop` → for every other stone inside `MAGNET_RANGE_SRC * scale` of the house centre, gently slide them toward this stone's position (set small velocity `MAGNET_PULL_SRC * scale` toward magnet). Visualise with dotted lines from each affected stone to the magnet for 1.5 s.
- **SPINNING**: `onApply` → `stone.curlBias = 0.22` (≈5× normal). The stone will arc visibly. Show a spiral trail using a particle emitter (ice-blue dots, short lifetime).
- **BOUNCER**: in `stepStone` wall-bounce logic check for BOUNCER and skip the `BOUNCE_DAMP` factor.
- **SHIELD**: `onStop` (and each frame via `onUpdate`) → if stone would exit house ring, clamp its position to `houseRadii[0]` from house centre with zero velocity.
- **FREEZE**: `onCollide` → set `other.vx = other.vy = 0; other.stopped = true` on the first stone hit. Mark it with a blue ice-crystal overlay (drawn in `drawStone` when a `frozen` flag is set).
- **SLICK**: `onApply` → override `stone`'s per-frame friction multiplier to `FRICTION_SLICK = 0.9998` (near frictionless).

---

### `game/mechanics/sweep-controller.ts`

Handles the sweeping interaction during a stone's flight.

```typescript
/**
 * Tracks rapid pointer events. When the pointer moves quickly across the sheet
 * (swipe speed > SWEEP_THRESHOLD), it reduces the active stone's friction for
 * that frame — simulating broom sweeping.
 *
 * Attach during the 'sweeping' phase; detach on 'settling'.
 */
export class SweepController {
  constructor(scene: Phaser.Scene, stone: StoneState)
  attach(): void
  detach(): void
  /** Call each frame — returns the friction multiplier override for this frame */
  getSweepMultiplier(): number  // 1.0 normally, 0.9994 when actively sweeping
}
```

Rendering: when `getSweepMultiplier() < 1` draw a short white swipe trail at the pointer position (3–5 line segments fading out, lifetime 120 ms).

---

### `game/mechanics/score-hud.ts`

Reusable scoreboard widget.

```typescript
/**
 * Renders a persistent score strip at the top of the scene.
 * Works for any 2-team turn-based game.
 */
export class ScoreHud {
  constructor(scene: Phaser.Scene, depth: number)
  update(state: TurnState): void   // call whenever TurnState changes
  destroy(): void
}
```

Layout (all Graphics + Text, no images):
- Dark bar across the top: `0x0a1208`, height 52px, full width.
- Team 0 block (left): team colour circle + "KAME TEAM" label + score number.
- Centre: `END X / Y` text + current phase label.
- Team 1 block (right): mirror of left.
- Active indicator: gold underline below the current team's block.
- Stones-remaining row: draw `stonesLeft[i]` small coloured circles per team below the main bar.

---

## 2. Arena definition

### `game/arenas/curl-sheet.ts`

```typescript
export const CURL_SHEET: RectArenaDef = {
  srcW: 1920,
  srcH: 1080,
  sheetX: 560,
  sheetY: 40,
  sheetW: 800,
  sheetH: 1000,
  houseRadius: 180,
  houseCentreOffset: 120,
};
```

*(Source-pixel values — tune during implementation. The sheet is portrait-oriented in a landscape canvas, centred horizontally.)*

---

## 3. The scene: `game/shell-curl/ShellCurlScene.ts`

### Scene lifecycle

```
create()
  ├── build arena
  ├── instantiate TurnManager(totalEnds=3, stonesPerTeam=4)
  ├── instantiate PowerRegistry with ALL_POWERS
  ├── instantiate ScoreHud
  ├── build layer stack (bgLayer, stoneLayer, aimLayer, hudLayer)
  ├── spawn all 8 stones off-screen in a "waiting" pool
  ├── enter phase aiming for team 0, stone 0
  └── scale.on('resize', onResize)

update(time, delta)
  ├── if phase === 'sweeping'
  │     stepStone(activeStone, delta, arena)
  │     sweepController.getSweepMultiplier() applied
  │     resolveStoneCollision for all pairs
  │     applyPowerUpdates for each stone
  │     if allStonesStopped() → phase → settling → scoreEnd()
  └── if phase === 'settling' → wait for all stones stopped → scoreEnd()

shutdown()
  ├── scale.off('resize')
  ├── slingshot.destroy()
  ├── sweepController.detach()
  └── all layers cleared
```

### Turn flow

```
phase: aiming
  Player selects a power from the PowerPicker HUD (see below)
  Slingshot drag on the active stone
  onLaunch → power.onApply(stone) → ball.vx/vy set → sweepController.attach()
  phase → sweeping

phase: sweeping
  Stone is moving. Player can sweep (SweepController)
  When activeStone.stopped:
    sweepController.detach()
    Check for out-of-bounds (past far hog line → remove stone)
    phase → settling (brief pause to let all stones fully stop)

phase: settling
  Wait until all stones on sheet are stopped
  → scoreEnd() tallies points, animates scoring ring
  → if stonesLeft remain: nextThrow(), phase → aiming
  → else: endEnd(), show end-score overlay, then phase → aiming for new end

phase: gameover
  Show final scoreboard overlay with "Return to Hub" button
```

### Stone spawning / delivery

- All 8 stones (4 × team 0, 4 × team 1) are created at scene start and held in a `pool: StoneState[]`.
- On each turn, the active stone is placed at the delivery hack mark (top of sheet) with `vx = 0, vy = 0`.
- Stones that come to rest inside the scoring zone (house) remain on the sheet.
- Stones that pass the far hog line without entering the house are removed from the sheet.
- Any stone knocked fully outside the sheet side walls is also removed.

### Scoring

After all stones are delivered:
- Count all stopped stones inside `isStoneInHouse()`.
- The team with the stone **closest to the house button** scores 1 point per stone closer than the nearest opponent stone.
- `TurnManager.endEnd()` records the score.
- Animate: highlight the scoring stones with a gold glow tween.

---

## 4. Power picker HUD

### `game/shell-curl/PowerPicker.ts`

A horizontal row of power icons at the bottom of the screen, shown only during `phase === 'aiming'`.

```typescript
export class PowerPicker {
  constructor(scene: Phaser.Scene, registry: PowerRegistry, depth: number)
  show(availablePowers: PowerType[]): void
  hide(): void
  getSelected(): PowerType
  destroy(): void
}
```

Layout (pure Graphics + Text):
- Row of up to 5 power tokens, centred horizontally, 20px above bottom edge.
- Each token: 52×52px rounded rect, dark fill `0x0d1a0d`, border in power's `accentColour`, power icon drawn with Graphics (simple symbol), label text below.
- Selected token: gold border `0xd4a843`, slightly larger scale (1.12), accent fill at 20% opacity.
- Hover: pointer hand cursor, slight glow.
- `PowerType.NONE` is always the first slot ("No power" — grey border).
- Available powers are configured per-game by passing the desired `PowerType[]` subset.

**Default Shell Curl power set** (5 slots):
`NONE, HEAVY, BOMB, SPINNING, SLICK`

(The remaining powers are implemented but not offered in the default set — unlockable via future progression.)

---

## 5. Resize handling

All in `onResize()`:

```typescript
private onResize(): void {
  const oldArena = this.arena;
  this.arena = rectArenaToScreen(CURL_SHEET, this.scale.width, this.scale.height);

  const vScale = this.arena.scale / oldArena.scale;

  for (const stone of this.allStones) {
    stone.x = this.arena.sheetX + (stone.x - oldArena.sheetX) / oldArena.sheetW * this.arena.sheetW;
    stone.y = this.arena.sheetY + (stone.y - oldArena.sheetY) / oldArena.sheetH * this.arena.sheetH;
    stone.r = STONE_SRC_R * this.arena.scale;
    stone.vx *= vScale;
    stone.vy *= vScale;
  }

  this.slingshot.cancel();
  this.slingshot.maxDrag     = MAX_DRAG_SRC * this.arena.scale;
  this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;

  this.drawAll();

  this.scoreHud.update(this.turnManager.state);
  this.powerPicker.hide();
  if (this.turnManager.state.phase === 'aiming') this.powerPicker.show(DEFAULT_POWERS);

  this.hudObjects.forEach(o => o.destroy());
  this.hudObjects = buildReturnButton(this);
}
```

---

## 6. File layout

```
game/
  arenas/
    arena.ts          (existing)
    arena01.ts        (existing)
    curl-sheet.ts     (NEW — CURL_SHEET ArenaDef)
  mechanics/
    ball.ts           (existing)
    slingshot.ts      (existing)
    hud.ts            (existing)
    stone.ts          (NEW — StoneState, stepStone, resolveStoneCollision, drawStone)
    rect-arena.ts     (NEW — RectArenaDef, RectArenaPixels, drawIceSheet)
    turn-manager.ts   (NEW — TurnManager, TurnState, TurnPhase)
    power-system.ts   (NEW — PowerType, PowerDef, PowerRegistry, ALL_POWERS)
    sweep-controller.ts (NEW — SweepController)
    score-hud.ts      (NEW — ScoreHud)
  bamboo-bash/
    BambooBashScene.ts (existing)
  shell-curl/
    ShellCurlScene.ts  (NEW — main scene)
    PowerPicker.ts     (NEW — power selection widget)
```

---

## 7. Hub wiring

After the scene is built, wire it into the hub:

1. In `main.ts`, add `ShellCurlScene` to the Phaser `scene` array.
2. In `HubScene.ts`, the hotspot `shell-smash-arena` currently targets `'BambooBashScene'`. Add a new hotspot entry for `'shell-cards'` or whichever is the curl zone, pointing to `'ShellCurlScene'`.
3. The scene key must be `'ShellCurlScene'` so `buildReturnButton` (which calls `scene.scene.start('HubScene')`) stays compatible without changes.

---

## 8. Style & code standards

These apply throughout — do not deviate:

- **TypeScript strict mode**. All exported functions have explicit return types. All class fields are `private readonly` unless mutated. No `any` unless unavoidable (use `as unknown as T` with a comment).
- **No magic numbers** — every constant is a named `const` at the top of its file with a comment explaining its unit and purpose.
- **No commented-out code** in final commits. Deferred work gets a `// TODO(#N): description` referencing a tracking number.
- **Error handling on every external call** — not applicable to pure game-loop code, but any API call (e.g. returning to hub via scene.scene.start) should be wrapped defensively.
- **Reusability test**: `stone.ts`, `rect-arena.ts`, `turn-manager.ts`, `power-system.ts`, `sweep-controller.ts`, and `score-hud.ts` must have **zero imports from `shell-curl/`**. They are game-agnostic utilities.
- **Resize safety**: no hardcoded pixel positions. Everything derives from `arena.scale` or the current `scale.width / scale.height`.
- **Depth constants** (consistent with HubScene): `DEPTH_BG = 0`, `DEPTH_SHEET = 1`, `DEPTH_STONES = 2`, `DEPTH_AIM = 3`, `DEPTH_PARTICLES = 4`, `DEPTH_HUD = 20`, `DEPTH_OVERLAY = 100`.
- The `THEME` palette from `hub/theme.ts` is the source of truth for UI colours. Game-specific colours (ice blue, team colours) are defined as named constants in their own files, not in theme.ts.

---

## 9. Physics tuning guide

These source-pixel values give a satisfying curling feel at 1920×1080 source resolution. Scale all of them by `arena.scale` at runtime:

| Constant | Value | Notes |
|---|---|---|
| `FRICTION_ICE` | 0.9982 / frame at 60 fps | Stones travel ~60% of the sheet before stopping |
| `FRICTION_SLICK` (SLICK power) | 0.9998 | Near-frictionless, reaches far end reliably |
| `BOUNCE_DAMP` | 0.55 | Side-wall bounces kill significant speed |
| `STONE_BOUNCE_DAMP` (stone-stone) | 0.92 | Stone-on-stone retains most speed |
| `MIN_SPEED_SRC` | 4 px/s | Stop threshold |
| `CURL_STRENGTH_SRC` | 0.018 | Default lateral drift per frame |
| `LAUNCH_SPEED_SRC` | 820 px/s | Full-drag launch (lower than bamboo-bash — ice, not a slingshot) |
| `MAX_DRAG_SRC` | 280 px | Max pull distance |
| `BOMB_RADIUS_SRC` | 160 px | Explosion push radius |
| `BOMB_IMPULSE_SRC` | 380 px/s | Radial velocity added to pushed stones |
| `MAGNET_RANGE_SRC` | 220 px | Range within which magnet attracts |
| `MAGNET_PULL_SRC` | 55 px/s | Attraction velocity |
| `SWEEP_FRICTION_MULT` | 0.9994 | Friction while sweeping (replaces FRICTION_ICE that frame) |
| `SWEEP_THRESHOLD` | 280 px/s | Pointer speed required to trigger sweep |
| `HEAVY_MASS_RATIO` | 2.5 | Mass scale for HEAVY stone in collision impulse |

---

## 10. Extra design ideas (implement or stub as `TODO`)

These are out of scope for the first pass but should be stubbed with `TODO(#N)` so the architecture supports them:

- **End advantage**: Last hammer (last stone of the end) goes to the team that did NOT score the previous end. `TurnManager` already supports this via `upNext()`.
- **Skip's call**: Before aiming, a brief "strategy phase" where both players can see all stones and the active player gets 5 s to decide. Timer HUD strip.
- **Spectator mode**: A third "camera" scene that replays the last shot in slow motion with a trail visualisation.
- **Network play**: `TurnManager` is stateless-serialisable — `TurnState` can be sent over a WebSocket. The input layer (Slingshot, SweepController) is separated from physics, so local and remote inputs both call the same `stepStone` function.
- **Progressive power unlock**: Powers unlock as players reach certain XP thresholds (from the profile system already in place). `PowerRegistry.available()` can filter against the user's level.
- **Animated stone delivery**: Tween the stone from the hack to the delivery line over 400 ms before transferring control to the player, to make the start of each shot feel grounded.
- **Crowd cheering SFX slot**: `scene.sound.play('crowd-cheer')` stubs with `// TODO(#audio)` — wire up when sound assets are available.
