# Handoff: Shell Cards — Bug Audit & Fix Plan

_Audited 2026-07-07 against the current tree, using `graphify-out/graph.json` /
`graph.html` (built at the commit recorded in `graphify-out/graph.json
.built_at_commit`) to map every node and edge of the subsystem, then reading
every file in that subgraph in full. This document is the work order for the
fixing agent. Follow the working agreement in
`docs/handoff-shell-cards-prismatic-and-characters.md` §0 (tabs, named
constants, `private readonly`, test conventions, commit style)._

---

## 0. Subsystem map (from the graph — read these before fixing)

Backend (`backend/src/modules/cards/`):

- `cards.constants.ts` — catalogue (40 cards), rarity odds, `PACK_TIERS`, refunds, view types.
- `cards.roll.ts` — pure RNG helpers `rollRarity` / `rollCard` / `rollGuaranteedCard`.
- `cards.service.ts` — `getBinder`, `openPack` (transactional), `grantMatchDrop`, `grantCard`/`incrementExisting`.
- `cards.controller.ts` — `GET /cards`, `POST /cards/packs/open` (JwtAuthGuard + CsrfGuard), `dto/open-pack.dto.ts` (`@IsIn(PACK_TIER_IDS)`; global `ValidationPipe { whitelist, transform }` confirmed in `main.ts`).
- `entities/user-card.entity.ts` — unique index `(user, cardId)`, `count`/`foilCount`/`prismaticCount`.
- `migrations/20260705000000-add-user-cards-prismatic.ts` — prismatic column only.
- Inbound edge: `game-results.service.ts` → `grantMatchDrop` (best-effort, returned as `ProgressionResult.cardDrop`).

Frontend:

- `components/cards/ShellCardsModal.tsx` — binder grid, tier picker, `RevealOverlay`, `CardLightbox`, `CardSlot`.
- `components/cards/binderFilters.ts`, `cardTilt.ts` — pure helpers (both clean; no issues found).
- `features/hub/api.ts` — types + `getCards` / `openCardPack`; `ProgressionResult.cardDrop` (line ~316).
- Mounted from `HomePage.tsx` (~line 3885) inside `HubModal variant="wide"`, coins wired from `player` state.

Verified healthy: all 19 `imageUrl` assets exist under `public/assets/`
(character + power-ups); `is-foil` / `is-prismatic` /
`hub-cards__lightbox-prismatic` / `hub-cards__pack-tier*` /
`hub-cards__reveal*` CSS classes all present in `frontend/src/styles/global.css`;
odds tables and roll math are correct (including the guaranteed-slot weighting
and the conditional 4th prismatic draw); DTO validation is active; the
first-copy 23505 race path in `grantCard` works as documented.

Note: backend Jest hangs in a sandboxed environment (known environmental
issue, see prismatic handoff §0) — run `cd backend && npm run test` on the
host to verify, don't debug the sandbox.

---

## H1 — `openPack` has no row lock: concurrent opens double-grant / corrupt coins

**Severity: HIGH (economy integrity).**
`cards.service.ts` L110–142: the transaction loads the user with a plain
`findOne`, checks `current.coins < tier.priceCoins`, mutates `current.coins`,
and `usersRepo.save(current)` at the end. Postgres default READ COMMITTED +
no lock means two concurrent `POST /cards/packs/open` requests both read the
same balance, both pass the affordability check, and the last `save` wins:
the player receives two packs (10 cards + dupe refunds) while paying for one,
or ends with a wrong balance. Trivially exploitable by firing parallel
requests (the frontend's `openingTierId` guard is client-side only).

The codebase already solved this exact problem: `casino.engine.ts` L97–108
loads the player row under `lock: { mode: "pessimistic_write" }` and
deliberately avoids relations because Postgres rejects `FOR UPDATE` on the
nullable side of a LEFT JOIN.

**Fix:** inside the transaction, load the user with
`manager.getRepository(User).findOne({ where: { id }, lock: { mode: "pessimistic_write" } })`
and **drop `relations: ["profile"]`** (it isn't used, it blocks the lock, and
`save(current)` with a hydrated profile risks cascade-writing it — see L4).
Mirror the casino engine's shape.

**Tests:** unit-test that the tx manager is asked for the lock; conceptually
document the double-spend scenario (two overlapping opens → total coins
deducted = 2 × price).

---

## H2 — Prismatic migration fails on prod: `user_cards` has no create-table migration

**Severity: HIGH (deploy breaker on fresh prod).**
`20260705000000-add-user-cards-prismatic.ts` runs
`ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS ...`. `IF NOT EXISTS` guards
the column, not the table: on any database where `user_cards` was never
created, the migration errors out and halts the whole `migration:run` chain.
`app.module.ts` L41–50 confirms prod runs with `synchronize: false` and
manual migrations — and unlike every sibling entity (`create-shell-inventory`,
`create-wagers`, `create-user-cosmetics-achievements`, `create-friendships`,
`create-notifications`…), `user_cards` has **no** create migration. The
migration's own doc comment acknowledges the gap without closing it.

**Fix:** add `20260705000000`-predating migration (e.g.
`20260704990000-create-user-cards.ts`) with
`CREATE TABLE IF NOT EXISTS user_cards` matching the entity exactly: `id`
serial PK, `userId` int FK → `users(id)` `ON DELETE CASCADE`, `cardId`
varchar, `count` int NOT NULL DEFAULT 1, `foilCount` int NOT NULL DEFAULT 0,
`firstObtainedAt` timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, and the
**unique index on ("userId", "cardId")** (the 23505 race handling in
`grantCard` depends on this index existing — without it the race path is
dead code and dupes create duplicate rows). Use quoted camelCase columns
(Bug Audit H1 convention per `app.module.ts` comment). Leave the prismatic
migration as-is; it becomes safely additive.

---

## H3 — Match-drop cards are invisible to the player (`cardDrop` has zero consumers)

**Severity: HIGH (user-facing feature silently missing).**
The backend grants one card per completed match and returns it
(`game-results.service.ts` → `ProgressionResult.cardDrop`; typed in
`features/hub/api.ts` ~L316). The graph shows **no consumer**: all four game
scenes (`KameKnockScene` L1206, `BellClashScene` L1041, `BambooBashScene`
L1228, `ShellCurlScene` L1370) call `api.submitGameResult(...)` and use only
`unlockedAchievements`. The player's binder gains cards they were never
shown; the "delightful to open" moment (spec §1) never happens; earn-by-
playing (spec §4.1) looks broken to anyone watching their binder.

**Fix:** surface `result.cardDrop` after each match — the spec (§6) points at
the `achievement-popup` style; `shared/achievement-popup.ts` is the model and
`showAchievementUnlocks` is already called at the exact spot in all four
scenes. A small "Card earned: <name> (<rarity>)" toast (with foil/prismatic
tag) is enough for a first pass. Do it once in a shared helper, not four
copies.

**Tests:** unit-test the new popup helper (happy, null-drop, prismatic
labelling); manual validation note for the scenes per project convention.

---

## M1 — Pack succeeds but UI says it failed when the binder refresh throws

**Severity: MEDIUM.** `ShellCardsModal.tsx` L489–505: `handleOpenPack` does
purchase → `onCoinsChange` → `setReveal` → `setBinder(await api.getCards())`
inside **one** try/catch. If only the trailing `getCards()` fails, the user
sees the reveal overlay **and** the error "Could not open pack. Try again."
— coins were spent, so they may buy again believing the first attempt failed.
The binder grid also stays stale (new cards not marked owned).

**Fix:** split into two try/catches. Purchase failure → keep the current
message (ideally surface the server's message, e.g. "Not enough coins", which
also covers the stale-`coins`-prop race). Refresh failure → keep the reveal,
set a softer "Pack opened — couldn't refresh the binder" error, and/or retry
the refresh when the reveal is dismissed.

**Tests (Vitest):** `should keep the reveal and not show the purchase-failure
message when only the binder refresh fails`.

---

## M2 — Non-atomic `count += 1` increments can lose grants under concurrency

**Severity: MEDIUM.** `incrementExisting` (`cards.service.ts` L235–255) does
read-modify-write: `existing.count += 1; repo.save(existing)`. Two
near-simultaneous grants of the same owned card (two match completions, or a
match drop racing a pack open — `grantMatchDrop` runs **outside** any
transaction on `this.userCardsRepo`) can both read count=N and both write
N+1, losing a copy (and potentially a foil/prismatic increment). The 23505
handler only covers the *first-copy* race, not increments.

**Fix:** use atomic SQL increments —
`repo.increment({ id: existing.id }, "count", 1)` plus conditional
`increment(..., "foilCount", 1)` / `"prismaticCount"` — or a single
QueryBuilder `UPDATE ... SET count = count + 1, ...`. The `pull`/`refund`
return values don't depend on the persisted totals, so the shape is
unchanged. (H1's pessimistic lock protects pack-vs-pack, not
matchdrop-vs-anything, so this is still needed.)

**Tests:** `should persist increments atomically (increment called, no stale
entity save)`; keep all existing dupe/foil/prismatic specs green.

---

## M3 — RevealOverlay is a `role="dialog"` with no focus management

**Severity: MEDIUM (a11y).** `ShellCardsModal.tsx` L235–331: the reveal
overlay declares `role="dialog" aria-modal="true"` but, unlike
`CardLightbox` (L350–383, which moves focus in, traps Tab, closes on Escape,
and restores focus), it does none of that. A keyboard user's focus stays on
the "Open pack" button behind the overlay; Tab wanders the obscured binder;
Escape does nothing.

**Fix:** reuse the lightbox's focus-trap effect (extract it into a shared
hook, e.g. `useDialogFocusTrap(containerRef, onDismiss)`, rather than a third
copy — HubModal has the same pattern per the L349 comment). Initial focus →
first face-down card; Escape → `onDismiss`.

**Tests:** mirror the existing `CardLightbox.test.tsx` focus specs for the
overlay.

---

## M4 — Binder load failure is a dead end (no retry)

**Severity: MEDIUM.** `ShellCardsModal.tsx` L470–487 + L507–508: if the
initial `getCards()` fails (flaky network, cold backend), the modal renders
only "Could not load your binder." — no retry; the user must close and
reopen the modal. `useSessionGate`-style retry or a simple "Retry" button
that re-triggers the effect is enough.

**Tests:** `should reload the binder when Retry is clicked after a failed
load`.

---

## Low severity / polish (batch into one commit)

- **L1 — Doc drift on catalogue size.** Code has **40** cards (21 power + 5
  shrine + 3 skin + **11** characters — `char-pirate` and `char-samurai` are
  uncounted in docs). `docs/SHELL_CARDS_SPEC.md` §3 says "37 cards" and
  `docs/modules-progress.md` L332 repeats it. The spec's own header forbids
  drift. Update both (and modules-progress per CLAUDE.md rules).
- **L2 — Pack store doesn't show the coin balance** inside the modal (spec §6:
  "shows coin balance, pack price"). The hub header is occluded by the wide
  modal. Add the balance next to the Collection counter (the `coins` prop is
  already there).
- **L3 — Silent error swallowing server-side.** `openPack`'s catch
  (`cards.service.ts` L143–146) rethrows a bare
  `InternalServerErrorException("Failed to open card pack")` with no log of
  the cause; same for `grantMatchDrop` (L167–170), whose failures are then
  swallowed by design in `game-results.service.ts` L108–112. Add a
  `private readonly logger = new Logger(CardsService.name)` and
  `logger.error(...)` with the original error before wrapping, and a
  `logger.warn` in the game-results catch — otherwise a systemic drop failure
  is invisible in prod.
- **L4 — Drop `relations: ["profile"]`** from `openPack`'s user load (unused,
  blocks the H1 lock, and `save(current)` with hydrated relations risks
  clobbering concurrent profile writes). Also drop `relations: ["user"]` from
  `findOwnedRows`/`grantCard` lookups where only the FK is needed — pure
  overhead on every binder read (query by `{ user: { id } }` works without
  hydrating the relation).
- **L5 — `shineBadgeText` computed twice** per `CardSlot` render (L225–228).
  Hoist to a local.
- **L6 — Stale `CardView` snapshot in the lightbox**: `selectedCard` is a
  copy; if the binder refreshes underneath, counts in an open lightbox go
  stale. Re-derive from `binder.cards` by id when rendering, or accept and
  document.

---

## Explicitly checked, NOT bugs (don't "fix" these)

- `rollGuaranteedCard` weighting and the fixed guaranteed slot are correct;
  the `Math.min(..., pool.length - 1)` guard and the sum-to-1 fallback are
  intentional.
- The conditional 4th prismatic RNG draw must **stay conditional** (doc
  comments in `cards.roll.ts` L44–53 explain the fixed-sequence test
  dependency).
- The 23505 first-copy race handler in `grantCard` is correct (given H2
  restores the unique index on prod).
- Duplicate-refund economics (5 gold dupes refund 150 > basic pack's 100) is
  by design — odds make it a lottery, not an exploit.
- All card `imageUrl` assets exist; all referenced CSS classes exist.
- `OpenPackDto` validation is live (global `ValidationPipe`), CSRF + JWT
  guards are wired, and the frontend fetches a CSRF token before opening.

## Suggested fix order

H2 → H1 → M2 (backend, one PR each), then H3 → M1 → M3 → M4 (frontend), then
the L batch. After backend changes: `make rebuild-back`; run
`cd backend && npm run test:cov` on the host (sandbox Jest hangs —
environmental). Frontend: `npm run test:run` on the host per the prismatic
handoff's caveat. Update `docs/SHELL_CARDS_SPEC.md` + `docs/modules-progress.md`
in the same task as L1 (CLAUDE.md requirement).
