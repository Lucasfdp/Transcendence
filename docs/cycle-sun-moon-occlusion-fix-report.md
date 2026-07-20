# Cycle Backgrounds — Sun/Moon Occlusion Fix Report

**Audience:** an implementing agent fixing the day/night cycle alters so the sun and moon no longer render "inside" scenery (clock tower, torii, pagoda, mountains).
**Prerequisite reading:** `docs/day-night-cycle-backgrounds-report.md` (architecture of the cycle system). This report assumes that plan is already implemented — it is, in the current working tree (theme-parameterised `CycleBackdrop`, `hub-cycle--{theme}` modifiers, interim masked-PNG route with `--cycle-fg-brightness` relighting).
**Scope:** four fixes, A + B + C + D, all to be implemented. D supersedes B on the themes where it succeeds; A and C apply regardless.
**Line numbers** are anchors as of 2026-07-19 (uncommitted working tree); re-grep before editing.

---

## 1. The bug

Observed on the hub with the login/village cycle alter equipped: at 10:47 AM the sun renders overlapping the clock tower; at 11:37 PM the moon shows *through* the tower as a translucent disc.

Two root causes, both structural:

### 1a. The celestial arc ignores the artwork's sky region

`applyCycleVisuals` (`frontend/src/pages/HomePage.tsx`, ~lines 445–498) computes one arc for every theme:

```
sunX  = −12 + dayPhase · 124        → sweeps −12% … 112% of viewport width
sunY  = 72 − dayArc · 62            → dips as low as 72%, peaks at 10%
moonX = −12 + nightPhase · 124
moonY = 74 − nightArc · 58
```

This geometry was tuned for the night art (`night_cycle_part1.png`), where almost the entire frame is open sky. The new static scenes are different: in `login_bg.png` (village map) the sky is a thin strip across the top, with the clock tower, torii, and pagoda rising well into the band the arc traverses. `sunrise_bg.png` (lantern valley) and `sunset_bg.png` similarly have scenery high in frame. The sun/moon therefore spend most of the day flying through drawn scenery.

### 1b. The interim masks make scenery translucent exactly where the arc flies

The interim route (previous report, Step 8b) hides the baked sky with vertical gradient masks on `.hub-cycle__foreground` (`frontend/src/styles/modules/hub.css`, theme override block after line ~472):

| Theme | Current mask | Fade-zone width |
|---|---|---|
| sunset | `transparent 0→36%, black 60%` | 24 pts |
| sunrise | `transparent 0→4%, black 24%` | 20 pts |
| login | `transparent 0→2%, black 18%` | 16 pts |

Inside the fade zone the foreground is 20–80% transparent. The sun (z-index 2) sits *below* the foreground (z-index 5), so a fully opaque tower would occlude it correctly — but a 60%-transparent tower instead alpha-blends with the disc, producing the "sun inside the tower" ghosting. The wide fade zones sit precisely in the altitude band where the arc places the sun and moon.

The night theme is unaffected: its `part1` has a true alpha channel (verified: alpha ≈ 0 in the top band) and full-opacity scenery, so occlusion is binary and correct.

---

## 2. Fix A — per-theme celestial arc configuration (JS)

Give each theme its own arc box so the sun/moon travel only through that artwork's actual sky region.

### 2.1 Edits — `frontend/src/pages/HomePage.tsx`

Add near `applyCycleVisuals` (import `CycleTheme` is already present in this file):

```tsx
type CycleArcConfig = {
	xMin: number;   // % at phase 0 (rise)
	xMax: number;   // % at phase 1 (set)
	sunYBase: number;  // % at horizon;  y = base − arc·amp
	sunYAmp: number;
	moonYBase: number;
	moonYAmp: number;
};

const CYCLE_ARCS: Record<CycleTheme, CycleArcConfig> = {
	// night must reproduce the current behaviour exactly (regression guard)
	night:   { xMin: -12, xMax: 112, sunYBase: 72, sunYAmp: 62, moonYBase: 74, moonYAmp: 58 },
	// starting points — hand-tune with the debug slider (§6)
	sunset:  { xMin: -6, xMax: 106, sunYBase: 42, sunYAmp: 30, moonYBase: 44, moonYAmp: 28 },
	sunrise: { xMin: 2,  xMax: 98,  sunYBase: 26, sunYAmp: 18, moonYBase: 28, moonYAmp: 17 },
	login:   { xMin: 10, xMax: 90,  sunYBase: 16, sunYAmp: 11, moonYBase: 17, moonYAmp: 11 },
};
```

Change the signature `applyCycleVisuals(node, progress)` → `applyCycleVisuals(node, progress, theme: CycleTheme)` and replace the four hard-coded position lines:

```tsx
const arc = CYCLE_ARCS[theme];
const sunX = arc.xMin + dayPhase * (arc.xMax - arc.xMin);
const sunY = arc.sunYBase - dayArc * arc.sunYAmp;
const moonX = arc.xMin + nightPhase * (arc.xMax - arc.xMin);
const moonY = arc.moonYBase - nightArc * arc.moonYAmp;
```

In `CycleBackdrop`, pass the theme through and **add it to the effect dependencies**:

```tsx
useEffect(() => {
	const node = backdropRef.current;
	if (!node) return;
	applyCycleVisuals(node, getDayProgress(now), theme);
}, [now, theme]);
```

### 2.2 Per-theme body size (CSS)

The shared size `clamp(4.5rem, 8vw, 7rem)` (hub.css `.hub-cycle__sun, .hub-cycle__moon` block, ~line 403) is too large for a thin sky strip. Add per-theme overrides next to the theme art overrides:

```css
.hub-cycle--login .hub-cycle__sun,
.hub-cycle--login .hub-cycle__moon {
	width: clamp(2.6rem, 4.5vw, 4rem);
}
.hub-cycle--sunrise .hub-cycle__sun,
.hub-cycle--sunrise .hub-cycle__moon {
	width: clamp(3.2rem, 5.5vw, 5rem);
}
```

(Height follows automatically — the elements are `aspect-square`.) Tune alongside the arc values.

### 2.3 Tuning rule of thumb

For each theme, find the sky band in the rendered page (not the raw PNG — `cover` cropping shifts it): note the y% of the highest scenery silhouette the sun should pass *behind*, and the y% of the sky's top. Set `sunYBase` slightly below the silhouette line (so rise/set happens visually "at the horizon") and `sunYAmp` so `sunYBase − sunYAmp` sits just under the sky's top edge. Narrow `xMin/xMax` when the sky gap does not span the full width (login: the mountains close off both top corners).

---

## 3. Fix B — hard mask edges (CSS)

Replace the wide fade zones so scenery is either fully hidden or fully solid — eliminating the translucent ghosting band. In the theme override block of `hub.css`:

```css
.hub-cycle--sunset .hub-cycle__foreground {
	mask-image: linear-gradient(180deg, transparent 0%, transparent 44%, black 47%);
	-webkit-mask-image: linear-gradient(180deg, transparent 0%, transparent 44%, black 47%);
}
.hub-cycle--sunrise .hub-cycle__foreground {
	mask-image: linear-gradient(180deg, transparent 0%, transparent 12%, black 15%);
	-webkit-mask-image: linear-gradient(180deg, transparent 0%, transparent 12%, black 15%);
}
.hub-cycle--login .hub-cycle__foreground {
	mask-image: linear-gradient(180deg, transparent 0%, transparent 8%, black 11%);
	-webkit-mask-image: linear-gradient(180deg, transparent 0%, transparent 8%, black 11%);
}
```

Keep the fade ≈ 2–3 points wide (a 0-width step aliases visibly on hidpi). The exact cut line must be re-tuned per theme against the rendered page: place it just **above** the tallest scenery that should stay solid, and coordinate with Fix A so `sunYBase` sits at or below this line — then a setting sun slides behind solid buildings, which reads naturally.

Note: with a hard edge, baked-sky remnants directly behind tall scenery (e.g. sky visible between the tower's legs above the cut line) disappear along with everything else above the line — acceptable for the interim route; Fix D removes the limitation properly.

---

## 4. Fix C — blend-mode glow (CSS, one rule)

Make any residual overlap read as light cast on the scene rather than a pasted disc:

```css
.hub-cycle--sunset .hub-cycle__sun,
.hub-cycle--sunrise .hub-cycle__sun,
.hub-cycle--login .hub-cycle__sun,
.hub-cycle--sunset .hub-cycle__moon,
.hub-cycle--sunrise .hub-cycle__moon,
.hub-cycle--login .hub-cycle__moon {
	mix-blend-mode: screen;
}
```

Caveats:
- Do **not** apply to the night theme — its cut-out art occludes correctly and the current look is the regression baseline.
- `screen` brightens against what is below the element in the stacking context (sky, stars). At midday the sun over a bright sky loses some saturation — check 12:00 with the debug slider; if the sun washes out, keep `screen` on the moon only and revert the sun to normal blending (the moon is where the ghosting is most jarring).
- `mix-blend-mode` creates a stacking context on the element; positions/z-indices are unaffected here, but verify the sun still passes behind the foreground after Fix D.

---

## 5. Fix D — scripted cut-out masks (the proper fix)

Generate a real per-theme alpha mask — scenery opaque, sky transparent — and apply it via `mask-image: url(...)`, exactly like the night art's baked alpha but without modifying the original PNGs. With a true cut-out, the existing z-order (foreground 5 above sun/moon 2) makes occlusion physically correct at every arc position.

### 5.1 Mask generation script

Write `scripts/generate-cycle-masks.py` (the repo's `scripts/` directory holds local utilities; use Python + Pillow + NumPy). For each of `sunset_bg.png`, `sunrise_bg.png`, `login_bg.png` in `public/assets/backgrounds/`:

1. **Seed** from the top edge: collect the colours of row 0 (and rows down to ~3% height) as sky samples.
2. **Flood fill** from every top-edge pixel, expanding into 4-connected neighbours whose colour distance (CIELAB or simple RGB Euclidean, tolerance ~28–40 of 255 — expose as a CLI flag) from the *local* frontier pixel stays within tolerance. Local-distance filling follows the sky's own gradient (dusk skies shade from purple to orange) without leaking into scenery, which has dark outlines that act as natural barriers — the cartoon art's black linework is the reason this approach is viable.
3. **Post-process**: morphological close (3–5 px) to absorb speckles (stars, small clouds you want removed with the sky); then a 1–2 px feather (Gaussian on the alpha edge) so the cut does not alias.
4. **Decide the cloud policy per theme**: painted clouds belong to the baked sky → let the fill consume them (the animated `__clouds` layer replaces them). Lantern strings crossing the sky (sunrise valley) must **survive** — if the fill eats them, lower tolerance or protect dark-line pixels (luminance < threshold are never filled).
5. **Output**: `public/assets/backgrounds/<theme>_cycle_mask.png` — same pixel dimensions as the source, **black where scenery** (shown), **transparent where sky** (hidden). Also emit a side-by-side preview JPEG per theme into a temp dir and visually inspect each before accepting.

### 5.2 CSS application

Replace the Fix B gradient for each theme where the generated mask passes inspection:

```css
.hub-cycle--login .hub-cycle__foreground {
	background-image: url("/assets/backgrounds/login_bg.png");
	mask-image: url("/assets/backgrounds/login_cycle_mask.png");
	-webkit-mask-image: url("/assets/backgrounds/login_cycle_mask.png");
	mask-size: cover;
	-webkit-mask-size: cover;
	mask-position: center bottom;
	-webkit-mask-position: center bottom;
	mask-repeat: no-repeat;
	-webkit-mask-repeat: no-repeat;
}
```

**Alignment is critical:** the mask must use the *same* `size`/`position` as the element's `background` (`center bottom / cover`, set in the base `.hub-cycle__foreground` rule) and the mask PNG must have the same aspect ratio as its background PNG — then both crop identically at every viewport ratio and stay pixel-aligned.

### 5.3 Fallback per theme

D is evaluated **per theme**. If a generated mask comes out ragged for one theme (leaks into scenery, eaten lantern strings) after two tuning passes, keep Fix B's hard gradient for that theme, leave the mask file out of the commit, and record `// TODO(cycle-masks): <theme> needs a hand-authored mask` in the CSS override block. Do not ship a bad mask to preserve uniformity.

### 5.4 Interaction with the other fixes

- D makes B redundant for the themes it covers (the URL mask replaces the gradient mask) — remove the gradient for those themes, keep it for fallback themes.
- A remains necessary: without arc tuning the sun would spend hours fully hidden behind mountains — correct occlusion, but a sky with no sun in it.
- C remains optional polish; with D in place, test whether the moon still needs `screen` (a true cut-out may make it unnecessary — prefer removing C where D succeeds, fewer stacking contexts).
- `--cycle-fg-brightness` relighting is orthogonal — keep it as is.

---

## 6. Validation checklist

Use the hub clock's debug slider (click the topbar clock) for all visual checks; test **each of the four cycle alters**, at desktop and responsive breakpoints per the repository's style rules:

- [ ] Slider sweep 00:00 → 23:59 per theme: sun/moon never visibly overlap translucent scenery; rises/sets happen behind solid silhouettes or at the arc edges.
- [ ] 06:00 and 18:00 (twilight windows): glow layers still track the horizon band; no hard mask line visibly cutting the twilight gradient.
- [ ] 12:00: sun not washed out by `mix-blend-mode` (Fix C caveat).
- [ ] Night theme is pixel-identical to before this change (its arc config must reproduce the old constants exactly; no blend mode, no mask changes).
- [ ] Fix D themes: resize the window through narrow/wide aspect ratios — mask stays aligned with the background art (no scenery halo or sky slivers at the cut edge).
- [ ] `cd frontend && npm run build` and `npm run test:run` pass; `git diff --check` clean.
- [ ] Every stylesheet still reachable via `styles/modules/index.css` (no new files expected — all CSS edits land in `hub.css`).

---

## 7. File anchors

| File | What changes |
|---|---|
| `frontend/src/pages/HomePage.tsx` | Fix A: `CYCLE_ARCS`, `applyCycleVisuals(node, progress, theme)`, effect deps in `CycleBackdrop` |
| `frontend/src/styles/modules/hub.css` | Fix A: per-theme body sizes · Fix B: hard mask gradients · Fix C: blend modes · Fix D: URL masks (all inside/next to the existing "Cycle theme art overrides" block after the base `.hub-cycle__foreground` rule) |
| `scripts/generate-cycle-masks.py` | Fix D: new mask-generation utility |
| `public/assets/backgrounds/<theme>_cycle_mask.png` | Fix D: generated artefacts (commit the accepted ones) |
| `frontend/src/shared/backgrounds.ts` | No changes (theme resolution already in place) |
| Backend | No changes |
