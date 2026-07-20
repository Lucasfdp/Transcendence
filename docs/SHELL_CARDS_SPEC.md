# Shell Cards — Feature Spec

_Status: approved design, pre-implementation. Authored 2026-06-27._

This document is the spec that code review checks implementation against
(per the team's brainstorm → TDD → execute-plan workflow). Update it if the
design changes; don't let code and spec drift.

---

## 1. Goal

Replace the "Shell Cards" placeholder (the Dojo Extra in `HomePage.tsx`, today a
"coming soon" modal; the "Pabellón de cartas" on the dojo map) with a real
**collectible card binder**.

Primary driver: **it should be fun to collect.** Retention and giving the coin
economy a sink are welcome side effects, not the bar. The bar is "delightful to
open packs and fill the binder."

Non-negotiable from the brainstorm:

- **Purely cosmetic.** Cards have **no gameplay effect**. Zero pay-to-win risk.
- Reuse existing game entities for card content so we don't need a new art pipeline.

---

## 2. Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Concept | Collectible binder, B+C blend: rarity/foil collectible cards, earned by playing + bought in packs, discovery-driven |
| Card effect | Purely cosmetic — collection, sets, foils, bragging rights only |
| Acquisition | Earn by playing **+** buy packs with coins **+** daily login/streak |
| Explicitly excluded | Crafting/dust economy, card battles, trading, any in-match perk |
| First pass | **MVP** (see §7), then phase 2 |

---

## 3. What's on the cards

Most card subjects reuse entities that already exist in the codebase, so "art"
is a procedurally-drawn frame around an existing icon/thumbnail (see §6).
`character` cards may instead supply static art via an optional `imageUrl`.

Catalogue families (`CardFamily`) and current counts:

- **`power_shell`** — one per `PowerType` (21: HEAVY, BOMB, GHOST, MAGNET,
  VORTEX, …). Subject art = the icon already drawn in `ShellPickerScene`.
- **`shrine`** — one per minigame (5: Kame Knock, Bell Clash, Temple Curling,
  Bamboo Bash, River Rush).
- **`shell_skin`** — drawn from the existing cosmetics catalogue
  (3: `customization.constants` `COSMETICS`, `shell_skin` entries).
- **`character`** — lore/character cards, the rare chase. Shipped with the
  inaugural legendary **Shinigame, the Shell Reaper** (`char-reaper`, gold),
  which uses static art at `imageUrl: /assets/character/reaper-turtle.jpg`
  (JPG/PNG/WebP all fine; falls back to a procedural frame if the file is
  absent). Also includes **Santa Kame, the Yuletide Shell** (`char-santa`,
  gold, `imageUrl: /assets/character/santa-turtle.webp`), **Kagemusha,
  the Assassin Shell** (`char-assassin`, gold,
  `imageUrl: /assets/character/assassin-turtle.webp`), **Yurei, the
  Wandering Ghost Shell** (`char-ghost`, gold,
  `imageUrl: /assets/character/ghost-turtle.webp`), **Sumo, the
  Immovable Shell** (`char-sumo`, gold,
  `imageUrl: /assets/character/sumo-turtle.webp`), **Kamigame, the Godly
  Shell** (`char-godly`, gold, `imageUrl: /assets/character/godly-turtle.png`),
  **Akuma, the Demon Shell** (`char-demon`, gold,
  `imageUrl: /assets/character/demon-turtle.png`), **Kishi, the Knight
  Shell** (`char-knight`, gold, `imageUrl: /assets/character/knight-turtle.png`),
  **Irie Kame, the Roots Shell** (`char-rasta`, gold,
  `imageUrl: /assets/character/rasta-turtle.png`), **Kaizoku, the Corsair
  Shell** (`char-pirate`, gold, `imageUrl: /assets/character/pirate-turtle.webp`),
  and **Kabuto, the Bushido Shell** (`char-samurai`, gold,
  `imageUrl: /assets/character/samurai-turtle.webp`) — the last two were
  previously missing from this list even though they shipped in the catalogue
  (Bug Audit L1, `docs/handoff-shell-cards-bug-audit-and-fix-plan.md`). Also
  includes **Shelly, El Conchudo** (`char-presenter`, gold,
  `imageUrl: /assets/character/presenter-turtle.png`), the tournament-mode
  presenter turtle. Total catalogue: **41 cards** (21 power_shell + 5 shrine +
  3 shell_skin + 12 character).

### Rarity & foils

- Rarity ladder, dojo-themed: **Stone → Bronze → Jade → Gold** (4 tiers).
- Every card can also appear as a **foil** variant (shimmer/tint overlay). Foils
  are the chase; they are a flag on an owned card, not separate catalogue entries.
- Rarity and foil are **cosmetic only** — they do not affect gameplay or grant
  any in-match advantage.

---

## 4. Economy & acquisition

Three sources. All grants are **server-authoritative** — the client never tells
the server which cards it received.

1. **Earn by playing**
   - Match-end drop: completing a match grants 1 card roll (rarity-weighted).
   - Discovery unlocks (phase 2): first time a player *uses* a given power-shell
     in a match → that power-shell card is granted; first clear of a shrine →
     that shrine card is granted.
2. **Buy packs with coins** (the coin sink)
   - A pack costs a fixed coin price (named constant, not a magic number) and
     yields N cards (named constant) rolled against published rarity odds.
   - Coin deduction and card grant happen in **one DB transaction**; if the grant
     fails the coins are not spent.
3. **Daily login / streak** (phase 2)
   - One free pack/card per day; consecutive-day streak escalates the reward.

### Duplicates

No crafting/dust. A duplicate increments the card's `count` (foil dupes increment
`foilCount`) and trickles back a small, fixed coin refund so no pull feels dead.

### RNG rules

- Pack/drop RNG runs **only on the server**.
- Rarity odds are named constants in one place, summing to 1.0 (asserted in a
  test). No `0.0`/zero-fraction noise — use clean literals.

---

## 5. Backend shape (mirrors the existing `customization` module)

- `cards.constants.ts` — `CARDS` catalogue (`id`, `family`, `rarity`, `name`,
  `flavor`, `sourceRef` → powerType/cosmeticId/gameId, optional `imageUrl`),
  plus rarity odds, pack size, pack price, dupe-refund constants. Also the view
  types (`CardView`, `BinderView`, `PackPull`, `PackResult`).
- `cards.roll.ts` — pure, injectable-RNG roll helpers (`rollRarity`,
  `rollCard`) so odds are deterministically testable.
- `entities/user-card.entity.ts` — `UserCard` (`userId`, `cardId`, `count`,
  `foilCount`, `firstObtainedAt`). Analogous to `UserCosmetic`.
- `cards.service.ts` —
  - `getBinder(user)` → owned + locked view, per-family set progress, plus
    **`packPrice`** (server-authoritative, so the client hardcodes nothing).
  - `openPack(user, rng?)` → server RNG + transactional coin spend + dupe refund.
  - `grantMatchDrop(user, rng?)` → best-effort free card on match completion
    (wired into `GameResultsService.submitResult`, returned as `cardDrop`).
- `cards.controller.ts` — `GET /cards`, `POST /cards/packs/open` (the latter
  guarded by `JwtAuthGuard` + the new reusable `CsrfGuard`). Phase 2:
  `POST /cards/daily/claim`.

### Coding standards to enforce here (team standards)

- Constructor deps that are never reassigned → `private readonly`.
- Every `async` external call (DB tx, coin update) wrapped in `try/catch` with a
  meaningful surfaced error; no unhandled promise rejections.
- Coin price, pack size, rarity odds, dupe refund → **named constants**, no magic
  numbers.
- No secrets/credentials in code; nothing dev-only exposed without a gate.

---

## 6. Frontend shape

- Replace the placeholder `setInfoModal({ title: "Shell Cards", … })` in
  `HomePage.tsx` with a real **Pabellón de cartas** view (Phaser scene or React
  modal — match whatever the other Dojo Extras use; Customisation is the model).
- **Binder grid**: grouped by set, locked slots as `???` silhouettes, owned cards
  in rarity-coloured frames, foils shimmer, per-set progress (`7/12`).
- **Pack store**: shows coin balance, pack price, "Open pack" button.
- **Pack-opening animation**: the headline fun moment — cards flip/reveal one by
  one, rarity flash, foil sparkle. This is where polish budget goes.
- Reuse `NineSliceButton`, `THEME`, and the `achievement-popup` style for
  consistency. Card art = procedural frame (by rarity) + existing power icon /
  skin thumbnail + foil overlay. **No new sprite-art pipeline.**
- Prefer `globalThis` over `window` where applicable.

---

## 7. Scope: MVP vs later

### MVP (first pass — build this)

1. `CARDS` catalogue (power-shells + shrines + skins) + rarity odds/constants.
2. `UserCard` entity + migration-safe (`synchronize` outside prod).
3. `GET /cards` binder view (owned + locked + set progress).
4. Match-end card drop (earn-by-playing, the basic roll).
5. `POST /cards/packs/open` — coin packs with server RNG + transactional spend.
6. Binder UI + pack store + **pack-opening animation**.
7. Foils included (cheap: a flag + tint), since they carry most of the "fun."

### Phase 2 (later)

- Daily login / streak claim.
- Discovery unlocks (first-use power, first-clear shrine).
- Lore/character rare cards; set-completion bragging (cosmetic title/badge only).

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| No sprite-art pipeline (scenes are procedural) | Procedural frame + reuse existing icons/thumbnails; foil = tint/shimmer |
| "Shell" is overloaded (skins vs power-shells) | UI copy disambiguates: cards are a *collection*; never implies a card is needed to use a shell |
| Pay-to-win perception | Cards are cosmetic-only by design; documented and enforced |
| Scope creep on a "for fun" feature | Phased plan; crafting/trading/events explicitly out |
| Client-trust on RNG/coins | All RNG + coin spend server-side, in one transaction |

---

## 9. Conceptual test cases (TDD targets)

Service:

- `should deduct exactly the pack price and grant N cards when opening a pack with sufficient coins`
- `should throw and spend no coins when the user has insufficient coins for a pack`
- `should not double-spend coins when the card-grant step fails (transaction rolls back)`
- `should increment count (not duplicate the row) when granting a card the user already owns`
- `should increment foilCount and refund the fixed dupe amount when a duplicate foil is granted`
- `should return locked-slot entries for unowned catalog cards in the binder view`
- `should produce rarity outcomes within published odds over a large sample (seeded RNG)`

Constants:

- `should have rarity odds that sum to 1.0`

Controller:

- `should reject pack open without a valid JWT / CSRF token`

Coverage target: ≥80% on the service business logic; cover happy path, edge
(already-owned, foil dupe, empty inventory) and failure (insufficient coins, tx
failure) paths.

---

## 10. Implementation batches (for execute-plan)

Each batch is independently testable and reviewed before the next begins (TDD
within each).

- **Batch 1 — Catalogue & constants.** `CARDS`, rarity odds (sum-to-1 test), pack
  price/size/refund constants.
- **Batch 2 — Persistence.** `UserCard` entity + repo wiring.
- **Batch 3 — Binder read.** `listBinder` + `GET /cards` (owned/locked/progress).
- **Batch 4 — Pack open.** Server RNG + transactional coin spend + `POST /cards/packs/open`.
- **Batch 5 — Match-end drop.** Hook into match completion to grant a roll.
- **Batch 6 — Frontend binder + pack store + opening animation.**

Phase 2 batches (daily streak, discovery unlocks, lore cards) are planned after
MVP review.

---

## 11. Pack tiers (shipped)

_Added 2026-07-05, after the original MVP above shipped with a single pack.
See `docs/handoff-shell-cards-pack-tiers.md` for the brainstorm this
implements._

The single 100-coin pack became three purchasable **tiers**, cheapest to
priciest. Only price, rarity odds, foil chance, and (for the top tier) a
guarantee differ between tiers — pack size (5 cards), the duplicate-refund
table, and every downstream mechanic (transactional coin spend, grant/refund
logic, the reveal animation) are unchanged and shared across all tiers.

| Tier | Price (coins) | Rough cost in wins | Stone / Bronze / Jade / Gold | Foil chance | Guarantee |
|---|---|---|---|---|---|
| `basic` | 100 | 2 | 60% / 27% / 10% / 3% | 5% | none |
| `deluxe` | 400 | 8 | 35% / 35% / 22% / 8% | 8% | none |
| `legendary` | 1500 | 30 | 15% / 30% / 35% / 20% | 15% | **at least one gold-or-better card, every pack** |

Design decisions locked for this batch:

- **Odds are fully transparent to the player.** `GET /cards` returns
  `packTiers`, and every tier's price, rarity odds, foil chance, and
  guarantee (if any) are shown in the pack-picker UI — no hidden odds,
  consistent with the casino module's provably-fair disclosure ethos.
- **The guarantee is a fixed slot, not a random one.** The legendary tier's
  guaranteed gold-or-better card always lands in the last pack slot
  (`GUARANTEED_SLOT_INDEX = PACK_SIZE - 1` in `cards.constants.ts`), rolled
  via `rollGuaranteedCard` — a variant of `rollCard` restricted to rarities
  at or above the guaranteed minimum, so the guarantee holds under any RNG
  sequence, not just "usually." Fixed slot was chosen over a randomised slot
  for simplicity of both the implementation and its tests.
- **Pack size and duplicate refunds stay tier-independent.** Every tier
  still yields exactly `PACK_SIZE` (5) cards, and `DUPLICATE_COIN_REFUND` is
  keyed by the rolled card's rarity, not by which tier granted it.
- **`packPrice` was removed from `BinderView`** in favor of `packTiers`
  (each tier carries its own `priceCoins`) — a clean breaking change since
  the field had exactly one call site on the frontend.
- **Match-end drops (`grantMatchDrop`) always roll against the basic tier's
  odds**, unchanged from the original MVP — there is no "tier" to select for
  a free, earn-by-playing drop.

### Backend shape (tier additions)

- `cards.constants.ts` — `PackTierId`, `PackTierDefinition`, `PackTierView`,
  `PACK_TIERS` (the three rows above, each odds table a named constant),
  `PACK_TIER_IDS`, `findPackTier(id)`, `GUARANTEED_SLOT_INDEX`,
  `BASIC_PACK_TIER` (used by `grantMatchDrop`).
- `cards.roll.ts` — `rollRarity(rng, odds?)` now takes an odds table
  (defaults to the basic tier's `RARITY_ODDS`); `rollCard(rng, tier)` rolls
  against a given tier's odds/foil chance; `rollGuaranteedCard(rng, tier,
  minRarity)` restricts the rarity draw to `minRarity`-or-above.
- `cards.service.ts` — `openPack(user, tierId = "basic", rng?)` looks up the
  tier (400 `BadRequestException` if unknown, no coins spent), charges
  `tier.priceCoins`, and rolls the guaranteed slot via `rollGuaranteedCard`
  when the tier declares one. `getBinder` returns `packTiers` instead of
  `packPrice`.
- `cards.controller.ts` — `POST /cards/packs/open` takes an `OpenPackDto`
  body (`{ tierId?: PackTierId }`, validated with `@IsIn(PACK_TIER_IDS)`),
  defaulting to `"basic"` so a bare call keeps working.

### Frontend shape (tier additions)

- `features/hub/api.ts` — `PackTierId`, `PackTierView`, `BinderView.packTiers`,
  `api.openCardPack(tierId)`.
- `components/cards/ShellCardsModal.tsx` — the single "Open Pack" button
  became a `.hub-cards__pack-tiers` picker, one card per tier, each showing
  its name, a full odds/foil/guarantee summary, its own afford-state, and an
  "Opening..." state scoped to that tier. `RevealOverlay` needed no changes.
- `styles/modules/cards.css` — `.hub-cards__pack-tier*`; the legendary tier reuses
  the gold rarity accent colour as a "this pack is special" visual cue.

---

## 12. Prismatic — a rarer-than-foil tier for gold cards (shipped)

_Added 2026-07-05. See
`docs/handoff-shell-cards-prismatic-and-characters.md` for the brainstorm
this implements. Landed alongside 4 new gold character cards (§3), an
unrelated catalogue extension._

**Prismatic is not a 5th rarity tier.** The rarity ladder stays
Stone → Bronze → Jade → Gold (4 tiers). Prismatic is a rarer, flashier
cosmetic state layered on top of the existing foil flag, reachable only by
gold-rarity cards. Modeled as two orthogonal booleans (`foil`, `prismatic`)
rather than a 3-state enum — the smallest possible diff against the
existing boolean `foil` field used throughout the codebase. `prismatic:
true` always implies `foil: true`, and `prismaticCount ≤ foilCount ≤ count`
holds for every owned card.

- **Odds:** `PRISMATIC_CHANCE_FRACTION = 0.1` — 10% of foil-gold pulls
  upgrade to prismatic, applied only after the roll already landed
  gold + foil. This is a flat, tier-independent fraction, but the
  end-to-end rate still scales per pack tier for free because it's
  conditioned on that tier's own `foilChance` (basic 5% foil → effective
  0.5% prismatic; deluxe 8% → effective 0.8%; legendary 15% → effective
  1.5%).
- **No new economy tier.** A prismatic duplicate refunds the same
  `DUPLICATE_COIN_REFUND.gold` as any other gold-foil duplicate — purely a
  rarer cosmetic flex, no crafting/dust, no bonus refund.
- **Ownership tracking:** `UserCard.prismaticCount`, nested inside the
  existing `foilCount`/`count` columns. A prismatic pull increments both
  `foilCount` and `prismaticCount`.
- **Badge/visual priority:** since prismatic always implies foil, the UI
  shows exactly one shine badge per card — prismatic when owned
  (`✵ Prismatic`, `×N` above one copy), otherwise the plain foil badge
  (`✦ foil`), otherwise nothing. The existing gold+foil hybrid holo layer in
  the card lightbox is untouched; prismatic adds an *additional* layer
  (`.hub-cards__lightbox-prismatic` / `.is-prismatic`) on top of it, shown
  only when the card has at least one prismatic copy, so a plain gold foil
  keeps its existing holo look unchanged.

### Backend shape (Prismatic additions)

- `cards.constants.ts` — `PRISMATIC_CHANCE_FRACTION`; `CardView.prismaticCount`.
- `cards.roll.ts` — `RolledCard.prismatic`; `rollCard`/`rollGuaranteedCard`
  each consume a **conditional 4th draw** — only when the roll already
  landed gold + foil — so every existing fixed-draw-sequence test (3 draws
  per card for non-gold/non-foil rolls) keeps passing unmodified.
- `cards.service.ts` — `PackPull.prismatic`; `grantCard`/`incrementExisting`
  set/increment `prismaticCount` alongside `foilCount` whenever
  `rolled.prismatic` is true. Duplicate refund logic is unchanged (still
  keyed only by the card's rarity).
- `entities/user-card.entity.ts` — `UserCard.prismaticCount` column
  (int, default 0). Migration:
  `migrations/20260705000000-add-user-cards-prismatic.ts` (prod-only;
  `synchronize` covers the dev container). Note: there was already no
  migration at all for the original `user_cards` table (`count`/`foilCount`
  predate any migration) — a pre-existing gap, not backfilled here.

### Frontend shape (Prismatic additions)

- `features/cards/contracts.ts` — `CardView.prismaticCount`, `PackPull.prismatic` (moved from `features/hub/api.ts` — see `docs/frontend-cards-and-gambling-migration-phases.md`).
- `components/cards/CardSlot.tsx` — `prismaticBadgeText()` and
  `shineBadgeText()` (picks prismatic-or-foil-or-none, never both), now
  exported for `CardLightbox` to reuse; `CardSlot` and `CardLightbox` add an
  `is-prismatic` class alongside `is-foil`; `CardLightbox` adds the
  `.hub-cards__lightbox-prismatic` layer gated on
  `rarity === "gold" && prismaticCount > 0`; `RevealOverlay`'s tag shows
  "✵ Prismatic" in place of "✦ foil" for a prismatic pull.
- `styles/modules/cards.css` — `.hub-cards__card.is-prismatic::after` (a faster,
  rainbow-hued shimmer overriding the plain foil sweep) and
  `.hub-cards__lightbox-prismatic` (an additional conic-gradient layer atop
  the existing holo, spinning the opposite direction for visual distinction);
  both respect `prefers-reduced-motion`.
