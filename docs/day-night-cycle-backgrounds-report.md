# Day/Night Cycle Backgrounds — Technical Report & Implementation Plan

**Audience:** an implementing agent extending the animated day/night "cycle" alter (currently night-only) to the other three hub backgrounds (sunset, sunrise, login/gate).
**Scope of analysis:** `frontend/src/pages/HomePage.tsx`, `frontend/src/shared/backgrounds.ts`, `frontend/src/styles/modules/{hub,gameplay,profiles}.css`, `backend/src/modules/customization/*`, `public/assets/backgrounds/`.
**Line numbers** are accurate as of 2026-07-19; treat them as anchors, re-grep before editing.

---

## 1. Feature summary (what exists today)

The hub ("main page", `HomeMenu` in `frontend/src/pages/HomePage.tsx`) supports 4 static backgrounds and, for the **night** background only, an "alter art" cosmetic (`night_cycle_bg`) that replaces the static PNG with a **procedurally animated sky that tracks the real local time of day**: the sun/moon arc across the sky, the sky gradient recolours through dawn/day/dusk/night, 420 twinkling stars fade in at night, a cloud strip scrolls with parallax, and a static foreground PNG sits on top.

Clicking the **clock in the hub topbar** opens a **debug time popover** with a 0–1439 minute slider that overrides the displayed time (and therefore the entire sky) without touching the real clock. A "Real time" button resets it.

The other three alters (`sunset_cycle_bg`, `sunrise_cycle_bg`, `login_cycle_bg`) **already exist as purchasable cosmetics in the backend** but the frontend renders them as the plain static parent background — they are placeholder "alter slots". Your job is to make them animate.

---

## 2. Data model & backend (no changes required)

### 2.1 Cosmetic definitions — `backend/src/modules/customization/customization.constants.ts`

- `CosmeticType` includes `"hub_background"` and `"hub_background_alter"` (lines 1–6).
- The four backgrounds: `night_bg`, `sunset_bg`, `sunrise_bg`, `login_bg` (lines 119–156).
- The four alters, each with `parentCosmeticId` pointing at its background (lines 157–197):

| Alter id | Parent | Price | Notes |
|---|---|---|---|
| `night_cycle_bg` | `night_bg` | 0, `defaultUnlocked` | The working one |
| `sunset_cycle_bg` | `sunset_bg` | 999 | Placeholder "Alter slot" |
| `sunrise_cycle_bg` | `sunrise_bg` | 999 | Placeholder "Alter slot" |
| `login_cycle_bg` | `login_bg` | 999 | Placeholder "Alter slot" |

- `LEGACY_COSMETIC_IDS` (line 29) maps old id `cycle_bg` → `night_cycle_bg`. Nothing to add for the new alters.

### 2.2 Equip logic — `backend/src/modules/customization/customization.service.ts` (~lines 51–62)

Equipping a `hub_background_alter`:
1. requires the alter to be owned,
2. requires the **parent** background to be owned,
3. sets `user.hubBackground = parentCosmetic.id` and `user.hubBackgroundAlter = cosmetic.id`.

Equipping a plain `hub_background` sets `user.hubBackgroundAlter = null`. Equipped-state check is at ~lines 217–220. **This logic is fully generic — the backend needs no changes.** (Optionally update the 3 alter `description` strings from "Alter slot for…" to "Animated alter art for…" once implemented.)

### 2.3 Persistence / API

`hubBackgroundAlter` column exists (migration `backend/src/migrations/20260623000000-add-hub-background-alter.ts`, entity `users/entities/user.entity.ts`). The frontend `User` type carries `hubBackground: string` and `hubBackgroundAlter: string | null` (`frontend/src/features/hub/api.ts` lines 214–215).

---

## 3. Frontend resolution layer — `frontend/src/shared/backgrounds.ts` (43 lines, read it whole)

This tiny module is the **single choke point** that decides what every page renders:

- `normalizeHubBackgroundId(id)` — legacy `cycle_bg` → `night_cycle_bg` (line 6).
- `resolveHubBackgroundId(backgroundId, backgroundAlterId)` — **the alter wins over the base background** when set (lines 10–18).
- `hubBackgroundPreset(id): HubBackgroundPreset` (lines 20–32) maps ids to preset names. **Critical current behaviour:**
  - `night_cycle_bg` → `"cycle"` ← only this one animates
  - `sunset_cycle_bg` → `"sunset"` (static fallback)
  - `sunrise_cycle_bg` → `"sunrise"` (static fallback)
  - `login_cycle_bg` → `"login"` (static fallback)
- `hubBackgroundClass(prefix, bg, alter)` → `` `${prefix}--${preset}` `` e.g. `hub-page--cycle`, `game-host--sunset` (lines 34–42).

Consumers of `hubBackgroundClass` / `resolveHubBackgroundId`:
- `frontend/src/pages/HomePage.tsx` — hub page class + `showCycleBackdrop` gate.
- `frontend/src/routes/GamePage.tsx` (lines ~15, ~199, ~417) — prefix `"game-host"`, in-game backdrop.
- `frontend/src/features/profile/PlayerProfilePreview.tsx` (line 32) — prefix `"profile-preview"`, profile card backdrop.

---

## 4. How the night cycle works — `frontend/src/pages/HomePage.tsx`

### 4.1 Time source (realtime tick)

State inside `HomeMenu` (lines 560–562):

```tsx
const [now, setNow] = useState(() => new Date());
const [isClockDebugOpen, setIsClockDebugOpen] = useState(false);
const [manualMinutes, setManualMinutes] = useState<number | null>(null); // null = real time
```

A **self-correcting 1 Hz tick** (lines 1279–1290) — note it schedules the next tick at the next wall-clock second boundary rather than a fixed 1000 ms interval, so the clock display never drifts:

```tsx
useEffect(() => {
    let timerId = 0;
    const scheduleTick = () => {
        const current = new Date();
        setNow(current);
        timerId = window.setTimeout(scheduleTick, 1000 - current.getMilliseconds());
    };
    scheduleTick();
    return () => window.clearTimeout(timerId);
}, []);
```

### 4.2 Debug time override

- `displayedNow` (lines 2780–2781) is the **only** Date the backdrop and clock consume:

```tsx
const displayedNow =
    manualMinutes === null ? now : createManualTime(now, manualMinutes);
```

- `createManualTime(base, totalMinutes)` (lines 413–417) clones `now` and sets `hours = ⌊m/60⌋, minutes = m%60, seconds = 0, ms = 0`. So debug time is **frozen within the selected minute** (it still re-renders each second, but seconds are zeroed).
- `getTotalMinutes(now)` (lines 419–421) seeds the slider with the current real time.
- The **clock button** (lines 2835–2849) always shows `displayedNow` and toggles `isClockDebugOpen`. The **debug popover** (lines 2850–2878) renders only when `showCycleBackdrop && isClockDebugOpen`: a `<input type="range" min="0" max="1439" step="1">` writing `setManualMinutes(Number(...))`, a live label (`manualTimeLabel`, line 2784), and a "Real time" button doing `setManualMinutes(null)`.
- A guard effect (lines 1292–1297) closes the popover and clears the override whenever the cycle backdrop is not active:

```tsx
useEffect(() => {
    if (!showCycleBackdrop) {
        setIsClockDebugOpen(false);
        setManualMinutes(null);
    }
}, [showCycleBackdrop]);
```

### 4.3 The gate

```tsx
// lines 762–771
const appliedBackgroundId = resolveHubBackgroundId(
    player?.hubBackground, player?.hubBackgroundAlter);
const backgroundClass = hubBackgroundClass(
    "hub-page", player?.hubBackground, player?.hubBackgroundAlter);
const showCycleBackdrop = appliedBackgroundId === "night_cycle_bg";   // ← hard-coded to night
```

Render (lines 2786–2788):

```tsx
<main className={`menu-page hub-page ${backgroundClass}`}>
    {showCycleBackdrop ? <CycleBackdrop now={displayedNow} /> : null}
```

### 4.4 `CycleBackdrop` component (lines 491–531)

```tsx
function CycleBackdrop({ now }: { now: Date }): JSX.Element {
    const backdropRef = useRef<HTMLDivElement | null>(null);
    const stars = useMemo(() => createCycleStars(CYCLE_STAR_COUNT), []); // 420 stars, once per mount

    useEffect(() => {
        const node = backdropRef.current;
        if (!node) return;
        applyCycleVisuals(node, getDayProgress(now)); // re-runs every second / slider move
    }, [now]);

    return (
        <div className="hub-cycle" ref={backdropRef} aria-hidden="true">
            <div className="hub-cycle__sky" />
            <div className="hub-cycle__stars">…420 <span className="hub-cycle__star"> with per-star CSS vars…</div>
            <div className="hub-cycle__sun" />
            <div className="hub-cycle__moon" />
            <div className="hub-cycle__glow" />
            <div className="hub-cycle__clouds" />
            <div className="hub-cycle__foreground" />
        </div>
    );
}
```

Key design point: **React never re-renders the DOM tree per tick.** The animation is driven by writing CSS custom properties onto the container via `node.style.setProperty`; the browser handles the visuals. Stars are generated once (`createCycleStars`, lines 321–361: random position in top 2–66% of the viewport, three size/opacity/blur tiers, randomized twinkle duration/negative delay, 5-colour palette `CYCLE_STAR_COLORS` lines 312–318).

### 4.5 The math — `getDayProgress` + `applyCycleVisuals` (lines 383–489)

`getDayProgress(now)` (lines 383–390): seconds-since-midnight (incl. ms) ÷ 86400 → **progress ∈ [0,1)**, 0 = midnight, 0.25 = 06:00, 0.5 = noon, 0.75 = 18:00.

`applyCycleVisuals(node, progress)` (lines 443–489), the whole engine:

```
normalized  = ((progress % 1) + 1) % 1
isDay       = 0.25 ≤ normalized < 0.75
dayPhase    = clamp((normalized − 0.25) / 0.5, 0, 1)        // 0 at 06:00 → 1 at 18:00
nightPhase  = getNightPhase(normalized)                      // 0 at 18:00 → 1 at 06:00 (wraps midnight; lines 423–425)
dayArc      = sin(dayPhase · π)                              // 0→1→0 arc
nightArc    = sin(nightPhase · π)
sunX        = −12 + dayPhase · 124        (%)                // rises left, sets right, off-screen at ends
sunY        = 72 − dayArc · 62            (%)
moonX       = −12 + nightPhase · 124      (%)
moonY       = 74 − nightArc · 58          (%)
dawnBlend   = clamp(1 − |normalized − 0.25| / 0.08, 0, 1)    // triangular window ±1h55m around 06:00
duskBlend   = clamp(1 − |normalized − 0.75| / 0.08, 0, 1)    // …around 18:00
twilight    = max(dawnBlend, duskBlend)
nightStrength = isDay ? 0 : 0.55 + nightArc · 0.45
starsOpacity  = clamp(nightStrength − twilight · 0.6, 0, 1)
```

Sky colours come from `interpolatePalette(normalized, stops)` (lines 427–441) — piecewise-linear RGB interpolation over 7 stops (helpers `clamp`/`lerp`/`blendColor`/`rgbToCss`, lines 363–381). Two palettes are hard-coded inline (lines 460–477): `topColor` (zenith) and `horizonColor`, with stops at 0 (midnight), 0.2, 0.28 (dawn), 0.5 (noon), 0.72 (golden hour), 0.82, 1 (midnight again — first and last stops match so the loop is seamless).

### 4.6 The CSS-variable contract (lines 479–488)

`applyCycleVisuals` writes exactly these onto `.hub-cycle`:

| Variable | Meaning |
|---|---|
| `--cycle-top` / `--cycle-horizon` | sky gradient colours (rgb strings) |
| `--cycle-sun-x/y`, `--cycle-moon-x/y` | percent positions |
| `--cycle-sun-opacity` / `--cycle-moon-opacity` | `1`/`0` hard swap at day/night boundary |
| `--cycle-stars-opacity` | 0–1 |
| `--cycle-twilight-opacity` | 0–1, drives glow + cloud tinting |

**Anything that consumes only these variables is theme-agnostic.** This is the reason the engine can be reused for the other backgrounds unchanged.

---

## 5. CSS layer

### 5.1 `frontend/src/styles/modules/hub.css`

- Base `.hub-page` (≈lines 327–336) paints `var(--hub-bg-image)` (static PNG); `.hub-page--night/--sunset/--sunrise/--login` (lines 338–352) just set that variable.
- `.hub-page--cycle` (lines 354–364) **replaces the static image with a plain dark gradient** so the animated `.hub-cycle` div shows through, and kills the `::before` overlay.
- `.hub-cycle` (lines 366–380): defines default values for every `--cycle-*` variable, `absolute inset-0; z-index: 0; pointer-events-none; overflow-hidden`. The page content sits above it (`.hub-page__shell` has `z-index: 2`, line 476).
- Layer stack (all `absolute inset-0`, lines 382–472), bottom → top:

| z | Class | Content / theme-specific assets |
|---|---|---|
| 0 | `__sky` | two stacked gradients of `--cycle-top`/`--cycle-horizon` — **theme-agnostic** |
| 1 | `__stars` | opacity `var(--cycle-stars-opacity)`; children `.hub-cycle__star` animate `cycle-star-twinkle` — theme-agnostic |
| 2 | `__sun` | pure-CSS radial-gradient sun — theme-agnostic |
| 2 | `__moon` | **`night_cycle_part3.png`** sprite (line 425) |
| 3 | `__glow` | twilight radial glows scaled by `--cycle-twilight-opacity` — theme-agnostic |
| 4 | `__clouds` | **`night_cycle_part2.png`** `repeat-x`, `animation: cycle-sky-parallax 42s linear infinite` (lines 458–466) |
| 5 | `__foreground` | **`night_cycle_part1.png`** `center bottom / cover` (lines 468–472) — the dojo scenery silhouette |

- Clock + debug popover styles: `.hub-page__clock-wrap/__clock/__clock-time/__clock-period` (lines 498–561), `.hub-page__clock-debug/-label/-slider/-meta/-reset` (lines 563–616). All theme-agnostic.

### 5.2 `frontend/src/styles/modules/gameplay.css` (in-game backdrop + shared keyframes)

- `.game-host--cycle` (lines 31–40): uses **`night_cycle_part1.png`** as the static in-game background; `::before` (lines 42–53) overlays parallax **`night_cycle_part2.png`** clouds. This is a *lightweight static-ish* treatment — games don't run the JS engine.
- **`@keyframes cycle-sky-parallax` (lines 66–77) and `@keyframes cycle-star-twinkle` (lines 79–90) live here**, not in hub.css, and are shared globally (single CSS bundle).

### 5.3 `frontend/src/styles/modules/profiles.css`

- `.profile-preview--cycle` (lines 515–516) sets the preview image to `night_cycle_part2.png` for profile cards.

### 5.4 Cosmetic shop previews — `HomePage.tsx` `COSMETIC_PREVIEWS` (lines 158–177)

`night_cycle_bg` previews with `night_cycle_part2.png`; the other three alters currently reuse their parent's static PNG (lines 174–176).

---

## 6. Assets

`frontend/vite.config.mjs` sets `publicDir: "../public"` → the served asset root is the **repo-root `public/` directory**. Current contents of `public/assets/backgrounds/`:

```
login_bg.png  night_bg.png  sunrise_bg.png  sunset_bg.png
night_cycle_part1.png   (foreground scenery, cover, bottom-anchored)
night_cycle_part2.png   (horizontally tileable cloud strip — must tile seamlessly in x; parallax shifts −240px)
night_cycle_part3.png   (moon sprite, square-ish, transparent bg, rendered ~4.5–7 rem)
```

**Gap:** no `sunset_cycle_part*`, `sunrise_cycle_part*`, `login_cycle_part*` art exists. Per theme you need:
- `part1` — foreground silhouette of that background's scenery (the key differentiator),
- `part2` — cloud/sky strip, seamlessly tileable horizontally,
- `part3` — moon sprite (can be shared/reused; see §7 step 4).

If art is not available, ship with the night parts as placeholders (CSS fallback), or derive silhouettes from the existing `sunset_bg.png` etc. — flag this decision to the user.

---

## 7. Implementation plan

Design principle: **the time engine (`getDayProgress` + `applyCycleVisuals` + CSS variable contract + debug clock) is already theme-independent. Only the art layers (moon/clouds/foreground) and the gate are night-specific.** So: parameterize by a *cycle theme* and select art via CSS modifier classes, leaving the math untouched.

### Step 1 — `frontend/src/shared/backgrounds.ts`: add theme resolution

```ts
export type CycleTheme = "night" | "sunset" | "sunrise" | "login";

const CYCLE_THEMES: Record<string, CycleTheme> = {
    night_cycle_bg: "night",
    sunset_cycle_bg: "sunset",
    sunrise_cycle_bg: "sunrise",
    login_cycle_bg: "login",
};

/** Non-null iff the resolved background is an animated cycle alter. */
export function hubCycleTheme(backgroundId?: string | null): CycleTheme | null {
    const id = normalizeHubBackgroundId(backgroundId);
    return id ? (CYCLE_THEMES[id] ?? null) : null;
}
```

Then change `hubBackgroundPreset` so **all four** alters map to `"cycle"` (replace the three `*_cycle_bg → sunset/sunrise/login` lines, 23–27):

```ts
if (backgroundId && backgroundId in CYCLE_THEMES) return "cycle";
```

And make `hubBackgroundClass` emit a theme modifier alongside the preset class, so every consumer (hub, game, profile preview) gets theming for free:

```ts
export function hubBackgroundClass(prefix, backgroundId, backgroundAlterId): string {
    const resolved = resolveHubBackgroundId(backgroundId, backgroundAlterId);
    const preset = hubBackgroundPreset(resolved);
    const theme = hubCycleTheme(resolved);
    return theme
        ? `${prefix}--cycle ${prefix}--cycle-${theme}`
        : `${prefix}--${preset}`;
}
```

(Callers interpolate the return value into `className` strings, so returning two space-separated classes is safe — verify with a grep for `hubBackgroundClass(`: HomePage.tsx, GamePage.tsx ×2, PlayerProfilePreview.tsx.)

### Step 2 — `HomePage.tsx`: generalize the gate

Replace line 771:

```tsx
const cycleTheme = hubCycleTheme(appliedBackgroundId);   // import from shared/backgrounds
const showCycleBackdrop = cycleTheme !== null;
```

`showCycleBackdrop` is used in exactly three places, all of which keep working unchanged: the reset effect (line 1293), the backdrop render (line 2788), the debug-popover gate (line 2850). Only the render call gains the prop:

```tsx
{cycleTheme ? <CycleBackdrop now={displayedNow} theme={cycleTheme} /> : null}
```

### Step 3 — `CycleBackdrop`: accept the theme

```tsx
function CycleBackdrop({ now, theme }: { now: Date; theme: CycleTheme }): JSX.Element {
    ...
    return <div className={`hub-cycle hub-cycle--${theme}`} ref={backdropRef} aria-hidden="true">
```

No other component changes. Do **not** touch `applyCycleVisuals`, `getDayProgress`, star generation, or the clock/debug UI.

*Optional (only if per-theme skies are wanted):* lift the two inline palettes (HomePage.tsx lines 460–477) into a `Record<CycleTheme, {top: Stop[]; horizon: Stop[]}>` table and add a `theme` parameter to `applyCycleVisuals`. The sky already passes through the full 24 h spectrum, so identical palettes across themes is a legitimate v1; recommend deferring per-theme palettes and noting it as follow-up.

### Step 4 — `hub.css`: per-theme art overrides

The night assets stay as the defaults on the base classes (lines 425, 462, 471), which doubles as the fallback. Add, next to the existing `.hub-cycle` block:

```css
/* ── Cycle theme art overrides ─────────────────────────────── */
.hub-cycle--sunset  .hub-cycle__moon       { background-image: url("/assets/backgrounds/sunset_cycle_part3.png"); }
.hub-cycle--sunset  .hub-cycle__clouds     { background-image:
    linear-gradient(180deg, rgba(255, 245, 208, calc(var(--cycle-twilight-opacity) * 0.12)), transparent 32%),
    url("/assets/backgrounds/sunset_cycle_part2.png"); }
.hub-cycle--sunset  .hub-cycle__foreground { background-image: url("/assets/backgrounds/sunset_cycle_part1.png"); }
/* repeat for --sunrise and --login */
```

Caution: `__clouds` and `__moon` use shorthand `background:` in the base rules — override with `background-image` (as above) so position/repeat/size/animation are inherited, and keep the twilight gradient as the first image layer for `__clouds`.

### Step 5 — `gameplay.css`: in-game variants

`.game-host--cycle` (line 31) and its `::before` (line 42) hard-code the night parts. With the class emitter from Step 1, `game-host--cycle-night` etc. are now present on the element; add:

```css
.game-host--cycle-sunset          { --game-bg-image: url("/assets/backgrounds/sunset_cycle_part1.png"); }
.game-host--cycle-sunset::before  { background-image:
    radial-gradient(circle at 50% 20%, rgba(255, 236, 174, 0.14), transparent 20%),
    url("/assets/backgrounds/sunset_cycle_part2.png"); }
/* repeat for -sunrise, -login */
```

(`--cycle-night` needs no rule; base `--cycle` already is night.)

### Step 6 — `profiles.css`: preview variants

Mirror line 515: add `.profile-preview--cycle-sunset { --profile-preview-bg-image: url(".../sunset_cycle_part2.png"); }` etc. (The theme class arrives automatically via Step 1.)

### Step 7 — shop previews

Update `COSMETIC_PREVIEWS` (HomePage.tsx lines 174–176) to point the three alters at their new `*_cycle_part2.png` (matching how `night_cycle_bg` previews with its part2).

### Step 8 — assets (preferred route)

Add to `public/assets/backgrounds/`: `sunset_cycle_part1/2/3.png`, `sunrise_cycle_part1/2/3.png`, `login_cycle_part1/2/3.png` (constraints in §6). If unavailable, use Step 8b below, and record a TODO with a tracking issue for real cut-out art.

### Step 8b — interim route: reuse the existing static PNGs (no new art)

The existing `sunset_bg.png` / `sunrise_bg.png` / `login_bg.png` are full scenes with the sky **baked in**, so they cannot go into the `__foreground` slot as-is — that layer is opaque `cover` and would hide the entire animated sky (the night alter only works because `night_cycle_part1.png` has a transparent sky). Interim approach:

1. **Mask off the baked sky** so the animated sky takes over above the horizon. Per theme, in the Step 4 override:

```css
.hub-cycle--sunset .hub-cycle__foreground {
    background-image: url("/assets/backgrounds/sunset_bg.png");
    mask-image: linear-gradient(180deg, transparent 0%, transparent 32%, black 58%);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, transparent 32%, black 58%);
}
```

Hand-tune the two cut points per image (horizon heights differ, and `cover` cropping shifts with viewport aspect ratio — check desktop and responsive breakpoints per the repo's style-validation rules).

2. **Relight the scenery with the engine.** Baked lighting is static, so dim it at night: in `applyCycleVisuals`, additionally write e.g. `--cycle-fg-brightness` = `isDay ? 1 : 0.45 + nightArc-derived term` (smooth through the twilight windows using `twilight`), then on `.hub-cycle__foreground`: `filter: brightness(var(--cycle-fg-brightness, 1)) saturate(0.9);`. CSS filters accept custom properties. Give the variable a default of `1` in `.hub-cycle` alongside the others (hub.css lines 366–376).

3. **Reuse the night `part2` (clouds) and `part3` (moon)** for all themes — they are theme-neutral; skip the clouds/moon overrides in Step 4 entirely on this route.

Known compromises (accept explicitly or escalate to the user): the soft mask ghosts scenery that rises above the horizon line (pagoda tops, the gate crossbeam on `login_bg` fade instead of standing crisply against the sky), and brightness/saturation can dim but not re-colour baked light, so at noon the "sunset" scenery still carries dusk-toned lighting. Game pages (`game-host--cycle-*`), profile previews, and shop previews should keep using the plain static PNGs on this route — no per-theme part art exists, so Steps 5–7 reduce to: point the Step 5/6 overrides at the parent `*_bg.png` and leave `COSMETIC_PREVIEWS` unchanged.

### Step 9 — backend polish (optional)

In `customization.constants.ts`, update the three alter descriptions ("Alter slot for…" → "Animated alter art for…"). No logic changes.

---

## 8. Pitfalls & edge cases the implementer must respect

1. **Do not break `night_cycle_bg` / legacy `cycle_bg`.** `normalizeHubBackgroundId` must keep mapping `cycle_bg → night_cycle_bg`; the existing `hub-page--cycle` class name must survive (Step 1 keeps it, adding a modifier rather than renaming).
2. **The debug-reset effect** (HomePage.tsx 1292–1297) must clear `manualMinutes` whenever *no* cycle theme is active — keep its dependency on the generalized boolean, not on a specific id.
3. **The alter wins**: `resolveHubBackgroundId` prefers `hubBackgroundAlter`; equipping a plain background nulls the alter server-side. Don't reimplement this per-theme.
4. **CSS shorthand traps**: base `__clouds`/`__moon`/`__foreground` rules use `background:` shorthand; theme overrides must use `background-image` only (or repeat the full shorthand) or you'll silently lose `repeat-x`, sizing, and the parallax positioning.
5. **`part2` must tile seamlessly in x** — `cycle-sky-parallax` scrolls background-position by −240px on loop; a non-tileable strip pops visibly.
6. **Keyframes live in `gameplay.css`** (66–90) even though hub.css uses them; don't duplicate them, they're globally available in the single bundle.
7. **Stars memoized per mount** (`useMemo(..., [])`): switching themes remounts `CycleBackdrop` only if the conditional render toggles; changing the `theme` prop alone keeps the same star field — that's fine and desirable.
8. **`manualMinutes` freezes seconds** (`createManualTime` zeroes s/ms) — expected behaviour, don't "fix".
9. **Type check the JSX class strings** — `hubBackgroundClass` returning two classes is fine, but search for any test snapshot assertions on the exact class string: `PlayerProfilePreview.test.tsx` and `frontend/src/games/common/tests/replayVisuals.test.ts` reference backgrounds/night — run the frontend test suite and update snapshots/assertions that expect e.g. `profile-preview--cycle` as the *only* modifier.
10. Ignore `frontend/src/styles/.fuse_hidden*` files (stale deleted-file remnants) and `frontend/dist/` (build output) — never edit them.
11. `frontend/src/shared/drawBackground.ts` is the **Phaser in-match procedural night sky** — unrelated to the hub cycle system; leave it alone.

---

## 9. Acceptance checklist (run after implementation)

- [ ] `cd frontend && npx tsc --noEmit` passes (no dedicated typecheck script exists; scripts are `dev/build/test/test:run/coverage`).
- [ ] Frontend unit tests pass: `cd frontend && npm run test:run` (vitest); update any class-name assertions (e.g. `PlayerProfilePreview.test.tsx` asserts `profile-preview--night` at line ~40).
- [ ] For each of the 4 alters equipped: hub shows animated sky; sun visible 06:00–18:00, moon otherwise; sky colours loop seamlessly across midnight (slider 1439 → 0).
- [ ] Clock button opens debug popover **for all four cycle alters**; slider sweeps the full day; "Real time" resets; popover force-closes and override clears when switching to a static background.
- [ ] Equipping the plain parent background restores the static PNG (alter cleared).
- [ ] GamePage during a match shows the theme's part1/part2 art for each cycle alter.
- [ ] Profile preview and shop preview show per-theme art.
- [ ] Night alter is pixel-identical to before the change (regression guard).

---

## 10. File inventory (quick reference)

| File | Role |
|---|---|
| `frontend/src/shared/backgrounds.ts` | id → preset/theme resolution (edit: Steps 1) |
| `frontend/src/pages/HomePage.tsx` | clock tick, debug slider, `CycleBackdrop`, engine math, gate, shop previews (edit: Steps 2, 3, 7) |
| `frontend/src/styles/modules/hub.css` | hub cycle layers + clock/debug styling (edit: Step 4) |
| `frontend/src/styles/modules/gameplay.css` | in-game cycle variant + shared keyframes (edit: Step 5) |
| `frontend/src/styles/modules/profiles.css` | profile preview variant (edit: Step 6) |
| `public/assets/backgrounds/` | art assets (add: Step 8) |
| `backend/src/modules/customization/customization.constants.ts` | cosmetic defs (optional Step 9) |
| `backend/src/modules/customization/customization.service.ts` | equip logic (no change) |
| `frontend/src/routes/GamePage.tsx`, `frontend/src/features/profile/PlayerProfilePreview.tsx` | consumers via `hubBackgroundClass` (no change needed after Step 1) |
