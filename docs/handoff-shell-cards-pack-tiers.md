# Handoff: Add new Shell Cards pack tiers (including an expensive, rare-pull tier)

Today Shell Cards has exactly **one** pack: a flat 100-coin buy that rolls 5
cards against one fixed rarity table. The user wants **multiple pack types**,
including one or more **very expensive** packs with **better/rarer odds**.
This is a real gap, not a tweak — `openPack` has no notion of "which pack,"
and the frontend has a single hardcoded "Open Pack" button.

Treat this as a brownfield extension of an existing, working feature. The
binder read, the roll math, the transactional coin spend, and the pack-opening
UI (flip animation, foil shimmer, rarity badges) all already work — **do not
re-architect any of that**. You're adding a tier dimension on top.

---

## 0. Non-negotiable working agreement

- **This repo's process is brainstorm → TDD → execute-plan** (see
  `CLAUDE.md` / the `superpowers` skill if it's available to you). The
  numbers in this doc (tier count, prices, odds, the guarantee mechanic) are
  a **strawman**, not a locked decision — the user asked for "new pack types,
  some very expensive, with rare pulls" but hasn't approved exact prices or
  odds yet. Walk them through the concrete proposal in §2 and get an explicit
  "yes, proceed" before implementing, exactly like the existing feature's own
  spec (`docs/SHELL_CARDS_SPEC.md`) was only implemented after a brainstorm.
- **`docs/SHELL_CARDS_SPEC.md` is the spec code review checks against.**
  It says so in its own header: "update it if the design changes; don't let
  code and spec drift." When you land the final tier design, add a section to
  that doc with the shipped tiers/prices/odds — don't leave it describing only
  the single-tier MVP.
- **Cards stay purely cosmetic.** This is a locked decision from the original
  brainstorm (spec §1). Pack tiers change *odds and price*, never anything
  that touches gameplay.
- **Server-authoritative, transactional, no client trust** — same discipline
  the casino module (`backend/src/modules/casino/`) uses for its provably-fair
  RNG. All rolls and coin spend happen server-side in one DB transaction;
  the client only ever *asks* to open a pack of a given tier and receives the
  result.
- **House style:** tabs for indentation; constructor deps that are never
  reassigned → `private readonly`; every `async` external call (DB, HTTP)
  wrapped so a meaningful error surfaces, no unhandled rejections; **named
  constants, no magic numbers** (this matters a lot here — tier prices, odds,
  and the guarantee rarity all need names); no dead/commented-out code; never
  mutate a shared array with `.sort()` — copy first; merge consecutive
  `arr.push()` calls; prefer `globalThis` over `window`; no `0.0`-style
  zero-fraction literals where `0` reads cleaner.
- **Testing:** backend is Jest (`*.spec.ts`), frontend is Vitest + Testing
  Library (`*.test.ts(x)`). Coverage target ≥80% on business logic; cover
  happy path, edge, and failure paths for every new function (see §4 for the
  concrete list). Follow the existing test conventions exactly — see §1's
  file table for the templates.
- **Commits:** short and direct, one idea each (e.g. `Add deluxe and
  legendary pack tiers`), matching the existing history.
- **After backend changes**, the user needs to rebuild/restart the backend
  container: `make rebuild-back` or `make restart-back`.
- **Module scope:** `docs/modules-progress.md` has a "Module Boundary Rule"
  against adding functionality outside the chosen modules — this doesn't
  apply here because the user explicitly asked for this, and it's an
  extension of the already-in-scope cosmetic customisation/cards feature, not
  a new module. Still worth a glance at that file once you're done in case
  the "Game customisation options" entry needs a note.

### Verification techniques available (learned the hard way — read this first)

- **Backend**: full Jest + `tsc --noEmit` run fine in a plain Linux sandbox —
  pure Node, no native deps. `cd backend && npx jest cards`.
- **Frontend**: if you're working in a sandboxed environment like this one,
  **`npm run test:run` (Vitest) will likely fail to even start** — the
  project's `node_modules` gets bind-mounted from the developer's host
  machine (built for macOS), and Vitest pulls in Vite → Rollup's native
  binary, which doesn't have a build for whatever Linux arch the sandbox runs.
  A sandbox's outbound network is also commonly locked to an allowlist that
  blocks the npm registry, unpkg, jsdelivr, and even GitHub, so you can't fix
  it by reinstalling. This is **not a code problem** — don't spend time
  debugging it. What *does* work: `tsc --noEmit` (catches real type errors,
  zero false negatives so far), and manual trace-through of pure logic. Ask
  the human to run `npm run test:run` locally and report the output — do not
  claim frontend tests pass without that confirmation.
- **This isn't theoretical**: across the last three Shell Cards batches, a
  real bug (`CardLightbox`'s Close button firing `onClose` twice via event
  bubbling into the backdrop's own click handler) was invisible to `tsc` and
  to my manual trace, and only showed up when the human ran the actual suite.
  Ask for that real run before calling anything done.

---

## 1. What already exists (read these first)

Backend — `backend/src/modules/cards/`:

| File | Purpose |
|---|---|
| `cards.constants.ts` | `CardRarity`, `CardFamily`, `CardDefinition`, `CardView`, `BinderView`, `PackPull`, `PackResult` types. `CARDS` catalogue (33 cards). `RARITY_ODDS` (single fixed table, `stone .6 / bronze .27 / jade .1 / gold .03`, asserted sum-to-1). `FOIL_CHANCE = 0.05`. `PACK_SIZE = 5`. `PACK_PRICE_COINS = 100`. `DUPLICATE_COIN_REFUND` per rarity. **Everything here assumes exactly one pack — this is where the tier concept needs to be added.** |
| `cards.roll.ts` | `rollRarity(rng)` (walks `CARD_RARITIES` accumulating `RARITY_ODDS` — **hardcoded to the one table**), `rollCard(rng)` (rarity → uniform card in that rarity → foil check against the hardcoded `FOIL_CHANCE`). Pure, injectable `Rng = () => number`, fully unit-testable with a seeded sequence. |
| `entities/user-card.entity.ts` | `UserCard`: `user`, `cardId`, `count`, `foilCount`, `firstObtainedAt`. One row per (user, card) — **no notion of which pack tier granted a card, and it doesn't need one** (a card looks the same regardless of which pack it came from; don't add a column for this unless the brainstorm decides you need pack-tier analytics). |
| `cards.service.ts` | `getBinder(user)` → `BinderView` incl. `packPrice: PACK_PRICE_COINS`. `openPack(user, rng?)` → the **single hardcoded-tier** flow: charge `PACK_PRICE_COINS`, roll `PACK_SIZE` cards via `rollCard`, grant each (increment or create `UserCard`, refund dupes), all inside one `dataSource.transaction`. `grantMatchDrop(user, rng?)` → unrelated free match-end roll, do not touch. |
| `cards.controller.ts` | `GET /cards` → binder. `POST /cards/packs/open` → **no body today** — this is the endpoint that needs a tier selector. Both guarded by `JwtAuthGuard`; the POST also by the reusable `CsrfGuard`. |
| `cards.constants.spec.ts` | **Template for the tier catalogue tests.** Currently asserts `RARITY_ODDS` sums to 1.0 and every rarity has positive probability (lines 17–29) — you'll need the same assertion, looped over every tier's own odds table. |
| `cards.roll.spec.ts` | Template for roll-function tests with a seeded RNG. |
| `cards.service.spec.ts` | Template for service tests. Uses a `seq(values: number[])` deterministic RNG helper (line 41) and documented draw patterns like `PULL_STONE_NO_FOIL = [0, 0, 0.99]` (line 47) — reuse this pattern for tier-specific draw sequences, including one that proves a guarantee mechanic can't be beaten by an unlucky sequence. |

Frontend — `frontend/src/components/cards/` (this is the code from the last
few Shell Cards batches; read it before touching anything so you don't
duplicate or fight the existing tilt/foil/lightbox work):

| File | Purpose |
|---|---|
| `ShellCardsModal.tsx` | `CardSlot` (exported, clickable/keyboard-activatable, tilt+shine on hover), `CardLightbox` (exported, enlarged view, focus-trapped, gold-foil hybrid holo layer), `RevealOverlay` (pack-opening flip animation — rarity badge + gold pulse already wired in, **generic over `pulls: PackPull[]`, so a bigger/different pack should render with zero changes here**), `ShellCardsModal` (fetches the binder, **one hardcoded "Open Pack" button** gated on `coins >= binder.packPrice`, calls `api.openCardPack()` with **no arguments** — this call site is what needs to become tier-aware). Also has the rarity filter/missing-only/sort toolbar from the last batch — unrelated to this work, just don't break it. |
| `cardTilt.ts` | Pure `computeCardTilt()` + `FOIL_SHINE_INTENSITY` per rarity. No changes needed. |
| `binderFilters.ts` | Pure `filterAndSortCards()`. No changes needed. |
| `cardTilt.test.ts`, `binderFilters.test.ts` | Pure-logic Vitest specs — these **do** run fine even where the full suite can't be started with a plain Node script, since they have no React/DOM dependency; good templates for any new pure pack-tier math you add on the frontend (e.g. a live "what am I likely to get" odds display). |
| `CardSlot.test.tsx`, `CardLightbox.test.tsx`, `ShellCardsModal.test.tsx` | RTL specs. `ShellCardsModal.test.tsx` mocks the whole `api` module with `vi.mock("../../features/hub/api", () => ({ api: { getCards: vi.fn(), getCsrfToken: vi.fn(), openCardPack: vi.fn() } }))` — extend the mock binder fixture (`makeBinder()`) with whatever tier field you add, and update the `openCardPack` mock signature. |
| `frontend/src/features/hub/api.ts` (§ "Shell Cards") | Typed REST client. `CardRarity`, `CardFamily`, `CardView`, `BinderView` (has `packPrice: number` — **this needs to become tier-aware**), `PackPull`, `PackResult`. `api.getCards()`, `api.openCardPack()` (**no params today**), `api.getCsrfToken()`. These types must stay in lockstep with the backend ones in `cards.constants.ts` — there's no shared package, it's manual mirroring, so double-check both sides after any change. |
| `frontend/src/styles/global.css` (`.hub-cards__*` block, search for `hub-cards__store`) | `.hub-cards__store` / `.hub-cards__open-button` is the single buy-button styling — generalise into a tier list. Rarity accent colours and the `--foil-shine` custom property (per-rarity intensity) already exist — the legendary tier's card art in the picker could reuse the gold treatment as a "this pack is special" visual cue. |

Also read `docs/SHELL_CARDS_SPEC.md` in full — it's short, and §4 (economy),
§5 (backend shape), and §9 (conceptual test cases) are the direct model for
how this doc is structured.

### Economy anchors (for calibrating tier prices)

From `backend/src/modules/game-results/progression.constants.ts`:
`COINS_PER_WIN = 50`, `COINS_PER_LOSS = 30`, `COINS_PER_DRAW = 30`,
`COINS_PER_COMPLETED = 20`. The existing pack (100 coins) costs about 2 wins.
Cosmetic prices in `customization.constants.ts` range from free up to `999`
for the priciest skins — that's the top of the existing coin-sink scale, a
useful anchor for what "very expensive" should feel like here.

---

## 2. Proposed design (strawman — confirm with the user before building)

A `PackTier` concept: each tier has its own price, its own rarity-odds table
(which must still sum to 1.0, tested per tier), its own foil chance, and an
optional **guaranteed minimum rarity** for one slot in the pack (this is what
makes the expensive tier feel worth it, beyond just "better odds on paper").

| Tier | `priceCoins` | Rough cost in wins | `rarityOdds` (stone/bronze/jade/gold) | `foilChance` | Guarantee |
|---|---|---|---|---|---|
| `basic` (existing, unchanged) | 100 | 2 | .60 / .27 / .10 / .03 | 5% | none |
| `deluxe` | 400 | 8 | .35 / .35 / .22 / .08 | 8% | none |
| `legendary` | 1500 | 30 | .15 / .30 / .35 / .20 | 15% | **at least 1 gold-or-better in every pack** |

`PACK_SIZE` (5 cards) stays the same across tiers for the MVP — don't make
pack size a variable too unless the user asks; that's scope creep on top of
scope creep. Same for `DUPLICATE_COIN_REFUND` — it's keyed by the rolled
card's rarity, not by which pack tier granted it, and that's fine as-is.

**Open questions to raise with the user, don't guess:**
- Are 3 tiers the right number, and are these the right names/prices/odds?
- Should the guarantee be a fixed slot (e.g. always the 5th card, simplest to
  test) or a randomly-chosen slot (more "surprise," slightly more complex)?
  Recommend fixed slot for the first pass.
- Should tier odds/prices be shown to the player (transparent, matching how
  the casino module discloses RTP), or kept as flavour text ("higher rarity
  chance")? Recommend full transparency — it's consistent with this
  codebase's existing provably-fair ethos and is good practice for anything
  gacha-shaped.

---

## 3. Implementation shape

### Backend

`cards.constants.ts` — add:
- `export type PackTierId = "basic" | "deluxe" | "legendary";`
- `export interface PackTierDefinition { id: PackTierId; name: string; priceCoins: number; rarityOdds: Readonly<Record<CardRarity, number>>; foilChance: number; guaranteedMinRarity?: CardRarity; }`
- `export const PACK_TIERS: readonly PackTierDefinition[] = [...]` (the three
  rows above, each odds table a **named constant**, not inline numbers).
- Keep `RARITY_ODDS`/`FOIL_CHANCE`/`PACK_PRICE_COINS` as the `basic` tier's
  values (either re-point them at `PACK_TIERS[0]` or leave them as the
  literal source the basic tier's row references — avoid duplicating the
  numbers in two places).
- A `findPackTier(id: PackTierId): PackTierDefinition | undefined` lookup,
  mirroring `findCard`.
- Extend `BinderView` with `packTiers: PackTierView[]` (id, name, priceCoins,
  rarityOdds, foilChance, guaranteedMinRarity — whatever the transparency
  decision in §2 lands on). Decide with the user whether `packPrice` stays
  as a deprecated convenience field or gets removed outright — removing it is
  cleaner but is a breaking change to a type used in exactly one place on the
  frontend (see the table in §1), so it's a cheap removal, not a risky one.

`cards.roll.ts` — parameterise instead of hardcoding:
- `rollRarity(rng, odds: Readonly<Record<CardRarity, number>> = RARITY_ODDS)`.
- `rollCard(rng, tier: PackTierDefinition)` — rolls rarity against
  `tier.rarityOdds` and foil against `tier.foilChance`.
- New `rollGuaranteedCard(rng, minRarity: CardRarity): RolledCard` — same
  shape as `rollCard` but restricted to `CARD_RARITIES` at-or-above
  `minRarity` (use the index in `CARD_RARITIES` to slice the ladder), still
  foil-checked normally. This is what makes the legendary guarantee real
  instead of "usually."

`cards.service.ts`:
- `openPack(user, tierId: PackTierId = "basic", rng?)` — look up the tier
  (throw `BadRequestException` if unknown), charge `tier.priceCoins` instead
  of the constant, roll `PACK_SIZE` cards using `tier.rarityOdds`/`foilChance`
  via `rollCard(rng, tier)`, and if `tier.guaranteedMinRarity` is set, roll
  slot 0 (or whichever slot the brainstorm picks) via `rollGuaranteedCard`
  instead. Everything downstream (`grantCard`, dupe refund, the single
  transaction) is unchanged.

`cards.controller.ts`:
- `POST /cards/packs/open` needs a body now: `OpenPackDto { tierId?:
  PackTierId }` (class-validator `@IsOptional() @IsIn(PACK_TIER_IDS)`),
  defaulting to `"basic"` so any old client/test calling it bare doesn't
  break.

### Frontend

- `api.ts`: `PackTierId`, `PackTierView` types (mirroring the backend view
  exactly); `BinderView.packTiers`; `api.openCardPack(tierId: PackTierId)`.
- `ShellCardsModal.tsx`: replace the single `.hub-cards__store` button with a
  small tier picker — one entry per `binder.packTiers`, each showing name,
  price, and its own afford-state (`coins >= tier.priceCoins`), a
  `selectedTier` (or just one button per tier, no selection state needed) and
  `handleOpenPack(tierId)` calling `api.openCardPack(tierId)`. `RevealOverlay`
  needs no changes — it already renders whatever `PackPull[]` it's given.
- `global.css`: new `.hub-cards__pack-tier*` block; consider giving the
  legendary tier's picker card the same gold/foil visual language already
  built for gold cards (`--card-accent`, the foil shine layers) as a "this
  one's special" cue — reuse, don't reinvent.

---

## 4. Tests to write (TDD — write these first, watch them fail, then implement)

Constants (mirror `cards.constants.spec.ts`):
- `should have rarity odds that sum to 1.0 for every pack tier` (loop `PACK_TIERS`).
- `should declare a positive probability for every rarity in every tier`.
- `should price every tier above zero and in ascending order` (basic < deluxe < legendary, or whatever order is decided).
- `should keep every tier's foil chance within (0, 1)`.

Roll (mirror `cards.roll.spec.ts`):
- `should roll against the given tier's odds table, not the default` (seeded rng).
- `should roll a card at or above the guaranteed rarity when a minimum is given, for every rng draw including an all-stone sequence` — this is the one that actually proves the guarantee holds, not just "usually works."
- `should never return a rarity below minRarity from rollGuaranteedCard` (property-style: sweep many seeded rng values).

Service (mirror `cards.service.spec.ts`, reuse its `seq()` helper):
- `should charge the selected tier's price, not the basic price, when opening a deluxe or legendary pack`.
- `should reject an unknown tierId with a 400, spending no coins`.
- `should reject when coins are insufficient for the selected tier specifically (enough for basic, not for legendary)`.
- `should not double-spend coins when the grant step fails for a non-basic tier` (mirrors the existing transactional-rollback test).
- `should include a gold-or-better card among the pulls when opening a legendary pack`, across a few different seeded sequences.

Controller:
- Extend the existing auth/CSRF rejection test to also cover a bad `tierId` in the body.

Frontend (extend `ShellCardsModal.test.tsx`'s `makeBinder()` fixture with `packTiers`):
- `should show each pack tier with its own price and afford-state`.
- `should disable a tier's button when coins are insufficient for that tier specifically, even if other tiers are affordable`.
- `should call api.openCardPack with the clicked tier's id`.

Coverage target: ≥80% on the new service/roll logic; cover happy path, edge
(exact-price coins, guarantee under worst-case rng), and failure (unknown
tier, insufficient coins) paths, per this repo's testing standard.

---

## 5. Build order & checkpoints

1. **Batch 1 — Tier catalogue & roll math** (`cards.constants.ts`,
   `cards.roll.ts` + their spec files). → review.
2. **Batch 2 — Service & controller** (`openPack` tier-aware, DTO, `BinderView.packTiers`) + tests. → review.
3. **Batch 3 — Frontend** (`api.ts`, tier picker UI, CSS) + tests. → review.
4. **Batch 4 — Docs**: update `docs/SHELL_CARDS_SPEC.md` with the shipped
   tier design (don't leave it describing only the single-tier MVP); check
   `docs/modules-progress.md`'s "Game customisation options" entry.

Do not start a batch until the previous one's tests are green and reviewed.
Get the user's sign-off on §2's numbers before Batch 1 starts.

---

## 6. Acceptance criteria

- At least the three tiers in §2 (or whatever the user approves instead) are
  purchasable from the binder, each showing its own price and afford-state.
- The expensive tier visibly delivers on "rare pulls" — better odds **and** a
  guarantee that actually holds under adversarial RNG (tested, not assumed).
- RNG and coin spend remain server-authoritative and transactional, exactly
  like the existing single-tier flow.
- Every tier's rarity odds sum to 1.0 (tested, per tier).
- Cards remain purely cosmetic — nothing here touches gameplay.
- Backend: `npx jest cards` green, `tsc --noEmit` clean.
- Frontend: `tsc --noEmit` clean from your end; **the user has confirmed a
  real `npm run test:run` green** before you call this done.
- `docs/SHELL_CARDS_SPEC.md` updated to match what actually shipped.
- No regression in the existing binder UI (filters, lightbox, foil effects,
  reveal animation) — all of that is unrelated to this work and should be
  untouched.
