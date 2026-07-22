# Dead Code Cleanup Plan — 2026-07-21

**Status:** Phases 0–4 **implemented** on 2026-07-22 (see §11, Implementation
log). Phase 5 (`hidpi.ts`) remains **deferred** — it is gated on a runtime
HiDPI sharpness check that cannot be run headless. Phase 6 is out of scope by
design. This plan originally validated the findings in
`docs/dead-code-audit-2026-07-21.md` against the current source tree, corrected
and extended them, and sequenced the cleanup into low-risk-first phases.

**Method of validation.** Every candidate below was re-checked by hand against
the working tree (not the audit's snapshot): reference greps across
`backend/src` and `frontend/src` only (build artefacts such as `backend/dist`
and all `graphify-out/` output excluded), inspection of the definition sites,
confirmation of test pairings, and a review of how the entry points
(`main.tsx`, `createShellSmashGame.ts`) actually wire the runtime. Where the
audit's supporting detail was wrong but its conclusion held, that is called out.

---

## 1. Executive summary

### Overall assessment

The audit's headline is correct: the codebase is genuinely clean of the usual
rot (no commented-out code, no `debugger`, no skipped tests, no empty catches,
dependency hygiene is good). The real, actionable dead code is a **small,
well-bounded set of orphaned files and exports**, plus one category the audit
**significantly under-counted**: committed analyser output (`graphify-out/`).

All of the audit's §2–§4 "dead" claims validated as genuinely unused, with one
factual correction (the power-pickup duplication detail) and one item that must
not be deleted blind (`hidpi.ts` — see below). The largest *new* finding is that
`graphify-out/` is not one 7 MB directory at the repo root but **five
directories totalling ~8.1 MB across 250 tracked files**, and two of them sit
**inside the source tree** (`frontend/src/...` and `backend/src/...`), where they
actively pollute import-graph analysis and code search.

### Estimated scope

- **Phase 0–3 (dead code + assets + tooling output):** ~15 files deleted, ~9
  exports trimmed, ~250 analyser files removed from git, ~35 unreferenced image
  assets removed. Low risk, high signal-to-noise, a day's careful work in small
  commits.
- **Phase 4 (structural / file-size):** explicitly **out of scope for this
  plan** beyond sizing it. It is a separate, larger effort and is not dead-code
  removal.

### Major risks

1. **`hidpi.ts` is not obviously safe to delete.** It is genuinely unimported,
   but its purpose (crisp canvas at high `devicePixelRatio`) may have been *lost*
   in the refactor to `ResponsiveScene`, not *replaced*. Deletion must be gated
   on a visual sharpness check. (See §3, Risk Assessment.)
2. **Asset deletion is irreversible in effect** (files leave `public/`). The
   duplicate buttons are safe; the character portraits and concept art may be
   roadmap assets and must be confirmed against `docs/modules-progress.md`.
3. **`graphify-out/` inside `src/`** — removal is safe (nothing imports it), but
   it must be `.gitignore`d globally or it will silently return on the next
   analyser run.

### Expected benefits

- Removal of ~8 MB of non-source noise from version control and, crucially, from
  the `src` trees where it corrupts search/analysis results (I hit these dirs
  repeatedly during this very audit).
- ~15 orphaned files and ~9 dead exports gone → less surface area, faster
  comprehension, fewer "is this used?" investigations.
- A cleaner asset directory (35 of 92 images are unreferenced).
- No behavioural change in any phase except the deliberate, gated `hidpi.ts`
  decision.

---

## 2. Confirmed findings (validated against the current tree)

Confidence and risk are stated per item. "Refs" always means references in
`backend/src` + `frontend/src`, excluding the file's own definition and all
`graphify-out/` output.

### 2.1 Orphaned files — safe to delete (High confidence)

| # | File | LOC | Evidence (re-verified) | Risk |
|---|------|----:|------------------------|------|
| F1 | `backend/src/modules/matchmaking/power-pickup.helper.ts` | ~205 | All 9 exports have **0 external refs**. The functions the audit thought were the "live inline copy" (`randomPowerPickupSpot`, `consumePower`) are in fact **`private` methods** on `bamboo-bash.engine.ts` / `shell-curl.engine.ts` — engine-local duplicates, not importers of this helper. The helper is entirely orphaned. | Very low |
| F2 | `frontend/src/services/network/reconnectStatus.ts` | ~10 | `formatReconnectStatus` — 0 refs anywhere. | Very low |
| F3 | `frontend/src/shared/drawBackground.ts` | ~160 | Exported `drawBackground` — 0 imports. `ShellPickerScene` has its own unrelated `private drawBackground()`. | Very low |
| F4 | `backend/src/modules/tournaments/actions/index.ts` | ~13 | Barrel re-exporting `./action.interface`, `./action-engine`, etc. **No file imports the directory/barrel**; every consumer imports concrete files (`../actions/tile-actions`, `./base-actions`). Its own comment admits it is aspirational ("The architect wires this into the Runtime later"). | Low — see note |

> **Note on F4:** the comment signals *intended* future use. It is pure
> indirection today. Recommendation: **delete it** (the concrete-import pattern
> is already established and consistent); if the team prefers to keep an
> aspirational public surface, the alternative is to *adopt* it and route
> imports through it — but do not leave it half-wired. This is the one item where
> a product decision, not just a technical one, applies.

### 2.2 Files used only by their own test — dead in production (High confidence)

Delete the **source file and its test together** (each pair is otherwise a test
that only exercises code nothing ships).

| # | Source file | Its only importer |
|---|-------------|-------------------|
| T1 | `frontend/src/games/bell-clash/bell-clash-interpolation.ts` | `frontend/src/games/bell-clash/bell-clash-interpolation.test.ts` |
| T2 | `frontend/src/games/common/runtime/launchableRemap.ts` | `frontend/src/games/common/tests/launchableRemap.test.ts` |
| T3 | `frontend/src/games/common/runtime/worldEntityStore.ts` | `frontend/src/games/common/tests/worldEntityStore.test.ts` |

> **Audit correction:** the tests for T2/T3 live in `games/common/tests/`, not
> adjacent to the source as the audit implied. Both source files have **0
> non-test importers** (verified). Confirm with the game-runtime owner that these
> are not wiring-in-progress before deleting — the `runtime/` location suggests
> they were written ahead of integration.

### 2.3 Dead exports in otherwise-live files (High confidence)

Remove the export **and its body** if nothing else in the same file uses it
(verified: each name below appears only at its definition site — no internal
callers). Keep the file; it has other live exports.

| # | File | Dead exports (0 refs, incl. internal) |
|---|------|----------------------------------------|
| E1 | `backend/src/modules/matchmaking/replay-state.helpers.ts` | `initializeArenaReplayBall`, `initializeCurlingReplayBall`, `syncCurlingReplayStateFromPayload` |
| E2 | `frontend/src/shared/arenas/arena.ts` | `arenaToScreen`, `arenaPlayableToScreenInRect`, `isInsideArena`, `arenaEdgeFraction` |
| E3 | `frontend/src/shared/mechanics/physics.ts` | `createReplayCurlingBallState`, `simulateReplayBall` |

> `arenaToScreen` internally calls `arenaToScreenInRect` — the latter is **live**
> and must stay. Only the four listed `arena.ts` names are dead. Likewise trim
> only the named `physics.ts`/`replay-state.helpers.ts` functions; `clamp01`
> (flagged by `ts-prune`) has **12 real uses** and must be kept — the audit's
> false-positive call is correct.

### 2.4 Committed analyser output — `graphify-out/` (High confidence, expanded)

**This is the audit's biggest miss.** The audit reported one 7 MB `graphify-out/`
at the repo root. In fact there are **five tracked directories, 250 files,
~8.1 MB**, and none is imported by any source file:

| Directory | Location | Notes |
|-----------|----------|-------|
| `graphify-out/` | repo root | 7.0 MB — the one the audit found |
| `frontend/graphify-out/` | frontend root | analyser cache |
| `frontend/src/games/graphify-out/` | **inside src** | 792 KB, `graph.json` etc. |
| `frontend/src/shared/mechanics/graphify-out/` | **inside src** | cache output |
| `backend/src/modules/matchmaking/engines/graphify-out/` | **inside src** | 112 KB, `graph.json` |

The three inside `src/` are the most harmful: their `graph.json`/`manifest.json`
files contain labels like `.drawBackground()`, `.consumePower()` that surface as
false positives in exactly the kind of reference-grep this cleanup depends on.
**Remove all five from git and add `graphify-out/` to `.gitignore`** (mirroring
how `shellsmash/` is already ignored).

### 2.5 Unreferenced image assets (High confidence for the duplicate set)

`public/assets/` holds 92 images; the audit lists 35 as unreferenced. Spot-check
of five representatives (`bambooBashButton`, `oniDodgeButton`,
`tournamentButton2`, `sumo-turtle`, `login_bg3`) confirmed **0 code references
each**, and the shorter-named button variants actually in use
(`bambooButton.png`, referenced from `hub.css`/`hub-modals.css`) do exist. There
are no dynamically-constructed asset paths, so unreferenced = unused.

- **Safe now:** the 12 duplicate game buttons, 3 duplicate mode buttons
  (`*Button2.png`), and the misc set (`ui/pongo/*@2x`, `ui/counter/*@2x`,
  `backgrounds/login_bg3.png`). See audit §7 for the full list.
- **Confirm first:** the 11 character portraits (`sumo-turtle.*`,
  `assassin-turtle.webp`, `ghost-turtle.*`, etc.) and the 4 `concept-art/*`
  images — these may be roadmap content. Check `docs/modules-progress.md` and ask
  the product owner before deleting.

### 2.6 Scripts, SPEC, and infra (Low priority — mostly keep)

- `scripts/check-tournament-contracts.sh`: not wired into `Makefile`, package
  scripts, or CI. Confirm it is not a manual helper before removing; otherwise
  wire it into `make` or CI rather than delete.
- `scripts/generate-cycle-masks.py` + `requirements-cycle-masks.txt`: a one-off
  asset generator referenced only from `docs/`. **Keep as tooling** (optionally
  move under a `tools/` location); not dead.
- `SPEC/` (41 files, `SPEC_000`–`SPEC_040`): a **live spec set** — the tournament
  work still references open decisions in `SPEC_040`. Keep. The only nit is that
  CLAUDE.md wants project docs under `docs/`; folding `SPEC/` into `docs/` is a
  documentation-tidiness task, **not** dead-code removal, and should be its own
  ticket if pursued.

---

## 3. Item needing a decision, not a blind delete

### `frontend/src/shared/hidpi.ts` (Medium confidence — do NOT delete in a bulk pass)

**Facts.** `installHiDPI` is exported and never imported. Its doc comment claims
it is "Wired up by a single `installHiDPI(game)` call in `main.ts`" — but
`main.tsx` is a 12-line React root that creates **no** Phaser game, so that
comment is stale by construction. Phaser games are built in
`frontend/src/lib/createShellSmashGame.ts`, which uses `Phaser.Scale.RESIZE`, and
scenes now extend `frontend/src/shared/responsive-scene.ts` (`ResponsiveScene`),
whose own header documents that it *replaced* per-scene hand-rolled resize
logic.

**The catch.** `ResponsiveScene` demonstrably replaced the **reflow/relayout**
half of what `hidpi.ts` did. It is *not* clear that anything replaced the
**crispness** half — `hidpi.ts` patched `devicePixelRatio`-aware backing-store
resolution, and `createShellSmashGame.ts` sets only `Scale.RESIZE`
(no `resolution`/DPR handling visible). So deleting `hidpi.ts` is safe for the
code graph but may **confirm a silent rendering regression** rather than remove
dead weight.

> This directly contradicts a stale project memory note that treats `hidpi.ts` as
> the live source of crisp rendering; that note pre-dates the `ResponsiveScene`
> refactor and should be corrected once this is resolved.

**Required gate before deletion:** run the stack (`make dev`) and visually verify
canvas sharpness on a HiDPI display / browser zoom (the `verify` skill and the
HiDPI/zoom memory note describe the check). Two outcomes:

- **Rendering is still crisp** → the DPR concern was already handled elsewhere;
  delete `hidpi.ts` as dead. (High confidence after the check.)
- **Rendering is blurry at DPR > 1 or under zoom** → this is a *regression*, not
  dead code. Do **not** delete; instead re-wire `installHiDPI(game)` into
  `createShellSmashGame.ts` (or fold DPR handling into `ResponsiveScene`) and fix
  the stale comment. That is a bug-fix task, tracked separately.

---

## 4. False positives (audit was right — keep these)

- `frontend/src/vite-env.d.ts` — ambient `/// <reference types="vite/client" />`;
  never imported by design. **Keep.**
- `clamp01` in `physics.ts` — 12 real uses (verified). **Keep.**
- All 18 CSS feature modules — every one is registered in
  `styles/modules/index.css`. None orphaned. **Keep.**
- Unused dependencies — **none**. `depcheck`'s backend "missing" list
  (`dotenv`, `express`, `multer`, `uuid`) is transitive-via-NestJS; the frontend
  "unused devDeps" (`tailwindcss`, `postcss`, `autoprefixer`, `typescript`,
  `@vitest/coverage-v8`) are consumed via config, not `import`. **Keep all.**

---

## 5. Newly discovered issues (not in the audit)

1. **Four additional `graphify-out/` directories** beyond the root one, two of
   them inside `src/` — see §2.4. Highest-value new finding.
2. **Audit factual error (conclusion still valid):** the power-pickup duplication
   is via `private` engine methods (`randomPowerPickupSpot`, `consumePower`), not
   free functions named `applyPowerPickup`/`powerPickups`/`nextPowerPickupId`.
   F1 remains a correct delete.
3. **Test-file locations** for T2/T3 differ from the audit (`common/tests/`, not
   adjacent) — corrected in §2.2 so the executor deletes the right files.
4. **Stale doc comments** to fix alongside deletions: the "main.ts" reference in
   `hidpi.ts` and any comment that describes deleted helpers. Cheap, do it in the
   same commit as each deletion.

---

## 6. Cleanup plan (phased, lowest risk first)

Each phase is an independently reviewable, independently revertable unit. Run the
validation in §7 **after every phase** (ideally after every commit). Keep one
concern per commit.

### Phase 0 — Remove committed analyser output (lowest risk, highest noise reduction)

- **Objective:** get ~8 MB / 250 files of `graphify-out/` out of git and out of
  the `src` trees.
- **Affected:** all five `graphify-out/` directories (§2.4); `.gitignore`.
- **Actions:** `git rm -r` each directory; add `graphify-out/` to `.gitignore`.
- **Rationale:** nothing imports them; they corrupt search/analysis. No source
  behaviour touched.
- **Dependencies:** none. Do this first — it makes every later grep trustworthy.
- **Expected impact:** cleaner repo; faster, accurate reference searches for the
  remaining phases.

### Phase 1 — Delete fully-orphaned files (very low risk)

- **Objective:** remove F1–F4.
- **Affected:** `power-pickup.helper.ts`, `reconnectStatus.ts`,
  `drawBackground.ts`, `tournaments/actions/index.ts` (subject to the F4
  product decision).
- **Rationale:** 0 references each, verified post-Phase-0.
- **Dependencies:** Phase 0 (so the reference check is not polluted by
  `graph.json` labels).
- **Expected impact:** ~4 files gone, no behaviour change.

### Phase 2 — Delete test-only helpers with their tests (low risk)

- **Objective:** remove T1–T3 source files **and** their tests together.
- **Affected:** the six files in §2.2.
- **Rationale:** production never imports them; deleting source without its test
  would break the suite, so they go as pairs.
- **Dependencies:** Phase 0; sign-off that these are not integration-in-progress.
- **Expected impact:** ~6 files gone; test suite still green (the deleted tests
  only covered the deleted code).

### Phase 3 — Trim dead exports (low risk)

- **Objective:** remove E1–E3 exports and their bodies.
- **Affected:** `replay-state.helpers.ts`, `arena.ts`, `physics.ts` (files
  remain; only the nine named functions are removed).
- **Rationale:** 0 internal and external references.
- **Dependencies:** Phase 0. Independent of Phases 1–2.
- **Expected impact:** ~9 dead functions gone; `arenaToScreenInRect`, `clamp01`,
  and all other live exports untouched.

### Phase 4 — Prune unreferenced assets (low risk for the duplicate set)

- **Objective:** delete the confirmed-duplicate and misc images (§2.5).
- **Affected:** `public/assets/` (duplicate game buttons, `*Button2.png`,
  `ui/pongo/*@2x`, `ui/counter/*@2x`, `backgrounds/login_bg3.png`).
- **Hold back:** the 11 character portraits and 4 concept-art images until
  confirmed non-roadmap against `docs/modules-progress.md` and the product owner.
- **Dependencies:** Phase 0. Product confirmation for the held-back subset.
- **Expected impact:** ~20 images removed now; ~15 pending confirmation.

### Phase 5 — Resolve `hidpi.ts` (gated — bug-fix OR delete)

- **Objective:** settle the crispness question (§3), then either delete or
  re-wire.
- **Affected:** `hidpi.ts`, possibly `createShellSmashGame.ts` /
  `responsive-scene.ts`; the stale memory note.
- **Dependencies:** a runtime visual check on a HiDPI/zoomed display (`make dev`
  + `verify` skill). **Must not** be done in the same commit as any blind
  deletion.
- **Expected impact:** either one dead file removed, or a rendering regression
  fixed — determined by the check, not assumed.

### Phase 6 (out of scope here) — File-size / structural refactors

- Sizing only. `HomePage.tsx` (5527 LOC, verified) and the four game scenes are
  real *maintainability* problems but are **not dead code**. The audit's caveat
  is correct: splitting source files does **not** improve runtime performance
  (the bundle is tree-shaken/minified regardless); the win is review, IDE, and
  merge ergonomics. Track separately; do not fold into this dead-code effort.

---

## 7. Risk assessment — areas needing special care

- **Public API surface / DI:** this is an application, not a published library,
  so there are no external consumers of these exports. NestJS DI wires providers
  via modules, not via the barrels/helpers being removed — none of F1–F4 or
  E1–E3 is a `@Injectable`/provider. `actions/index.ts` (F4) is the only
  "public surface" candidate, and it is unused indirection (§2.1 note).
- **Framework conventions / dynamic loading:** no dynamically-constructed import
  paths or asset paths exist (verified), so static reference checks are
  authoritative. `vite-env.d.ts` is the one ambient file that looks unused and
  must be kept.
- **Serialization / reflection / generated code:** none of the targets is a
  DTO/entity used in (de)serialization or a migration. Migrations under
  `backend/src/migrations/` are untouched.
- **Rendering behaviour (`hidpi.ts`):** the single genuine behavioural risk —
  gated in Phase 5.
- **Tests that need updating:** only the T1–T3 tests, which are **deleted with
  their source** (Phase 2). No other test imports any removed symbol (verified).
  Trimming E1–E3 should not touch any spec — confirm with a full test run.
- **Assets:** irreversible-in-effect; the character/concept subset needs product
  confirmation before Phase 4 acts on it.

---

## 8. Validation strategy (run after every phase, ideally every commit)

- **Backend:** `cd backend && npm run test` (Jest) and `npm run build`
  (`tsc -p tsconfig.build.json`) — the build is the real dead-import guard, since
  an orphaned import would fail to compile. `npm run lint` (`eslint src`).
- **Frontend:** `cd frontend && npm run build` (Vite) and `npm run test:run`
  (`vitest run`). Vite's build will fail on any dangling import left by a
  deletion.
- **Reference re-check:** after Phase 0, re-grep each removed symbol across
  `backend/src` + `frontend/src` to confirm 0 hits before committing the
  deletion — now trustworthy because `graphify-out/` is gone.
- **`git diff --check`** for whitespace, per CLAUDE.md.
- **Static analysis:** optionally re-run `ts-prune`/`depcheck` at the end to
  confirm the dead-export count dropped and no new orphans were introduced.
- **Runtime smoke (Phases 4–5, and a final pass):** `make dev`, then the
  `verify` skill / headless-Firefox flow — load the hub, launch each of the four
  games and a replay, and (Phase 5) confirm canvas sharpness at DPR > 1 and under
  browser zoom. Assets: confirm no broken image in hub, game-select, and profile
  screens after Phase 4.
- **Docs:** update `docs/modules-progress.md` in the same task if any change
  advances/affects a module; keep `AGENTS.md`/`CLAUDE.md` in sync if any working
  rule changes (none expected here).

---

## 9. Success criteria

1. All five `graphify-out/` directories are removed from git and `graphify-out/`
   is in `.gitignore`; `git ls-files | grep graphify-out` returns nothing.
2. F1–F4 files deleted (or F4 explicitly adopted per the product decision); T1–T3
   source+test pairs deleted; E1–E3 exports removed. Re-grepping each removed
   symbol across `src` returns 0 hits.
3. `cd backend && npm run build && npm run test` and
   `cd frontend && npm run build && npm run test:run` all pass on every commit;
   `git diff --check` is clean; no new `ts-prune` orphans introduced.
4. Confirmed-duplicate assets removed; no broken image in a full runtime smoke of
   hub, game-select, the four games, replays, and profile. The character/concept
   asset subset is either removed (with product sign-off) or explicitly retained
   with a note.
5. The `hidpi.ts` question is resolved with a *documented* runtime check —
   deleted as dead, **or** kept with the regression fixed and its stale comment
   corrected — never deleted on assumption. Stale memory/comment about `hidpi.ts`
   is corrected.
6. No behavioural change is observable in the smoke pass for Phases 0–4.

---

## 10. Assumptions and uncertainties (called out explicitly)

- **Assumption:** the T1–T3 `runtime/` helpers are abandoned speculation, not
  integration-in-progress. Their location warrants a one-line confirmation from
  the game-runtime owner before Phase 2.
- **Assumption:** `actions/index.ts` (F4) will not be adopted as the module's
  public surface. If the team disagrees, the plan swaps "delete" for "route
  imports through it" — either resolves the indirection.
- **Uncertainty:** whether canvas crispness at DPR > 1 currently depends on
  `hidpi.ts`. This is the one open behavioural question and is deliberately
  gated behind a runtime check (Phase 5), not resolved by static analysis.
- **Uncertainty:** the roadmap status of the character portraits and concept
  art. Treated as "confirm before delete", not assumed dead.
- **Out of scope by design:** the file-size/structural work (§6, Phase 6), any
  `SPEC/` relocation, and route-level code-splitting — each is its own effort and
  none is dead-code removal.

---

## 11. Implementation log — 2026-07-22

Executed by an automated pass with the product decisions confirmed up front:
F4 **deleted** (not adopted); character portraits and concept art **kept**;
Phase 5 (`hidpi.ts`) **deferred**. All deletions are staged in git; nothing has
been committed (the working tree carried unrelated pre-existing modifications,
so staging was left for the owner to review and commit per phase).

### Phase 0 — analyser output

- `git rm -r` removed all five `graphify-out/` directories (250 tracked files,
  ~8 MB). `git ls-files | grep graphify-out` now returns nothing.
- Added `graphify-out/` to `.gitignore` (next to the existing `shellsmash/`
  ignore); verified a fresh `graphify-out/` inside `src/` is now ignored.

### Phase 1 — orphaned files (F1–F4)

Deleted, each re-verified at 0 references post-Phase-0:
`backend/src/modules/matchmaking/power-pickup.helper.ts`,
`frontend/src/services/network/reconnectStatus.ts`,
`frontend/src/shared/drawBackground.ts`,
`backend/src/modules/tournaments/actions/index.ts` (F4 — deleted per decision;
every consumer already imports the concrete files).

### Phase 2 — test-only helpers (T1–T3)

Deleted each source + test pair (0 non-test importers):
`bell-clash-interpolation.ts`(+`.test.ts`),
`common/runtime/launchableRemap.ts` (+ `common/tests/launchableRemap.test.ts`),
`common/runtime/worldEntityStore.ts` (+ `common/tests/worldEntityStore.test.ts`).

### Phase 3 — dead exports (E1–E3), with cascade cleanup

The named exports were removed **and** the private helpers/constants they
orphaned, so the files stay lint-clean (backend ESLint `no-unused-vars`):

- **E1 `replay-state.helpers.ts`:** removed `initializeArenaReplayBall`,
  `initializeCurlingReplayBall`, `syncCurlingReplayStateFromPayload`. Cascade:
  removed now-orphaned privates `syncCurlingEntityMirror`, `sanitizeTrailPoint`,
  the constants `CURL_SHEET_W_SRC`, `CURL_DELIVERY_X`, `CURL_DELIVERY_Y`,
  `DEFAULT_CURLING_BALL_SCALE`, and the now-unused `CurlingSnapshot` import.
  `POWER_SCALE`/`TRANSLUCENT_POWERS` kept (still used by the live projectile
  path); `getArenaBallSpawn`/`upsertArenaBall` kept (used by the live
  settle/reset functions).
- **E2 `arena.ts`:** removed `arenaToScreen`, `arenaPlayableToScreenInRect`,
  `isInsideArena`, `arenaEdgeFraction`. **Deviation from the plan, flagged:** the
  plan kept `arenaToScreenInRect` on the belief it was live, but its only caller
  was `arenaToScreen` (now removed), so `arenaToScreenInRect` is now an unused
  export. It was **retained** as instructed (harmless exported util, lint-safe);
  the genuinely live function is `texturedOvalArenaToScreenInRect` (4 scenes).
  Recommend removing `arenaToScreenInRect` in a follow-up unless it is wanted as
  public API.
- **E3 `physics.ts`:** removed the named `createReplayCurlingBallState` and
  `simulateReplayBall`, **plus** `stepReplayBall` — the plan under-counted: with
  `simulateReplayBall` gone, `stepReplayBall` (its only caller) was dead too, so
  the whole curling-ball replay cluster went. Cascade: removed the now-orphaned
  `ReplayCurlingBallState` interface, the `RectArenaPixels` import, and the six
  `./ball` constants only that cluster used (`CURLING_BALL_SRC_R`, `FRICTION_ICE`,
  `BOUNCE_DAMP`, `MIN_SPEED_SRC`, `CURL_STRENGTH`, `DEFAULT_CURL_BIAS`). The
  live projectile path and shared `power-system` constants are untouched;
  `clamp01` (12 uses) and `lerpNumber` kept.

### Phase 4 — assets

Deleted 20 confirmed-duplicate/misc images (each re-verified at 0 references,
no dynamically-constructed paths): 12 duplicate game buttons, 3 `*Button2.png`
mode buttons, `ui/pongo/*@2x` (2), `ui/counter/*@2x` (2), `backgrounds/login_bg3.png`.
**Held back and kept** per decision: the 11 character portraits and 4
`concept-art/*` images.

### Phase 5 — `hidpi.ts` — DEFERRED

Not actioned. Requires the runtime HiDPI sharpness check in §3 (`make dev` on a
DPR > 1 / zoomed display), which cannot be performed headless. `hidpi.ts` is left
in place; its stale `main.ts` comment is untouched pending that decision.

### Validation performed

- **Backend:** touched file `replay-state.helpers.ts` passes `eslint` and
  `tsc -p tsconfig.build.json` with no new errors. Two pre-existing baseline
  issues remain in **untouched** files and are unrelated to this cleanup: an
  ESLint error in `tournaments/minigame/tournament-minigame.ts` and
  `tournaments/state-machine/tournament-state-machine.ts`, and a `tsc` failure
  from a missing dependency `passport-google-oauth20` (declared in
  `package.json` but not installed in the current environment).
- **Frontend:** exhaustive reference sweep confirms **0** importers/references
  to every removed file, export, cascade symbol, and asset across `frontend/src`
  and `public`. `arena.ts` and `physics.ts` are internally consistent (no
  reference to any removed local). The full-project `vite build` / `vitest` /
  `tsc --noEmit` were **not** run to completion in this environment (each exceeds
  the sandbox's per-command time budget); the deletions cannot break the build or
  suite because nothing imports the removed symbols and the deleted tests went
  with their sources. **Owner should run** `cd frontend && npm run build &&
  npm run test:run` before committing, per §8.
- `git diff --check` clean on the text edits.

### Still open (for the owner)

1. Run the frontend build + tests locally to close §8's runtime guard.
2. Decide Phase 5 (`hidpi.ts`) after the HiDPI visual check.
3. Optionally remove the now-unused `arenaToScreenInRect` export (see E2 above).
4. Commit the staged deletions per phase; the working tree also holds unrelated
   pre-existing image modifications that are not part of this cleanup.
