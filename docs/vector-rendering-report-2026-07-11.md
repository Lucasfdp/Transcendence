# Vector Rendering Report — Inventory & Reduction Options (2026-07-11)

Audience: the game/frontend team. Purpose: document how much of the codebase draws vectors at runtime, why it matters for performance (see the Bamboo Bash jitter), and a tiered set of options — from free wins to a full art pass — for reducing runtime vector drawing.

## 1. Inventory — where vector drawing lives today

### Phaser game layer (the bulk of it)

- **17 of ~37** game/scene/UI files use Phaser's `Graphics` API (runtime vector primitives).
- **267 vector draw calls** total across the frontend (`fillCircle`, `fillRect`, `fillRoundedRect`, `fillTriangle`, `strokePath`, `lineTo`, `arc`, …).
- **88 `.clear()` sites across 25 files** — the dominant pattern is *clear-and-redraw every frame*.
- **Zero `generateTexture()` calls** anywhere in the codebase — vectors are never baked to textures.
- Raster usage in the game layer is thin: only `frontend/src/shared/mechanics/player-renderer.ts` places textures via `add.image` (turtle/shell skins), and there are ~10 `load.image`/`load.spritesheet` calls total.

Files using `Graphics`:

| Area | Files |
| --- | --- |
| Game scenes | `games/bamboo-bash/BambooBashScene.ts`, `games/bell-clash/BellClashScene.ts`, `games/kame-knock/KameKnockScene.ts`, `games/shell-curl/ShellCurlScene.ts`, `games/shell-curl/PowerPicker.ts`, `games/shared/ReplayScene.ts`, `features/hub/ShellPickerScene.ts` |
| Shared in-game UI | `shared/mechanics/score-hud.ts`, `round-overlay.ts`, `game-end-modal.ts`, `slingshot.ts`, `sweep-controller.ts`, `shared/ui/panels/side-panel.ts`, `shared/ui/panels/GameInfoSidePanel.ts`, `shared/achievement-popup.ts`, `shared/card-drop-popup.ts` |
| Backgrounds | `shared/drawBackground.ts` (mountains, mist, path, torii, lanterns, petals — all procedural) |

Per-frame clear-and-redraw hot spots (the performance-relevant subset): `shared/mechanics/ball.ts`, `player-trails.ts`, `rect-arena.ts`, `power-pickups.ts`, `sweep-controller.ts`, `slingshot.ts`, the `*View.ts` files of all four games (`BambooBashView`, `BellClashView`, `KameKnockView`, `ShellCurlView`), `games/common/runtime/WorldRuntime.ts`, `ArenaBallTrailRuntime.ts`, and `ReplayScene.ts`.

### React UI layer (mostly not vector)

- Inline SVG in exactly **2 components**: `components/auth/OAuthButtons.tsx` and `components/casino/FortuneWheelModal.tsx` (the wheel).
- **1 SVG asset**, the Google OAuth provider logo in `public/assets/oauth/`; the 42 mark is rendered inline.
- Everything else is CSS + ~111 PNG assets (7 TSX files use `<img>`).
- One outlier: `components/casino/board-canvas.ts` draws the casino board programmatically on a 2D canvas (vector-style path drawing, not SVG).

**Summary:** within game rendering code, runtime vector drawing is the dominant technique; codebase-wide it is a small slice (backend and most React UI don't draw at all). This report's options concern the Phaser layer only — the React/SVG usage is negligible and fine as-is.

## 2. Why this matters

Every `Graphics` object that is cleared and redrawn per frame forces Phaser's WebGL renderer to re-tessellate the geometry and breaks sprite batching — each dynamic `Graphics` layer is effectively its own draw call with CPU-side geometry work every frame. Sprites/images from a shared texture, by contrast, batch into a handful of draw calls. With four games all following the clear-and-redraw pattern for balls, trails, targets, pickups, and arenas, this is a plausible contributor to the jitter observed on Bamboo Bash (commit `2eaf3587` — "Extracted bamboobash but there are a lot of jitter").

Caveat: rendering is not the only jitter candidate — physics stepping and online state sync are on the suspect list too. See §4 for the measure-first guidance.

## 3. Options, ordered by severity

### Tier 0 — Redraw discipline (no visual change; days)

Keep all vectors but stop redrawing what didn't change:

- Split each scene's `Graphics` into a **static layer** (arena bounds, background, panel chrome — drawn once, redrawn only on resize) and a **dynamic layer** (ball, aim line, trails).
- Add dirty flags so `score-hud`, `side-panel`, and `GameInfoSidePanel` redraw only on state change, not per frame.

This alone usually removes most Graphics-related frame cost. No art skills, no asset changes, mechanically low-risk.

### Tier 1 — Bake vectors to textures at boot (low severity; art-identical)

Draw each repeated shape **once** into a texture during scene `create()` via `Graphics.generateTexture()` (or a `RenderTexture`), then render entities as `add.image`/sprites:

- Candidates: balls, shells, targets, pickups, bells, bamboo segments, lanterns, rounded-rect panels.
- Trails: stamp a fading circle sprite into a `RenderTexture` instead of re-stroking the full path each frame (`player-trails.ts`, `ArenaBallTrailRuntime.ts`, KameKnock trail gfx).

Art remains procedurally generated (no asset pipeline changes), sprites batch, and the codebase currently uses this technique nowhere — it is the single biggest untapped lever.

### Tier 2 — Pre-rendered images for static scenery (medium)

- Export the `drawBackground.ts` scenes (mountains, mist, path, torii, petals) as layered PNGs — the project already has a PNG asset pipeline with git LFS — keeping only lightweight tweened sprites for animated bits (petal drift, mist).
- Replace HUD/panel chrome with Phaser's `NineSlice` game object, mirroring the `NineSliceButton` pattern already used in the React UI.

Eliminates the largest single vector file (`drawBackground.ts`) entirely. Cost: asset exports, slightly larger repo/LFS.

### Tier 3 — Atlas-based entity rendering (high)

Move dynamic entities to sprite sheets / a texture atlas (TexturePacker or similar). Keep `Graphics` only for genuinely dynamic geometry that cannot be pre-baked: slingshot aim line, sweep indicator, debug overlays.

- Restores full batching and enables real animation frames.
- Cost: introduces an asset-tooling step and touches every game's view layer (`*View.ts`, `WorldRuntime.ts`, `player-renderer.ts`).

### Tier 4 — Full art pass (highest)

Eliminate runtime vector drawing everywhere except debug: drawn/commissioned assets for all entities, backgrounds, and UI, loaded from atlases.

- Biggest visual-quality and performance ceiling.
- Cost: weeks of work across all four games; every future visual tweak becomes an asset edit rather than a code change; LFS grows.

## 4. Recommendation

Do **Tier 0 and Tier 1 together**: they are mostly mechanical, need no art skills, and directly target the per-frame clear-and-redraw hot spots listed in §1. Then **measure before going further**: profile `BambooBashScene` with `game.loop.actualFps` plus Chrome's performance profiler, comparing before/after. If jitter survives Tier 0/1, the cause is more likely physics stepping or online state sync than rendering — investigate there before spending on Tier 2+.

Tier 2 is worth doing opportunistically for visual polish regardless of performance. Tiers 3–4 are art-direction decisions, not performance necessities, and should be scheduled only if the team wants the visual upgrade.

## 5. Verification commands

Reproduce the inventory numbers:

```bash
# Files using Phaser Graphics
grep -rln "add\.graphics\|make\.graphics" frontend/src --include=*.ts --include=*.tsx

# Vector draw-call count
grep -rno "fillCircle\|fillRect\|fillTriangle\|fillRoundedRect\|strokeCircle\|strokeRect\|strokeRoundedRect\|strokePath\|lineBetween\|lineTo\|moveTo\|fillPoints\|strokePoints\|arc(" frontend/src --include=*.ts | wc -l

# Per-frame redraw sites
grep -rn "\.clear()" frontend/src/games frontend/src/shared --include=*.ts | grep -v test | wc -l

# Confirm generateTexture is unused
grep -rln "generateTexture" frontend/src --include=*.ts
```
