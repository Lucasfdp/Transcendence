# Handoff: 4 new character cards + a "Prismatic" super-foil tier for gold cards

This is a handoff, not a finished feature — the brainstorm already happened
(via clarifying questions to the user), the decisions below are **locked**,
and the character flavor text is **already drafted**. What's left is
TDD implementation, following this repo's brainstorm → TDD → execute-plan
process (see `CLAUDE.md` / the `superpowers` skill).

Treat this as two independent, small brownfield extensions of the existing
Shell Cards feature (`backend/src/modules/cards/`,
`frontend/src/components/cards/ShellCardsModal.tsx`). Neither touches
gameplay — cards stay purely cosmetic (locked decision from the original
spec, `docs/SHELL_CARDS_SPEC.md` §1). Don't re-architect the binder read,
the pack-tier system (`docs/SHELL_CARDS_SPEC.md` §11), the transactional
coin spend, or the pack-opening UI — you're adding a catalog extension and
one new orthogonal card attribute on top of all of that.

---

## 0. Working agreement (same as every prior Shell Cards batch)

- **House style:** tabs for indentation; constructor deps that are never
  reassigned → `private readonly`; every `async` external call (DB, HTTP)
  wrapped so a meaningful error surfaces, no unhandled rejections; **named
  constants, no magic numbers**; no dead/commented-out code; never mutate a
  shared array with `.sort()` — copy first; merge consecutive `arr.push()`
  calls; prefer `globalThis` over `window`; no `0.0`-style zero-fraction
  literals where `0` reads cleaner.
- **Testing:** backend is Jest (`*.spec.ts`), frontend is Vitest + Testing
  Library (`*.test.ts(x)`). Cover happy path, edge, and failure paths for
  every new/changed function. Follow existing test conventions exactly —
  see §5 for the specific files and fixtures that need updating.
- **Commits:** short and direct, one idea each (e.g. `Add prismatic foil
  tier for gold cards`, `Add godly, demon, knight, and rasta character
  cards`), matching the existing history.
- **After backend changes**, the user needs to rebuild/restart the backend
  container: `make rebuild-back` or `make restart-back`.
- **Frontend test caveat (learned the hard way, see the pack-tiers batch):**
  in a sandboxed environment, `npm run test:run` (Vitest) will likely fail
  to start — the bind-mounted `node_modules` pulls in a native Rollup
  binary with no build for the sandbox's Linux arch, and outbound network
  is usually locked to an allowlist that blocks npm/unpkg/jsdelivr/GitHub.
  This is not a code problem — don't debug it. `tsc --noEmit` and manual
  trace-through of pure logic work fine and catch real errors. Still ask
  the human to run the real `npm run test:run` and report the output before
  calling the frontend side done — a prior real bug (`CardLightbox`'s Close
  button double-firing) was invisible to both tsc and manual tracing.
- Update `docs/SHELL_CARDS_SPEC.md` when you land this (see §7) — it's the
  spec code review checks against, and it currently says "33 cards" and
  doesn't mention prismatic at all.

---

## 1. What already exists (read these first)

Everything from the original MVP (`docs/SHELL_CARDS_SPEC.md` §1–10) and the
pack-tiers batch (`docs/SHELL_CARDS_SPEC.md` §11,
`docs/handoff-shell-cards-pack-tiers.md`) is already shipped and passing:
`PACK_TIERS` (basic/deluxe/legendary), `rollCard`/`rollGuaranteedCard`, the
tier picker UI, etc. Read `cards.constants.ts`, `cards.roll.ts`,
`cards.service.ts`, `cards.controller.ts`, `entities/user-card.entity.ts`,
and `frontend/src/components/cards/ShellCardsModal.tsx` +
`frontend/src/features/hub/api.ts` in full before touching anything.

Two things this batch adds on top of that, independently:

1. **4 new character cards** — art already exists at
   `public/assets/character/{godly,demon,knight,rasta}-turtle.png` (added by
   the user directly, confirmed present). They just need catalog entries.
2. **A "Prismatic" tier** — a rarer-than-foil state that only a gold-rarity
   card can reach. Not a new value in the rarity ladder (`stone → bronze →
   jade → gold` stays 4 tiers) — it's layered on top of the existing foil
   flag, gold-only.

---

## 2. Locked decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Is prismatic a 5th rarity tier, or a foil-tier upgrade? | **Foil-tier upgrade.** `stone/bronze/jade/gold` stays a 4-tier ladder. Prismatic is reachable only by gold-rarity cards, layered on top of the existing foil mechanic. |
| How is it modeled in code? | See §3 — **two orthogonal booleans** (`foil`, `prismatic`) rather than a 3-state enum. This is a translation of "foil → prismatic as a tier progression" into the smallest possible diff against the existing boolean `foil` field used throughout the codebase (`RolledCard.foil`, `PackPull.foil`, `UserCard.foilCount`, `CardView.foilCount`, the `.is-foil` CSS class, `foilBadgeText`). `prismatic: true` always implies `foil: true`. If you disagree with this translation, it's worth a quick gut-check with the user before diverging, but the *conceptual* decision (foil-tier upgrade, gold-only) is locked either way. |
| How rare is it? | **10% of foil-gold pulls become prismatic**, applied only when the roll already landed gold + foil. This is a flat, tier-independent fraction (`PRISMATIC_CHANCE_FRACTION = 0.1`) — the effective end-to-end rate still scales per pack tier for free, because it's conditioned on `tier.foilChance`, which already differs per tier (basic 5% → effective 0.5%; deluxe 8% → effective 0.8%; legendary 15% → effective 1.5%). |
| Does prismatic get its own duplicate-refund tier? | **No.** Same refund as a regular gold-foil duplicate (`DUPLICATE_COIN_REFUND.gold`). Purely a rarer, flashier cosmetic flex — no economy change. |
| How do we track ownership? | **New `prismaticCount` column/field**, nested inside the existing ones: `prismaticCount ≤ foilCount ≤ count`. A prismatic pull increments both `foilCount` and `prismaticCount`. |
| Name | **"Prismatic"** (e.g. badge text, tier label). Exact glyph/wording is your call — the existing badge language is spare Unicode glyphs, not emoji (rarity: `▪ ◆ ⬡ ★`, foil: `✦ foil`), so something like `✵ Prismatic` fits better than a colorful emoji, but this is a nitpick, not a locked decision. |
| New character rarity | **All 4 new characters are gold**, matching every existing character card. |
| New character names/lore | **Already drafted below (§4)** — use as-is, or treat as a first draft the user can tweak. |

---

## 3. Design notes and regression risks (read before touching `cards.roll.ts`)

### 3.1 RNG draw count — use a *conditional* 4th draw, not an unconditional one

`rollCard` and `rollGuaranteedCard` currently consume exactly 3 `rng()`
draws per call, in order: rarity, index, foil. A large number of existing
tests (`cards.service.spec.ts`, `cards.roll.spec.ts`) use fixed draw
sequences like `PULL_STONE_NO_FOIL = [0, 0, 0.99]` via a `seq()` helper that
cycles through the array — these implicitly assume **3 draws per card**.

**Do not unconditionally add a 4th draw to every `rollCard` call.** That
would shift the cycling offset for every existing 3-draws-per-card test and
cause confusing, hard-to-trace failures across `cards.service.spec.ts`.

Instead: only consume the extra "is this one prismatic?" draw **when the
roll already landed gold + foil** — i.e. add the draw inside the
`rarity === "gold" && foil` branch, not unconditionally at the top of the
function:

```ts
export function rollCard(rng: Rng, tier: PackTierDefinition): RolledCard {
	const rarity = rollRarity(rng, tier.rarityOdds);
	const pool = cardsByRarity(rarity);
	const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
	const foil = rng() < tier.foilChance;
	const prismatic =
		rarity === "gold" && foil && rng() < PRISMATIC_CHANCE_FRACTION;
	return { cardId: pool[index].id, foil, prismatic };
}
```

This is safe against the existing test suite specifically *because* every
`PULL_STONE_NO_FOIL` / `PULL_STONE_FOIL` fixture rolls **stone**, not gold —
so the extra draw is never consumed for those tests, and their existing
draw-cycling math is untouched. The "gold-or-better guaranteed pull" tests
in `cards.service.spec.ts` (legendary tier) *do* roll gold every time via
`rollGuaranteedCard`, but the guaranteed slot is always the **last** card in
the pack (`GUARANTEED_SLOT_INDEX = PACK_SIZE - 1`), so any extra draw
consumed there doesn't ripple into any other card's roll within the same
pack. Those tests only assert `rarities.toContain("gold")`, not exact
foil/prismatic state, so they should keep passing unmodified — but rerun
them and check.

Apply the identical conditional-4th-draw pattern inside
`rollGuaranteedCard` (its eligible-rarity slice for the legendary tier is
always exactly `["gold"]`, so the prismatic branch is *always* live there —
double check this deliberately with a seeded-sequence test, see §5).

### 3.2 `PRISMATIC_CHANCE_FRACTION` belongs in `cards.constants.ts`

Named constant, not tier-specific:

```ts
/**
 * Fraction of foil-gold pulls that upgrade to "prismatic" — the rarest
 * cosmetic state, gold-rarity only. Scales naturally with pack tier because
 * it's conditioned on the tier's own foilChance already having hit.
 */
export const PRISMATIC_CHANCE_FRACTION = 0.1;
```

### 3.3 Badge/visual priority: prismatic implies foil, don't show both badges

Since `prismatic: true` always implies `foil: true` (and `prismaticCount ≤
foilCount`), the UI should show **one** shine badge per card — the fanciest
one it has. Don't render "✦ foil" and "✵ Prismatic" side by side on the
same card. Suggested priority: `prismaticCount > 0` → prismatic badge (with
`×N` if `> 1`); else `foilCount > 0` → existing foil badge; else nothing.
Mirror the existing `foilBadgeText()` helper's shape
(`ShellCardsModal.tsx`) rather than replacing it — e.g. add a sibling
`prismaticBadgeText()` and pick between them once, near the top of
`CardSlot`/`CardLightbox`.

### 3.4 Don't repurpose the existing gold+foil holo layer — add a new one

`CardLightbox` already has a "hybrid holo layer" for **any** gold + foil
card (`card.rarity === "gold" && card.foilCount > 0`), and this exact
behavior is locked in by three existing, passing tests in
`CardLightbox.test.tsx`:

- `should render the hybrid holo layer for a gold card with at least one foil`
- `should not render the hybrid holo layer for a gold card with no foil copies`
- `should not render the hybrid holo layer for a non-gold card even if it's foil`

**Don't narrow this condition to prismatic-only** — that would break all
three tests (they use plain `foilCount`, not `prismaticCount`) and would
regress the visual for players who have a regular gold foil but no
prismatic copy. Instead, add prismatic as an **additional**, more intense
layer/class (e.g. an `is-prismatic` class alongside `is-foil`, with an
animated rainbow/hue-rotate shimmer — respect
`prefers-reduced-motion`, matching the existing check in
`applyCardTiltStyle`) that shows *on top of* the existing holo when
`prismaticCount > 0`, without removing the existing holo for plain gold
foils.

### 3.5 `CardView`/`PackPull`/`UserCard` all need a new required field

Because `foilCount`/`foil` are required (non-optional) fields today, add
`prismaticCount`/`prismatic` as required fields too for consistency, not
optional ones. This means **every existing test fixture that builds a full
`CardView` or `PackPull` object literal will fail to compile** until it
gets the new field. Known fixtures to update (found via search — recheck
before starting in case more exist):

- `frontend/src/components/cards/CardSlot.test.tsx` (`makeCard()`)
- `frontend/src/components/cards/CardLightbox.test.tsx` (`makeCard()`)
- `frontend/src/components/cards/binderFilters.test.ts` (`makeCard()`)
- `frontend/src/components/cards/ShellCardsModal.test.tsx` (`makeBinder()`,
  plus the inline `PackPull` literal in the "pack opening" describe block)
- `backend/src/modules/game-results/game-results.service.spec.ts`
  (`sampleDrop: PackPull`)
- `backend/src/modules/cards/cards.service.spec.ts` (anywhere a `PackPull`
  or full row is asserted)

### 3.6 Migration gap (pre-existing, worth a note not a fix)

`backend/src/data-source.ts` has `synchronize: false`; `app.module.ts` sets
`synchronize: NODE_ENV !== "production"` for the app's own connection, so
dev/staging auto-creates columns but prod needs an explicit migration (see
`backend/src/migrations/20260628010000-add-wager-game.ts` for the pattern:
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` in `up`, `DROP COLUMN IF
EXISTS` in `down`). **There is currently no migration for the `user_cards`
table at all** (not even for the original `foilCount`/`count` columns) —
that's a pre-existing gap from the original MVP, not something introduced
here. Add one migration for `prismaticCount` following the existing
pattern; optionally flag the pre-existing gap to the user, but don't scope-
creep into backfilling a migration for the original columns unless asked.

---

## 4. New character cards (drafted, ready to use)

All 4 are `family: "character"`, `rarity: "gold"`, matching every existing
character card. Append to `CHARACTER_CARDS` in `cards.constants.ts`,
following the exact shape of the existing 6 entries:

```ts
{
	id: "char-godly",
	family: "character",
	rarity: "gold",
	name: "Kamigame, the Godly Shell",
	flavor:
		"Ascended past mortal dojo rank, he doesn't play the odds — the odds play for him.",
	sourceRef: "godly-turtle",
	imageUrl: "/assets/character/godly-turtle.png",
},
{
	id: "char-demon",
	family: "character",
	rarity: "gold",
	name: "Akuma, the Demon Shell",
	flavor:
		"Cast out of the dojo for playing dirty. He came back anyway, fire and all.",
	sourceRef: "demon-turtle",
	imageUrl: "/assets/character/demon-turtle.png",
},
{
	id: "char-knight",
	family: "character",
	rarity: "gold",
	name: "Kishi, the Knight Shell",
	flavor:
		"Bound by an oath older than the dojo itself. His shell has never once turned from a challenge.",
	sourceRef: "knight-turtle",
	imageUrl: "/assets/character/knight-turtle.png",
},
{
	id: "char-rasta",
	family: "character",
	rarity: "gold",
	name: "Irie Kame, the Roots Shell",
	flavor:
		"Never in a hurry, never off the beat — he wins the same way he relaxes: with a slow smile and a steady groove.",
	sourceRef: "rasta-turtle",
	imageUrl: "/assets/character/rasta-turtle.png",
},
```

Note on the rasta card: deliberately leaned on upbeat, universal
"peace/rhythm/chill confidence" traits rather than any religious iconography
or caricature, consistent with how the existing roster treats its other
culturally-flavored characters (Santa, samurai, pirate) as archetypes, not
parody. If the user wants a different angle, this is the one to sanity-check
with them first before finalizing.

This brings the catalog from 33 to **37 cards**. Update the count in
`docs/SHELL_CARDS_SPEC.md` §3 ("Total catalog: 33 cards" → 37) and add 4
tests to `cards.constants.spec.ts` mirroring the 6 existing per-character
tests (e.g. `should include the Kamigame godly character card with static
art`), asserting `family`, `rarity`, and `imageUrl` for each.

---

## 5. Tests to write (TDD — write these first, watch them fail, then implement)

**Constants** (`cards.constants.spec.ts`):

- 4 new tests for the character cards (§4), mirroring the existing 6.
- `should keep PRISMATIC_CHANCE_FRACTION within (0, 1)`.
- Catalog-count assertions (`CARDS.length`) will need bumping from 33 → 37
  wherever hardcoded (check `docs/SHELL_CARDS_SPEC.md` and any test that
  asserts an exact count — most just assert `.length > 0`, so check before
  assuming a hardcoded number needs a bump).

**Roll math** (`cards.roll.spec.ts`):

- `should never mark a non-gold card as prismatic, even when foil is true`
  (seeded so rarity lands bronze/jade/stone + foil passes — prismatic must
  be false).
- `should never mark a gold card as prismatic when the foil check itself
  failed` (gold rarity, foil draw ≥ tier.foilChance).
- `should mark a gold+foil pull as prismatic when the prismatic draw is
  below PRISMATIC_CHANCE_FRACTION`.
- `should not mark a gold+foil pull as prismatic when the prismatic draw is
  at or above PRISMATIC_CHANCE_FRACTION`.
- `should not consume an extra rng draw for a non-gold or non-foil roll`
  (regression test for §3.1 — assert the draw-count/cycling behavior is
  unchanged for a stone pull, e.g. by checking a subsequent `rollCard` call
  on the same `rng` sees the expected next value).
- `rollGuaranteedCard`: same 4 prismatic-related tests, since its eligible
  slice for the legendary tier is always `["gold"]`.

**Service** (`cards.service.spec.ts`):

- `should set prismaticCount to 1 on a brand-new prismatic pull, and
  foilCount to 1 alongside it`.
- `should increment prismaticCount (not just foilCount) on a duplicate
  prismatic pull`.
- `should refund the same amount for a prismatic duplicate as a regular gold
  foil duplicate` (no separate economy tier).
- `should never report prismaticCount higher than foilCount` (invariant
  check across a handful of seeded sequences, or a direct unit assertion on
  `grantCard`'s bookkeeping).

**Frontend** (extend `CardSlot.test.tsx`, `CardLightbox.test.tsx`,
`ShellCardsModal.test.tsx` fixtures per §3.5, then add):

- `should show a prismatic badge instead of a plain foil badge when
  prismaticCount > 0` (CardSlot).
- `should show the plain foil badge when foilCount > 0 but prismaticCount is
  0` (CardSlot — regression, must still pass).
- `should render an additional prismatic shimmer layer for a gold card with
  at least one prismatic copy, without removing the existing holo layer`
  (CardLightbox).
- `should tag a freshly revealed prismatic pull distinctly from a plain foil
  pull` (ShellCardsModal reveal overlay).

Coverage target: ≥80% on the new roll/service logic; cover happy path, edge
(exactly-one-away-from-threshold prismatic draws), and the "never below
minRarity / never above foilCount" invariants, per this repo's testing
standard.

---

## 6. Build order & checkpoints

1. **Batch 1 — Character catalog.** Add the 4 cards (§4) + their
   `cards.constants.spec.ts` tests + the catalog-count doc update. Small,
   independent, no roll-math risk. → review.
2. **Batch 2 — Prismatic roll math.** `PRISMATIC_CHANCE_FRACTION`,
   `RolledCard.prismatic`, the conditional-4th-draw change to `rollCard`
   and `rollGuaranteedCard` (§3.1–3.2) + their tests. Rerun the *existing*
   `cards.roll.spec.ts` and `cards.service.spec.ts` suites in full after
   this batch specifically to catch any accidental draw-cycling regression.
   → review.
3. **Batch 3 — Persistence & service.** `prismaticCount` on
   `UserCard`/`CardView`/`PackPull`, `grantCard`/`incrementExisting`
   bookkeeping, the prod migration (§3.6) + tests. → review.
4. **Batch 4 — Frontend.** `api.ts` types, badge priority (§3.3), the new
   prismatic shimmer layer (§3.4), reveal-overlay tag, fixture updates
   across all 4 test files listed in §3.5. → review.
5. **Batch 5 — Docs.** Update `docs/SHELL_CARDS_SPEC.md`: bump the catalog
   count, add the 4 characters to §3, add a new section documenting
   Prismatic (mirror how §11 documented pack tiers).

Do not start a batch until the previous one's tests are green and reviewed.

---

## 7. Acceptance criteria

- All 4 new character cards appear in the binder, gold rarity, with their
  static art, and are covered by catalog tests.
- A gold-rarity foil pull has a `PRISMATIC_CHANCE_FRACTION` (10%) chance of
  additionally becoming prismatic; no other rarity can ever be prismatic.
- `prismaticCount ≤ foilCount ≤ count` holds for every `UserCard` row,
  tested.
- Duplicate refund for a prismatic card equals the regular gold refund — no
  new economy tier.
- The existing gold+foil holo layer and its 3 locked-in tests are untouched;
  prismatic adds a new, additional visual layer instead of replacing it.
- Existing `cards.roll.spec.ts`/`cards.service.spec.ts` tests that assume
  3-draws-per-card for non-gold rolls still pass unmodified.
- Backend: `npx jest cards game-results` green, `tsc --noEmit` clean.
- Frontend: `tsc --noEmit` clean; **the user has confirmed a real `npm run
  test:run` green** before this is called done (see §0's caveat).
- `docs/SHELL_CARDS_SPEC.md` updated: catalog count, the 4 characters, and a
  new Prismatic section.
