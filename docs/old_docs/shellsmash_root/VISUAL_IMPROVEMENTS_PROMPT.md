# Shell Smash — Visual Improvements Spec

## Context

You are working on a Phaser 3 game called **Shell Smash** — a Japanese-themed
dojo hub where players navigate a night-sky map to launch mini-games. The main
files are:

- `srcs/requirements/frontend/src/src/hub/HubScene.ts` (879 lines) — scene,
  background, hotspots, HUD, leaderboard, modal, resize system
- `srcs/requirements/frontend/src/src/hub/ProfilePanel.ts` (343 lines) — player
  profile overlay drawn entirely with Phaser Graphics primitives
- `srcs/requirements/frontend/src/src/hub/theme.ts` — colour constants

The palette (`THEME`) is: background `#1a1410`, gold `#d4a843`, red `#a23b3b`,
green `#3a5a40`, muted text `#6b6258`, text `#e6ddd0`. All font is `monospace`.

The canvas uses `Phaser.Scale.RESIZE` — `this.scale.width/height` are live.
Letterbox transform: `bgScale = Math.min(w/SRC_W, h/SRC_H)`, offsets `bgOffX`
/ `bgOffY`. A `handleResize()` → `applyResize()` pattern redraws every layer
on window resize; layers are arrays of `GameObject[]` cleared with
`clearLayer()` before redraw.

Read both files in full before making any changes.

---

## What needs improving — implement ALL of the following

### 1. Background — Fix letterbox + restore trees + add depth layers

**Problem:** The current letterbox uses `Math.min(sx, sy)` (fit-inside), so
on wide viewports the top/bottom show raw black. The tree guard clips trees
off the bottom edge. The overall scene has no foreground depth.

**Fix the letterbox to cover-and-crop:**

```typescript
// Instead of Math.min, use Math.max so the image always covers the canvas.
// Then clip: set a rectangular mask on bgImage equal to canvas bounds.
this.bgScale = Math.max(width / SRC_W, height / SRC_H);
// bgOffX / bgOffY can go negative (image larger than canvas = cropped edges)
this.bgOffX = (width - SRC_W * this.bgScale) / 2;
this.bgOffY = (height - SRC_H * this.bgScale) / 2;
```

Apply this same change inside `applyResize()`. Remove the tree bounds guard
(it is no longer needed because the image fills the canvas).

**Add depth layers to `drawBackground()`** (all added to `bgLayer`):

1. **Mountain silhouettes** — draw two overlapping dark-indigo filled polygons
   behind the trees representing distant peaks. Colour `0x1a1a3a` at ~35%
   alpha. Span the full canvas width. Height: ~30–40% of canvas from bottom.

2. **Stone path** — a narrow quadrilateral (trapezoid) of `0x2a2218` starting
   ~65% down the canvas, widening toward the bottom centre. Draw it ABOVE the
   mountain layer.

3. **Hanging stone lanterns** — draw 3–4 procedural lanterns spaced along the
   upper portion of the canvas. Each lantern:
    - A thin vertical rope line from top of canvas
    - A small oval body (`0x8b4513`, warm orange) with a glowing fill
      (`0xff8c00` at 30% alpha inside)
    - A `0xff6600` point light glow using `this.add.pointlight()` (radius ~60,
      intensity ~0.4) to cast warm light downward

4. **Restore blossom trees** without the bounds guard — the cover-and-crop
   letterbox means the canvas is always fully covered.

---

### 2. Hotspot buttons — Replace flat rectangles with shrine-marker frames

**Problem:** The buttons are plain dark rectangles. They need Japanese shrine
aesthetics.

In `buildHotspots()`, for each hotspot zone, replace the current rectangle
border/label with:

**Frame style:**

- Outer border: 2px gold stroke (`THEME.gold`) with rounded corners (radius 6)
- Inner fill: `0x1a1005` at 85% alpha — dark lacquered wood look
- A thin inner accent border 3px inset: `THEME.gold` at 15% alpha

**Zone icon** (drawn in top-left corner of each button, 18×18 area):
Map each `id` to a small icon drawn with Graphics:

- `kame-knock` → a small shield / torii arch outline
- `river-rush` → a wave (two small arc strokes)
- `bamboo-bash` → three vertical lines (bamboo stalks)
- `oni-dodge` → a small horned circle (oni mask)
- `sakura-sweep` → a 5-petal flower (5 small ellipses arranged radially)
- `bell-clash` → a small bell outline (rounded trapezoid with curved top)
- `shell-cards` → a small rectangle with corner pip (card shape)

**Locked/coming-soon state:**
When a minigame's `status !== 'available'`, overlay a translucent red `0x330000`
fill at 60% alpha over the button and add a small padlock icon (draw a
rectangle body + small arc at top) centred in the zone. The zone label gets
`THEME.textMutedHex` colour instead of gold.

**Hover:**
On `pointerover`, the border colour shifts to full white `0xffffff` and a
radial gradient glow (drawn on `glowGfx`) fans out 24px beyond the zone bounds.
The zone-specific accent colour (use gold for available, red for locked) tints
the glow.

---

### 3. Profile Panel — Make it feel like a dojo record

**File:** `ProfilePanel.ts`

Make the following additions/changes to `build()`:

**A. Win-rate bar** — below the stats row, add a single horizontal bar that
splits proportionally: gold segment = wins / played, red segment = losses /
played, grey = remainder. Label it "WIN RATE XX%" right-aligned. Skip if
`gamesPlayed === 0` and show the italic placeholder instead.

**B. Rank belt** — above the player name, add a small coloured sash/badge that
maps level to a rank:

```
1–4   → "Novice Shell"      colour 0x8b7355  (tan)
5–9   → "Bronze Claw"       colour 0xcd7f32  (bronze)
10–19 → "Silver Fang"       colour 0xc0c0c0  (silver)
20–29 → "Gold Shell"        colour 0xd4a843  (gold)
30+   → "Grand Kame"        colour 0x00e5ff  (cyan)
```

Draw it as a small pill (rounded rectangle) with the rank text inside, centred
below the avatar frame, above the player name.

**C. Shell skin icon** — replace the `⬡  kanagawa` text with a small drawn
hexagon in the skin's accent colour next to the skin name. Map skin names to
colours:

- `kanagawa` → `0x1a3a5c`
- `dragon` → `0x8b0000`
- `bamboo` → `0x2d5a1b`
- default → `THEME.gold`

**D. Slide-in animation** — change `show()` so the container starts at
`x - 30` and tweens to its final position simultaneously with the alpha fade,
giving a smooth slide-in from the left. `hide()` slides back out.

**E. Panel height** — increase `PH` from 490 to 540 to accommodate the new
win-rate bar and rank belt without crowding.

---

### 4. HUD bar — Tighten and add XP ring

In `drawHUD()`:

**A. Avatar ring** — instead of a plain filled circle, draw the avatar as:

- Dark fill circle (existing)
- An XP progress arc around the outside: draw a `Graphics.strokeArc()` from
  `-Math.PI/2` to `-Math.PI/2 + 2π * xpFraction` in gold, lineWidth 3.
  This replaces the separate XP bar below the avatar line.

**B. Remove the standalone XP bar line** from the HUD (the one that reads
`0 / 1000 XP`) — the ring communicates XP visually. Keep only the
`Lvl N · Shell: skin` subtitle.

**C. Pulse on new state** — when `drawHUD()` is called and the user is logged
in, run a single one-shot tween on the avatar ring that briefly scales to 1.08
and back, to draw the eye on first render.

---

### 5. Cross-cutting requirements

- All new `Graphics` objects created inside `drawBackground()` / `buildHotspots()`
  / `drawHUD()` / `drawLoginPrompt()` must be pushed into the appropriate layer
  array (`bgLayer`, `hotspotLayer`, `hudLayer`, `promptLayer`) so `clearLayer()`
  destroys them correctly on resize.
- `ProfilePanel` changes do NOT use layer arrays — the container is stable and
  rebuilt only when the panel is constructed.
- No new image assets are required — all art is procedural `Graphics` primitives.
- All font sizes continue to go through `scaledFont(basePx)` (caps at
  `bgScale = 1.0`).
- Run `tsc --noEmit` from `srcs/requirements/frontend/src/` after all changes
  and fix any type errors before finishing.
