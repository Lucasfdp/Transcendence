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

Catalog families (`CardFamily`) and current counts:

- **`power_shell`** — one per `PowerType` (21: HEAVY, BOMB, GHOST, MAGNET,
  VORTEX, …). Subject art = the icon already drawn in `ShellPickerScene`.
- **`shrine`** — one per minigame (5: Kame Knock, Bell Clash, Temple Curling,
  Bamboo Bash, River Rush).
- **`shell_skin`** — drawn from the existing cosmetics catalog
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
  `imageUrl: /assets/character/ghost-turtle.webp`), and **Sumo, the
  Immovable Shell** (`char-sumo`, gold,
  `imageUrl: /assets/character/sumo-turtle.webp`). Total catalog:
  **33 cards**.

### Rarity & foils

- Rarity ladder, dojo-themed: **Stone → Bronze → Jade → Gold** (4 tiers).
- Every card can also appear as a **foil** variant (shimmer/tint overlay). Foils
  are the chase; they are a flag on an owned card, not separate catalog entries.
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

- `cards.constants.ts` — `CARDS` catalog (`id`, `family`, `rarity`, `name`,
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
  modal — match whatever the other Dojo Extras use; Customization is the model).
- **Binder grid**: grouped by set, locked slots as `???` silhouettes, owned cards
  in rarity-colored frames, foils shimmer, per-set progress (`7/12`).
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

1. `CARDS` catalog (power-shells + shrines + skins) + rarity odds/constants.
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

- **Batch 1 — Catalog & constants.** `CARDS`, rarity odds (sum-to-1 test), pack
  price/size/refund constants.
- **Batch 2 — Persistence.** `UserCard` entity + repo wiring.
- **Batch 3 — Binder read.** `listBinder` + `GET /cards` (owned/locked/progress).
- **Batch 4 — Pack open.** Server RNG + transactional coin spend + `POST /cards/packs/open`.
- **Batch 5 — Match-end drop.** Hook into match completion to grant a roll.
- **Batch 6 — Frontend binder + pack store + opening animation.**

Phase 2 batches (daily streak, discovery unlocks, lore cards) are planned after
MVP review.
