# Shell Smash — Game Developer Guide

> Everything you need to build a new minigame for the Shell Smash hub — folder structure, shared APIs, arena systems, theming, powers, and a step-by-step checklist.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Creating a New Game — Step-by-Step](#2-creating-a-new-game--step-by-step)
3. [Shared Mechanics API Reference](#3-shared-mechanics-api-reference)
4. [Arena Systems](#4-arena-systems)
5. [Theme Tokens](#5-theme-tokens)
6. [Power System](#6-power-system)
7. [Depth Ordering Conventions](#7-depth-ordering-conventions)
8. [Resize Handling](#8-resize-handling)
9. [Backend / Hub API](#9-backend--hub-api)
10. [New Game Checklist](#10-new-game-checklist)

---

## 1. Project Structure

All source lives under `srcs/requirements/frontend/src/src/`. The layout below is the canonical structure — do not create top-level folders outside it.

```
src/
  main.ts                 ← scene registry (add your scene here)
  hub/
    HubScene.ts           ← hub map + HOTSPOTS array (register your door here)
    api.ts                ← REST helpers (getMe, submitScore, …)
  shared/
    theme.ts              ← THEME colour/font tokens (import everywhere)
    arenas/
      arena.ts            ← elliptical arena types + drawSumoRing
      arena01.ts          ← ARENA_01 definition (sumo ring)
      curl-sheet.ts       ← CURL_SHEET definition (ice sheet)
    mechanics/
      ball.ts             ← BallState/CurlingBallState, projectile physics and rendering
      slingshot.ts        ← Slingshot drag-to-launch controller
      turn-manager.ts     ← TurnManager turn-based state machine
      score-hud.ts        ← ScoreHud top-bar widget
      sweep-controller.ts ← SweepController sweeping boost mechanic
      power-system.ts     ← PowerType enum, PowerDef, PowerRegistry, ALL_POWERS
      hud.ts              ← buildReturnButton helper
      rect-arena.ts       ← RectArenaDef/Pixels, rectArenaToScreen, drawIceSheet
  games/
    bamboo-bash/          ← BambooBashScene + bamboo.ts
    shell-curl/           ← ShellCurlScene + PowerPicker.ts
    <your-game>/          ← create your folder here
```

> **Rule:** Keep all reusable logic in `shared/`. Game folders should only contain the scene file and game-specific helpers. Never import from one game folder into another.

---

## 2. Creating a New Game — Step-by-Step

### Step 1 — Create the game folder and scene file

Create `src/games/<your-game>/<YourScene>.ts`. Use this as a starting template:

```typescript
import Phaser from 'phaser';
import { THEME } from '../../shared/theme';
import { buildReturnButton } from '../../shared/mechanics/hud';

export class YourScene extends Phaser.Scene {
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'YourScene' }); }

  create(): void {
    this.cameras.main.setBackgroundColor(THEME.background);
    this.hudObjects = buildReturnButton(this);
    this.scale.on('resize', this.onResize, this);
  }

  shutdown(): void {
    this.scale.off('resize', this.onResize, this);
  }

  private onResize(): void {
    this.hudObjects.forEach(o => o.destroy());
    this.hudObjects = buildReturnButton(this);
  }
}
```

> **Always implement `shutdown()`** and unregister resize listeners there. Phaser reuses scene instances — leaked listeners cause double-update bugs.

### Step 2 — Register the scene in main.ts

Open `src/main.ts` and add your import and scene key:

```typescript
import { YourScene } from './games/your-game/YourScene';

new Phaser.Game({
  // ...
  scene: [AuthCallbackScene, HubScene, BambooBashScene, ShellCurlScene, YourScene],
});
```

> Scene order only matters for the first item (index 0 auto-starts). All others are started by key.

### Step 3 — Register the game in HubScene

Open `src/hub/HubScene.ts`. There are two places to update:

**3a. Add a HOTSPOT entry to the HOTSPOTS array:**

```typescript
{ id: 'your-game', label: 'Your\nGame', x: 0.65, y: 0.40, locked: false },
```

`x` and `y` are fractional positions (0–1) on the hub background image. Adjust to place the door where you want it on the map.

**3b. Add a case to the click-handler switch:**

```typescript
case 'your-game':
  scene.start('YourScene');
  break;
```

### Step 4 — Verify the TypeScript build

```bash
cd srcs/requirements/frontend/src
npx tsc --noEmit
```

Fix all type errors before committing. The CI pipeline blocks on `tsc` failures.

---

## 3. Shared Mechanics API Reference

### 3.1 `buildReturnButton` — `shared/mechanics/hud.ts`

Adds a "Return to Hub" button in the top-right corner. Returns the created GameObjects so you can reposition or destroy them on resize.

```typescript
function buildReturnButton(
  scene: Phaser.Scene,
  targetScene?: string  // default: 'HubScene'
): Phaser.GameObjects.GameObject[]
```

**Usage:**

```typescript
// create()
this.hudObjects = buildReturnButton(this);

// onResize()
this.hudObjects.forEach(o => o.destroy());
this.hudObjects = buildReturnButton(this);
```

---

### 3.2 `Slingshot` — `shared/mechanics/slingshot.ts`

Drag-to-launch controller. Player grabs the ball, pulls back, releases to fire. Scales automatically with `arena.scale` so game feel is consistent at any window size.

**`SlingshotConfig` properties:**

| Property | Type | Description |
|---|---|---|
| `maxDrag` | `number` | Maximum pull distance in canvas px. Multiply your source-px constant by `arena.scale`. |
| `launchSpeed` | `number` | Canvas px/s at full drag. Multiply your source-px constant by `arena.scale`. |
| `grabRadiusFactor?` | `number` | Grab zone = `ball.r × this`. Default `3.5`. |
| `depth?` | `number` | Render depth for the aim line graphics. Default `1`. |

**Usage:**

```typescript
const sling = new Slingshot(this, this.ball, {
  maxDrag:      MAX_DRAG_SRC     * arena.scale,
  launchSpeed:  LAUNCH_SPEED_SRC * arena.scale,
  depth: 2,
});
sling.attach();   // registers pointer handlers

// On resize:
sling.cancel();
sling.maxDrag     = MAX_DRAG_SRC     * newArena.scale;
sling.launchSpeed = LAUNCH_SPEED_SRC * newArena.scale;

// In shutdown():
sling.destroy();
```

---

### 3.3 `TurnManager` — `shared/mechanics/turn-manager.ts`

Serialisable turn-based state machine for 2-team games. `TurnState` is a readonly plain object — safe to spread, log, or send over WebSocket.

**`TurnState` shape:**

| Field | Type | Description |
|---|---|---|
| `currentTeam` | `0 \| 1` | Which team is throwing this turn. |
| `currentEnd` | `number` | 0-indexed end number. |
| `ballsLeft` | `[number, number]` | Balls remaining this end per team. |
| `score` | `[number, number]` | Cumulative score `[team0, team1]`. |
| `phase` | `TurnPhase` | `aiming \| sweeping \| settling \| scoring \| gameover` |
| `hasHammer` | `boolean` | True when the current team has the last-ball advantage. |

**Key methods:**

| Method | Description |
|---|---|
| `new TurnManager({ totalEnds, ballsPerTeam })` | Constructor. |
| `.state` | Read-only snapshot of current state. |
| `.setPhase(phase)` | Transition to a new `TurnPhase` without changing other state. |
| `.endEnd(team, pts)` | Award `pts` to `team` (or `null` for a blank end), advance to the next end, and reset `ballsLeft`. |
| `.nextThrow()` | Move to the next throw within the end (swaps `currentTeam` and decrements `ballsLeft`). |

---

### 3.4 `ScoreHud` — `shared/mechanics/score-hud.ts`

Top-bar widget showing both teams' scores and the current end. Ideal for turn-based games.

```typescript
import { ScoreHud } from '../../shared/mechanics/score-hud';

// create()
this.scoreHud = new ScoreHud(this, turnManager.state, {
  team0Label: 'Red', team1Label: 'Gold',
});

// update() — after state changes
this.scoreHud.update(turnManager.state);

// onResize()
this.scoreHud.rebuild();
```

---

### 3.5 `SweepController` — `shared/mechanics/sweep-controller.ts`

Lets players reduce friction on a moving ball by tapping or clicking during the sweeping phase.

| Export | Description |
|---|---|
| `SWEEP_THRESHOLD` | Minimum tap rate (taps/s) required for the friction bonus. |
| `SWEEP_FRICTION_MULT` | Per-frame friction multiplier while sweeping is active (`< 1` = less friction). |
| `new SweepController(scene, ball)` | Attach to one ball per turn. Listens for pointer events. |
| `.destroy()` | Remove listeners. Call at end of sweeping phase. |

---

### 3.6 Projectile physics — `shared/mechanics/ball.ts`

Used by the oval arena games and Shell Curl. The same module exposes the
elliptical arena ball helpers and the rectangular sheet curling-shell helpers.

| Export | Description |
|---|---|
| `BALL_SRC_R` | Reference radius in source px. Multiply by `arena.scale` for canvas px. |
| `stepBall(ball, delta, arena)` | Advance physics one frame. Returns `true` if ball is still moving. |
| `isBallMoving(ball)` | `true` when speed exceeds `MIN_SPEED`. |
| `drawShellBall(gfx, ball)` | Draw the decorative shell-pattern ball onto a `Graphics` object. |
| `CurlingBallState` | Extended ball state used by Shell Curl and replay rendering. |
| `stepCurlingBall(ball, delta, arena)` | Advance physics by one frame. Enforces the frozen-ball invariant. Returns `true` while moving. |
| `resolveCurlingBallCollision(a, b)` | Elastic collision. Treats frozen balls as infinite-mass walls. |
| `isBallOutOfBounds(ball, arena)` | `true` when a ball has left the sheet (always `false` for enclosed horizontal sheets). |
| `FRICTION_ICE = 0.990` | Default per-frame friction multiplier at 60 fps. |
| `BOUNCE_DAMP = 0.55` | Speed retention after wall bounce. |
| `DEFAULT_CURL_BIAS = 0` | Curl applied to plain balls. Override per ball for spin effects. |

---

## 4. Arena Systems

### 4.1 Elliptical Arena — `shared/arenas/arena.ts` + `arena01.ts`

Used by Bamboo Bash. Describes a sumo ring: an ellipse boundary with a central house target. Balls bounce off the ellipse wall.

| Export | Description |
|---|---|
| `ArenaDef` | Source-px geometry: `srcW, srcH, cx, cy, rx, ry, houseRadii[]`. |
| `ArenaPixels` | Same fields resolved to canvas pixels, plus `scale`. |
| `arenaToScreen(def, w, h)` | Letterbox-fit the def into the canvas. Call in `create()` and every `onResize()`. |
| `drawSumoRing(gfx, arena)` | Draw the ring boundary and house rings onto a `Graphics` object. |

**Pre-built definition:**

```typescript
import { ARENA_01 } from '../../shared/arenas/arena01';
const arena = arenaToScreen(ARENA_01, this.scale.width, this.scale.height);
```

---

### 4.2 Rectangular / Ice Sheet — `shared/mechanics/rect-arena.ts`

Used by Shell Curl. Describes a rectangular playing field with configurable orientation.

| Export | Description |
|---|---|
| `RectArenaDef` | Source-px geometry: `srcW, srcH, sheetX/Y/W/H, houseRadius, houseCentreOffset, orientation`. |
| `RectArenaPixels` | Canvas-pixel geometry. Includes `houseFarCX/Y`, `houseNearCX/Y`, `houseRadii[4]`, `deliveryX/Y`, `hogX/Y`, `scale`. |
| `rectArenaToScreen(def, w, h)` | Letterbox-fit the rect arena def. Call in `create()` and every `onResize()`. |
| `drawIceSheet(gfx, arena)` | Draw ice fill, pebble texture, house rings, hog lines, and hack mark. |
| `isBallInHouse(ball, arena)` | `true` when the ball is within the outermost house ring at the scoring end. |
| `distanceFromBallToHouseButton(ball, arena)` | Distance to the house button (use for scoring tie-breaks). |
| `isBallOutOfBounds(ball, arena)` | Horizontal sheets always return `false` (enclosed). Vertical sheets check the walls. |

**Orientation options:**

| Value | Behaviour |
|---|---|
| `'horizontal'` | The ball travels left → right. The right end is the scoring house. All four walls bounce. Used by Shell Curl. |
| `'vertical'` | The ball travels top → bottom. The bottom is the scoring house. The left and right walls bounce; the far end removes balls. |

**Pre-built definition:**

```typescript
import { CURL_SHEET } from '../../shared/arenas/curl-sheet';
const arena = rectArenaToScreen(CURL_SHEET, this.scale.width, this.scale.height);
```

---

### 4.3 Creating a Custom Arena Definition

All measurements are in source pixels at your chosen reference resolution (e.g. 1920 × 1080):

```typescript
// src/shared/arenas/my-arena.ts
import { RectArenaDef } from '../mechanics/rect-arena';

export const MY_ARENA: RectArenaDef = {
  srcW: 1920, srcH: 1080,
  sheetX: 120, sheetY: 100,
  sheetW: 1680, sheetH: 880,
  houseRadius: 200,
  houseCentreOffset: 360,
  orientation: 'horizontal',
};
```

> Keep all arena definitions in `shared/arenas/` so multiple games can reference them.

---

## 5. Theme Tokens — `shared/theme.ts`

Import `THEME` in every scene and component. Never hardcode colours inline.

```typescript
import { THEME } from '../../shared/theme';
```

| Token | Value | Usage |
|---|---|---|
| `THEME.background` | `0x1a1410` | Default scene background — very dark warm brown. |
| `THEME.red` | `0xa23b3b` | Primary accent — muted temple red. |
| `THEME.gold` | `0xd4a843` | Primary highlight — warm gold. Borders, active elements. |
| `THEME.green` | `0x3a5a40` | Secondary — dark forest green. |
| `THEME.redMuted` | `0x5a2424` | Locked/disabled state of red. |
| `THEME.goldMuted` | `0x6e5a2c` | Locked/disabled state of gold. |
| `THEME.greenMuted` | `0x223028` | Locked/disabled state of green. |
| `THEME.textMuted` | `0x6b6258` | Muted text (hex number, for `Graphics`). |
| `THEME.text` | `'#e6ddd0'` | Main body text (CSS string, for `Text` objects). |
| `THEME.textGold` | `'#d4a843'` | Gold text for scores/highlights (CSS string). |
| `THEME.textMutedHex` | `'#6b6258'` | Muted text (CSS string, for `Text` objects). |
| `THEME.font` | `'monospace'` | Font family for all `Text` objects. |

**Examples:**

```typescript
// Phaser Graphics (uses hex number)
gfx.fillStyle(THEME.gold, 1);
gfx.lineStyle(2, THEME.red, 0.9);

// Phaser Text (uses CSS string)
this.add.text(x, y, 'SCORE  0', {
  fontSize: '22px',
  color: THEME.textGold,
  fontFamily: THEME.font,
});
```

---

## 6. Power System — `shared/mechanics/power-system.ts`

### 6.1 Overview

The power system lets each game offer a subset of the built-in powers without re-implementing any physics. Each power is a `PowerDef` object — a collection of hooks called at the right points in the ball lifecycle.

### 6.2 `PowerType` enum

| Value | Effect |
|---|---|
| `PowerType.NONE` | Standard ball — no effect. |
| `PowerType.HEAVY` | Larger ball, harder to deflect. |
| `PowerType.BOMB` | Explodes on rest, pushing nearby balls outwards. |
| `PowerType.SPLITTER` | Splits into 3 child balls when its pickup is collected. |
| `PowerType.GHOST` | Passes through other balls without collision. |
| `PowerType.MAGNET` | Attracts nearby enemy balls while in motion. |
| `PowerType.SPINNING` | Strong curl bias — arcs dramatically across the sheet. |
| `PowerType.BOUNCER` | No speed loss on wall bounce (full elastic). |
| `PowerType.SHIELD` | If the ball rests inside the house, it becomes very hard to dislodge. |
| `PowerType.FREEZE` | Freezes any ball it collides with in place. |
| `PowerType.SLICK` | Near-frictionless — travels much further. |

### 6.3 `PowerDef` hooks

| Hook | Required | Description |
|---|---|---|
| `onApply(ball, arena)` | Yes | Called immediately on launch. Mutate ball properties (`r`, `frictionOverride`, `curlBias`, etc.). |
| `onUpdate?(ball, dt, arena)` | No | Called every frame while the ball is moving. Use for continuous effects (magnet pull, etc.). |
| `onCollide?(ball, other, arena)` | No | Called on first contact with another ball (before resolution). Use for Freeze, Ghost, and other collision-triggered powers. |
| `onStop?(ball, arena, all)` | No | Called once when the ball comes to rest. Use for Bomb explosion or Shield activation. |

### 6.4 Using powers in your game

```typescript
import {
  PowerRegistry, ALL_POWERS, PowerType,
} from '../../shared/mechanics/power-system';

// Pick which powers your game allows
const registry = new PowerRegistry([
  PowerType.HEAVY, PowerType.BOMB, PowerType.FREEZE,
]);

// Get the PowerDef for the player's chosen type
const def = registry.get(selectedType);

// On launch:
def.onApply(ball, arena);

// In update():
def.onUpdate?.(ball, delta, arena);

// After collision check:
def.onCollide?.(ball, other, arena);

// When the ball stops:
def.onStop?.(ball, arena, allBalls);
```

---

## 7. Depth Ordering Conventions

Phaser draws objects from lowest depth to highest. Follow this layer stack:

| Depth | Layer | Contents |
|---|---|---|
| 0 | Background | Scene background, tatami/ice fill, static decorations. |
| 1 | Arena | Ring/sheet markings. |
| 2 | Aim gfx | Slingshot aim line (`depth` param in `SlingshotConfig`). |
| 3 | Gameplay | Balls, bamboo, obstacles. |
| 4 | FX | Score pop-ups, hit flashes, particle effects. |
| 10 | Power UI | Power picker, turn indicator. |
| 20 | HUD | Score HUD bar, timer, return button. |
| 30 | Overlays | End-of-round result panel, game-over screen. |

> `buildReturnButton` uses depths 20–22 internally. `ScoreHud` uses depth 20. Keep overlays at depth 30+ so they cover everything.

---

## 8. Resize Handling

Phaser is configured with `Scale.RESIZE` — the canvas stretches to fill the window. Every scene must react to the resize event to keep gameplay elements correctly positioned.

The pattern is always the same:

1. Call `arenaToScreen` / `rectArenaToScreen` with the new canvas size.
2. Cancel any in-flight drag: `sling.cancel()`.
3. Update `sling.maxDrag` and `sling.launchSpeed` using the new `arena.scale`.
4. Reposition moving objects by carrying over their relative position:
   ```typescript
   const relX = (ball.x - oldArena.cx) / oldArena.rx;
   ball.x = newArena.cx + relX * newArena.rx;
   ```
5. Rescale velocities: `vx *= newArena.scale / oldArena.scale`.
6. Destroy and rebuild HUD: `buildReturnButton`, `scoreHud.rebuild()`.
7. Redraw all `Graphics` layers.

> Never store raw canvas-px positions as constants between frames. Always derive them from the current arena object.

---

## 9. Backend / Hub API — `hub/api.ts`

Thin REST wrappers for communicating with the backend.

| Method | Returns | Description |
|---|---|---|
| `api.getMe()` | `Promise<User>` | Returns `{ displayName, username, avatarUrl }`. Use in end screens to personalise results. |
| `api.submitScore(game, score)` | `Promise<void>` | Post a score for leaderboard tracking. `game` must match your game's ID string. |

**Pattern for end screens:**

```typescript
api.getMe()
  .then(me => nameText.setText(me.displayName ?? me.username ?? 'You'))
  .catch(() => { /* keep 'You' fallback */ });
```

---

## 10. New Game Checklist

- [ ] Created `src/games/<your-game>/<YourScene>.ts`
- [ ] Scene key set in constructor: `super({ key: 'YourScene' })`
- [ ] Registered in `main.ts` scene array
- [ ] HOTSPOT entry added in `HubScene.ts` HOTSPOTS array
- [ ] Click-handler case added in `HubScene.ts` switch
- [ ] `buildReturnButton` called in `create()` and rebuilt in `onResize()`
- [ ] `shutdown()` implemented — resize listener unregistered, slingshot destroyed
- [ ] `arenaToScreen` / `rectArenaToScreen` called in `create()` and `onResize()`
- [ ] `THEME` imported — no hardcoded colours anywhere
- [ ] All `Graphics` depth values follow the layer conventions in §7
- [ ] TypeScript check passes: `npx tsc --noEmit`
- [ ] Tested at multiple window sizes — layout stays correct on resize
