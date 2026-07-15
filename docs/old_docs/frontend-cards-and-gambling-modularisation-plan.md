# Frontend Cards and Gambling Modularisation Plan

## Purpose

This plan defines a structural refactor of the frontend Cards and Gambling domains. It separates React presentation from API access, domain contracts, deterministic rules, animation calculations, generic hooks, and Phaser integration.

The refactor must preserve the current behaviour, styling, backend routes, request and response bodies, fairness calculations, game economy, and user-facing terminology. `gambling` is the frontend domain name only; the backend continues to expose `/casino/*` routes.

This work is an internal modularisation. It does not add a subject module or complete any item in `docs/modules-progress.md`.

## Current Problem

The current directory boundaries describe where a feature is rendered rather than who owns its behaviour:

- `frontend/src/components/cards/` contains React components alongside binder filtering, sorting, and card-tilt calculations.
- `ShellCardsModal.tsx` exports `ShellCardsModal`, `CardSlot`, `RevealOverlay`, and `CardLightbox`, while also containing the rarity badge, shared labels, display formatting, and pointer-driven tilt integration.
- `frontend/src/components/casino/` contains six React modals alongside fairness verification, deterministic game rules, geometry, animation timing, canvas helpers, and the generic `useReducedMotion` hook.
- Cards and gambling contracts are declared in `frontend/src/features/hub/api.ts`, even though they are not owned by the Hub domain.
- Cards and gambling API operations are methods of the Hub `api` object.
- Generic HTTP transport, CSRF handling, retries, file uploads, and shared errors are private implementation details of `features/hub/api.ts`, which prevents feature clients from depending on a neutral service.
- `frontend/src/shared/card-drop-popup.ts` is a Cards-specific Phaser adapter and duplicates rarity presentation data from the binder UI.

These placements create upward or sideways dependencies from domain logic into `features/hub`, make pure rules appear to be UI details, and allow large component files to become accidental domain modules.

## Goals

- Make Cards and Gambling explicit feature modules with clear public APIs.
- Keep component directories limited to React presentation and React interface tests.
- Give pure contracts, rules, calculations, and adapters a domain owner.
- Extract the HTTP transport once without duplicating CSRF or retry behaviour.
- Preserve all current user-visible and backend behaviour.
- Remove obsolete locations in the same migration rather than retaining compatibility re-exports.

## Non-Goals

- No backend changes.
- No route, payload, response, fairness, probability, payout, or coin-economy changes.
- No visual redesign or CSS class renaming.
- No new Cards or Gambling functionality.
- No changes to the module claims in `docs/modules-progress.md` solely because of this refactor.
- No edits to `docs/deprecated/` or `docs/old_docs/`.

## Target Dependency Direction

The permitted dependency direction is:

```text
pages
  -> components
      -> features
          -> services / shared
```

The rules behind this direction are:

- Pages compose feature UI and may call feature public APIs.
- Components render state, collect user input, and delegate domain work to feature modules.
- Feature modules own their contracts, feature clients, pure rules, calculations, and framework-specific adapters.
- Services own application-wide infrastructure such as HTTP transport.
- Shared modules contain genuinely cross-domain primitives only, not code belonging to Cards or Gambling.
- `features/cards` and `features/gambling` must not import from `pages`, `components`, or `features/hub`.
- `components/cards` and `components/gambling` must import domain contracts and operations from their corresponding feature public API, not from `features/hub/api`.
- `features/hub` may import the `PackPull` type from the Cards public contracts solely to retain `ProgressionResult.cardDrop`; Cards must not import back from Hub.
- Domain modules must not duplicate contracts, clients, labels, constants, or rules to avoid a dependency.

## Target Ownership

### Shared API transport

`frontend/src/services/api/apiClient.ts` will own the neutral HTTP infrastructure currently embedded in `features/hub/api.ts`:

- API base URL resolution;
- `apiFetch` and its idempotent retry option;
- `apiUploadFile`;
- cookie-based credentials;
- CSRF token discovery, caching, refresh, and one-time replay after a CSRF rejection;
- transient HTTP retry policy;
- empty-response handling;
- backend error-message parsing;
- `AuthError` and `NetworkError`.

Its tests will move from `frontend/src/features/hub/api.test.ts` to `frontend/src/services/api/apiClient.test.ts`. They must continue to cover safe GET retries, explicit idempotent mutation retries, non-idempotent mutation gating, exhausted retries, non-transient failures, normal upload responses, and empty upload responses.

Feature clients will depend on this transport. They must not implement their own `fetch`, CSRF, retry, upload, or error-handling variants.

### Cards feature

`frontend/src/features/cards/` will own:

- `CardRarity`, `CardFamily`, `CardView`, `CardSetProgress`, `BinderView`, `PackTierId`, `PackTierView`, `PackPull`, and `PackResult`;
- `cardsApi`;
- binder filtering, sorting, family order, rarity order, and shared Cards labels;
- card tilt and shine calculations;
- the Phaser card-drop notification adapter currently in `shared/card-drop-popup.ts`;
- pure unit tests for those contracts and behaviours.

The feature must expose at least:

```ts
cardsApi.getCards(): Promise<BinderView>
cardsApi.openCardPack(tierId: PackTierId): Promise<PackResult>
```

These operations must keep the existing endpoints and payloads:

| Operation | HTTP contract |
| --- | --- |
| `getCards()` | `GET /cards` |
| `openCardPack(tierId)` | `POST /cards/packs/open` with `{ tierId }` |

The current `binderFilters.ts`, `cardTilt.ts`, `shared/card-drop-popup.ts`, and their tests move under this feature. Shared rarity glyphs, family labels, rarity labels, and family ordering should have one Cards-owned definition where they are needed by more than one Cards view or adapter.

### Cards components

`frontend/src/components/cards/` will contain React presentation only:

```text
components/cards/
  ShellCardsModal.tsx
  ShellCardsModal.test.tsx
  CardSlot.tsx
  CardSlot.test.tsx
  CardLightbox.tsx
  CardLightbox.test.tsx
  RevealOverlay.tsx
  RevealOverlay.test.tsx
  CardRarityBadge.tsx
  CardRarityBadge.test.tsx
```

Each exported React component must have its own implementation file. Component-local presentational helpers may remain private in the component that uses them, but filtering, ordering, tilt mathematics, labels shared with Phaser, and API calls belong to `features/cards`.

`ShellCardsModal` remains responsible for orchestration of the binder UI: loading and retry state, filters, pack selection, reveal sequencing, lightbox selection, focus management, and coin-balance callbacks. It delegates domain calculations and transport calls through the Cards feature.

### Gambling feature

`frontend/src/features/gambling/` will own:

- all current gambling request and response contracts;
- `gamblingApi`;
- provably-fair verification;
- pure rules for Wheel, Shell Flip, Three-Shell Monte, Shrine Slots, Koi Dice, and Shell Drop;
- Monte shuffle calculations;
- board geometry, drop paths, spin and flip rotations, slot reel calculations, easing functions, canvas setup, and animation scheduling;
- pure unit tests for these behaviours.

The following current logic modules move from `components/casino` into this feature:

```text
board-canvas.ts
dice.ts
drop-path.ts
fairness.ts
flip.ts
flip-rotation.ts
monte.ts
plinko.ts
shuffle.ts
slots.ts
spin-rotation.ts
wheel.ts
```

Their final internal folders may group `api`, `contracts`, `fairness`, `games`, `geometry`, and `animation`, but ownership and the public import boundary are mandatory. Pure tests, including `monte.test.ts`, move with the logic they verify.

The contracts moved from `features/hub/api.ts` include:

- `WheelSegment`, `WheelSegmentView`, `WheelView`, and `SpinResult`;
- `CasinoGame`, renamed to `GamblingGame`;
- `SpinFairness` and `SpinResolution`;
- `FlipSide` and `FlipConfig`;
- `MonteConfig`, `MonteSwap`, `MonteRoundStart`, `MonteRoundSteps`, and `MonteRoundResolution`;
- `DiceDirection` and `DiceConfig`;
- `SlotSymbolView` and `SlotsView`;
- `PlinkoBucketView`, `PlinkoTierView`, and `PlinkoView`.

`gamblingApi` must preserve the current operations:

| Game | Operations | Existing backend routes |
| --- | --- | --- |
| Wheel | `getWheel`, `spinFreeWheel`, `spinWheel` | `/casino/wheel`, `/casino/wheel/free`, `/casino/wheel/spin` |
| Shell Flip | `getFlip`, `flip` | `/casino/flip` |
| Three-Shell Monte | `getMonte`, `startMonteRound`, `getMonteSteps`, `resolveMonteRound` | `/casino/monte`, `/casino/monte/rounds`, `/casino/monte/rounds/:roundId/steps`, `/casino/monte/rounds/:roundId/resolve` |
| Shrine Slots | `getSlots`, `spinSlots` | `/casino/slots` |
| Koi Dice | `getDice`, `dice` | `/casino/dice` |
| Shell Drop | `getPlinko`, `dropPlinko` | `/casino/plinko` |

The method signatures, URL encoding, request bodies, response types, non-idempotent retry behaviour, and error semantics must not change.

### Gambling components

`frontend/src/components/gambling/` replaces `frontend/src/components/casino/`. It will contain only the six React modals, their private visual components, and React interface tests:

```text
components/gambling/
  FortuneWheelModal.tsx
  KoiDiceModal.tsx
  ShellDropModal.tsx
  ShellFlipModal.tsx
  ShrineSlotsModal.tsx
  ThreeShellMonteModal.tsx
  *.test.tsx
```

Visual helpers that are meaningful only to one modal may remain private in that modal. Reusable calculations, fairness checks, geometry, canvas operations, and animation utilities must come from `features/gambling`.

The existing `animation-coin-sync.test.tsx` remains a UI integration test and moves with the modals. It must continue to verify that all six games publish the authoritative returned coin balance at the correct point in their animation lifecycle.

### Generic reduced-motion hook

`frontend/src/hooks/useReducedMotion.ts` will own the generic media-query hook currently in `components/casino/useReducedMotion.ts`. Both Cards and Gambling UI may depend on it without creating a domain dependency.

## Suggested Target Structure

The exact internal filenames may be adjusted during implementation, provided the ownership rules remain intact:

```text
frontend/src/
  components/
    cards/
      CardLightbox.tsx
      CardRarityBadge.tsx
      CardSlot.tsx
      RevealOverlay.tsx
      ShellCardsModal.tsx
      *.test.tsx
    gambling/
      FortuneWheelModal.tsx
      KoiDiceModal.tsx
      ShellDropModal.tsx
      ShellFlipModal.tsx
      ShrineSlotsModal.tsx
      ThreeShellMonteModal.tsx
      *.test.tsx
  features/
    cards/
      cardsApi.ts
      contracts.ts
      binderFilters.ts
      cardTilt.ts
      cardDropPopup.ts
      index.ts
      *.test.ts
    gambling/
      gamblingApi.ts
      contracts.ts
      animation/
      fairness/
      games/
      geometry/
      index.ts
      *.test.ts
  hooks/
    useReducedMotion.ts
  services/
    api/
      apiClient.ts
      apiClient.test.ts
```

Public `index.ts` files should expose only the contracts and operations needed by consumers. Internal feature files should import directly within their feature rather than routing internal dependencies through their own public barrel.

## Cross-Feature Contract

`ProgressionResult` remains owned by the game-results or current Hub-facing API surface during this refactor. Its Cards dependency must become an explicit type-only import:

```ts
import type { PackPull } from "../cards";

export interface ProgressionResult {
	// Existing progression fields remain unchanged.
	cardDrop: PackPull | null;
}
```

This preserves the backend response and the four Phaser game consumers while making the ownership of `PackPull` accurate. The Phaser scenes must import `showCardDropPopup` from `features/cards`, not from `shared/card-drop-popup`.

No duplicate `PackPull`, `CardRarity`, `SpinResolution`, or game-specific contract may remain in `features/hub/api.ts` after the migration.

## Migration Sequence

### 1. Extract the common API client

- Create `services/api/apiClient.ts` with the transport, CSRF, retry, upload, response parsing, and shared error implementation from `features/hub/api.ts`.
- Make the existing Hub client consume the service without changing its public behaviour.
- Move the transport tests from `features/hub/api.test.ts` to `services/api/apiClient.test.ts` and keep all current cases passing.
- Confirm no feature client calls `fetch` directly.

### 2. Establish the Cards feature

- Move Cards contracts out of `features/hub/api.ts`.
- Create `cardsApi` using the common API client.
- Move `binderFilters`, `cardTilt`, and their tests into `features/cards`.
- Move `shared/card-drop-popup.ts` and its test into `features/cards` as the Phaser notification adapter.
- Consolidate shared Cards labels and constants without changing rendered copy, glyphs, colours, or ordering.
- Update `ProgressionResult.cardDrop` to import `PackPull` from Cards.

### 3. Split Cards presentation

- Extract `CardSlot`, `CardLightbox`, `RevealOverlay`, and `CardRarityBadge` from `ShellCardsModal.tsx`.
- Update the existing component tests to import each component from its own file.
- Add focused coverage for `CardRarityBadge` while preserving the current overlay focus trap, keyboard activation, lightbox, pack reveal, retry, and balance behaviour.
- Leave only React implementation and `.test.tsx` files in `components/cards`.

### 4. Establish the Gambling feature

- Move all gambling contracts out of `features/hub/api.ts` and rename `CasinoGame` to `GamblingGame` throughout the frontend.
- Create `gamblingApi` using the common API client.
- Move fairness, rule, geometry, rotation, shuffle, reel, canvas, and animation modules from `components/casino` to `features/gambling`.
- Move pure unit tests with their implementation and update imports to the Gambling contracts.
- Preserve all fairness messages, HMAC derivation, thresholds, outcome identifiers, multiplier calculations, and neutral-return checks.

### 5. Rename the Gambling presentation directory

- Rename `components/casino` to `components/gambling`.
- Keep the six modal components and React interface tests in the new directory.
- Move `useReducedMotion` to the generic hooks directory.
- Update modal imports to use the Gambling public API and generic hook.
- Update `HomePage.tsx` and every other consumer to the new component paths.

### 6. Remove obsolete ownership

- Remove Cards and Gambling contracts and methods from the Hub API surface.
- Remove the old `components/casino`, `components/cards/binderFilters.ts`, `components/cards/cardTilt.ts`, and `shared/card-drop-popup.ts` locations.
- Do not add compatibility re-exports, alias files, or duplicate constants.
- Search the full frontend for stale imports and type names before merging.

### 7. Update living documentation

- Update living documents that identify `features/hub/api.ts`, `components/casino`, or `shared/card-drop-popup` as current ownership.
- Keep the backend term `casino` and all `/casino/*` route references where they describe the server.
- Do not modify archived material in `docs/deprecated/` or `docs/old_docs/`.
- Review `docs/modules-progress.md`; update it only if separate functional work completed a module requirement, not for this structural move alone.

## Behavioural Invariants

The migration is complete only if all of the following remain true:

- Card binder filters and sort orders return the same cards in the same order.
- Pack opening uses the same tier identifiers and displays the same pulls, rarity states, foil and prismatic states, and returned coin balance.
- Reveal overlays retain their focus trap, keyboard operation, dismissal rules, and sequencing.
- Card slots and lightboxes retain pointer tilt, shine intensity, accessibility labels, and visual classes.
- Match-completion card drops still appear in all four Phaser games and do not overlap achievement notifications.
- All six gambling games retain their current animation timing and reduced-motion behaviour.
- Gambling modals update the parent coin balance from the authoritative response without publishing stale or intermediate values.
- An in-progress Three-Shell Monte round can still resume, poll just-in-time swaps, and resolve once.
- Wheel, Flip, Monte, Slots, Dice, and Plinko fairness verification produces the same result and explanatory copy for identical inputs.
- Neutral outcomes retain their current presentation and are not reported as wins or losses.
- Request failures and backend messages surface exactly as before.

## Automated Validation

Run the complete frontend suite and production build:

```bash
cd frontend && npm run test:run
cd frontend && npm run build
```

Then run structural searches from the repository root:

```bash
test ! -d frontend/src/components/casino
test ! -f frontend/src/shared/card-drop-popup.ts
test ! -f frontend/src/components/cards/binderFilters.ts
test ! -f frontend/src/components/cards/cardTilt.ts
find frontend/src/components/cards frontend/src/components/gambling -type f ! -name '*.tsx' -print
rg 'components/casino|shared/card-drop-popup|CasinoGame' frontend/src
rg 'features/hub/api' frontend/src/components/cards frontend/src/components/gambling frontend/src/features/cards frontend/src/features/gambling
```

Expected results:

- the removed paths do not exist;
- the `find` command prints nothing;
- the stale-path and stale-type search prints nothing;
- Cards and Gambling components and features do not import their contracts from Hub;
- all tests and the build pass without TypeScript or browser-bundle errors.

The final implementation diff should also pass:

```bash
git diff --check
```

## Manual Validation

Validate the affected flows in a running development stack:

1. Open the Cards binder, exercise every family and rarity filter, and switch through all sort orders.
2. Open each pack tier, confirm the returned balance, complete the reveal sequence, use keyboard navigation, and open and close the lightbox.
3. Complete a match in each of the four Phaser games and confirm the card-drop notification appears when `cardDrop` is present.
4. Open every Gambling modal and exercise both normal and reduced-motion paths.
5. Confirm Wheel free and wagered spins, Flip calls, Slots reels, Dice directions and targets, and Plinko row choices preserve their results and balance synchronisation.
6. Start Monte, close and reopen the modal while a round is active, and confirm the round resumes and resolves correctly.
7. Check successful, neutral, losing, insufficient-balance, network-error, and fairness-failure states.
8. Confirm there are no new console warnings, focus regressions, duplicate requests, or changed backend paths.

## Completion Criteria

The refactor is complete when:

- component directories contain only React `.tsx` files and `.test.tsx` interface tests;
- Cards and Gambling each expose one feature-owned client and one authoritative set of contracts;
- the common HTTP transport has one implementation and one focused test suite;
- `CasinoGame` has been replaced by `GamblingGame` in frontend code;
- no imports remain from `components/casino` or `shared/card-drop-popup`;
- no Cards or Gambling contracts or operations remain in `features/hub/api.ts`;
- no temporary re-export preserves an obsolete path;
- automated and manual validation passes; and
- living documentation reflects the final ownership without changing the functional module status merely for an internal reorganisation.
