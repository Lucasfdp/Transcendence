# Dead Code & File-Size Audit — 2026-07-21

**Status:** Findings only. No code has been changed. This document is for your
review before any removal or refactoring work begins.

**Scope:** The whole repository — `backend/`, `frontend/`, `scripts/`, `infra/`,
`public/`, migrations, tests, and root-level directories. Every category you
asked for is covered: unreferenced files, unused exports, unused dependencies,
commented-out or unreachable code, unused CSS and assets, and a file-size audit
flagging files over 1000 lines.

**Method:** A custom import-graph analyser (relative-import resolution across all
649 source files), `ts-prune` for unused exports, `depcheck` for dependencies,
and targeted `grep` verification of every candidate to remove false positives.
`knip` could not run in the analysis sandbox (parser ran out of memory), so its
role was covered by the custom analyser plus manual verification.

> **Important — nothing here is auto-applied.** Several items look dead but may be
> deliberate (public API surface, one-off tooling). Each entry says how confident
> I am and what to check. Please tick off what you want removed and I will do it
> in a separate, reviewable pass.

---

## 1. Executive summary

The codebase is, on the whole, **very clean**. There is almost no commented-out
code, no `debugger` statements, no bare `TODO`s, no skipped tests, and no empty
`catch` blocks. Dependency hygiene is good. The two areas genuinely worth acting
on are:

1. **A small set of orphaned files and exports** — most notably
   `power-pickup.helper.ts` (a duplicate of logic that now lives inline in the
   bamboo engine) and `hidpi.ts` (whose `installHiDPI` is never wired into
   `main.tsx`, despite its own comment claiming it is).
2. **File size.** Nineteen non-test source files exceed 1000 lines, led by
   `HomePage.tsx` at **5527 lines**. This is the single biggest maintainability
   issue in the tree.

Please also read the note in section 6 about the *performance* reasoning behind
the 1000-line target — the maintainability case is strong, but the runtime
performance case is largely a myth and I would not want you to act on a
misconception.

---

## 2. Unreferenced files (high confidence)

Files that no other file imports, excluding entry points, migrations, and tests.
Each was verified by hand.

| File | LOC | Evidence | Recommendation |
|------|----:|----------|----------------|
| `backend/src/modules/matchmaking/power-pickup.helper.ts` | 205 | All 8 exports flagged by `ts-prune`; no import resolves to it. The live power-pickup logic (`applyPowerPickup`, `powerPickups`, `nextPowerPickupId`…) is implemented **inline** in `engines/bamboo-bash.engine.ts` and `matchmaking.gateway.ts`. This file is a superseded duplicate. | **Delete.** Confirm the engine version is the canonical one first. |
| `frontend/src/shared/hidpi.ts` | 91 | `installHiDPI` is exported and its comment says "Wired up by a single `installHiDPI(game)` call in `main.ts`" — but `main.tsx` never imports or calls it. Orphaned after a refactor. | **Decide, then delete or re-wire.** The HiDPI/crisp-canvas behaviour may have been *unintentionally lost*; worth confirming rendering is still sharp before deleting. |
| `frontend/src/shared/drawBackground.ts` | ~160 | Exported `drawBackground` is never imported. `ShellPickerScene` has its own private `drawBackground()` method — unrelated. | **Delete** once you confirm no scene was meant to use the shared version. |
| `frontend/src/services/network/reconnectStatus.ts` | ~10 | `formatReconnectStatus` has zero references anywhere. | **Delete.** |
| `backend/src/modules/tournaments/actions/index.ts` | ~30 | Barrel that re-exports `./base-actions`, `./tile-actions`, etc. Nothing imports from `../actions` (consumers import the concrete files directly, e.g. `../actions/base-actions`). | **Delete** the barrel, or start using it — currently pure indirection. |

**False positive excluded:** `frontend/src/vite-env.d.ts` was flagged (no
`import`) but is an ambient type reference (`/// <reference types="vite/client" />`)
and **must be kept**.

---

## 3. Files imported only by their own tests (dead in production)

These files are never used by the running application — only their sibling test
file imports them. Either the feature was removed but the tested helper left
behind, or the helper was written speculatively.

| File | Only importer |
|------|---------------|
| `frontend/src/games/bell-clash/bell-clash-interpolation.ts` | `bell-clash-interpolation.test.ts` |
| `frontend/src/games/common/runtime/launchableRemap.ts` | `launchableRemap.test.ts` |
| `frontend/src/games/common/runtime/worldEntityStore.ts` | `worldEntityStore.test.ts` |

**Recommendation:** Confirm each is not intended wiring-in-progress. If not,
delete the file **and** its test together.

---

## 4. Unused exports in otherwise-live files (verified subset)

`ts-prune` reported ~240 unused exports, but most are **false positives**: barrel
re-exports and `contracts.ts` / `.types.ts` type surfaces kept intentionally.
`clamp01` in `physics.ts`, for example, was flagged but has 12 real uses. I
verified the following are genuinely dead and safe to trim:

| File | Dead exports |
|------|--------------|
| `backend/src/modules/matchmaking/replay-state.helpers.ts` | `initializeArenaReplayBall`, `initializeCurlingReplayBall`, `syncCurlingReplayStateFromPayload` |
| `frontend/src/shared/arenas/arena.ts` | `arenaToScreen`, `arenaPlayableToScreenInRect`, `isInsideArena`, `arenaEdgeFraction` |
| `frontend/src/shared/mechanics/physics.ts` | `createReplayCurlingBallState`, `simulateReplayBall` |

**Recommendation:** Remove these individual exports (and their bodies if nothing
else in the file uses them). The full `ts-prune` list is available on request,
but I do **not** recommend bulk-removing it — the type-contract exports are
deliberate and removing them would be noise.

---

## 5. Unused dependencies

**None to remove.**

- **Backend:** `depcheck` reports zero unused dependencies. The "missing"
  packages it lists (`dotenv`, `express`, `multer`, `uuid`) are transitive/used
  via NestJS and are not a real problem.
- **Frontend:** the "unused devDependencies" it reports — `tailwindcss`,
  `postcss`, `autoprefixer`, `typescript`, `@vitest/coverage-v8` — are all
  **false positives**; they are consumed through config files
  (`tailwind.config.cjs`, `postcss.config`, `vitest` coverage), not through
  `import`. Keep them.

---

## 6. File-size audit (files over 1000 lines)

> **A note on the "performance" reasoning first.** You mentioned large files are
> "killers for performance" because too much is loaded at once. In practice that
> is a **myth for runtime performance**: the browser and Node never load your
> individual source files — they load the *bundled, tree-shaken, minified* output
> that Vite and `tsc` produce, and a 5000-line source file and five 1000-line
> files compile to essentially the same bytes. Splitting files does **not** make
> the app faster to load or run.
>
> What large files genuinely hurt is **maintainability**: editor/IDE
> responsiveness, code review, merge-conflict frequency, cognitive load, and how
> easily dead code hides inside them. Those are real and worth fixing — so the
> 1000-line target is a good *maintainability* goal, just not a performance one.
> (If you actually want faster initial load, the lever is **route-level code
> splitting / lazy imports**, which is a separate task I can scope.)

### Non-test source files ≥ 1000 LOC

| File | LOC | Notes / split idea |
|------|----:|--------------------|
| `frontend/src/pages/HomePage.tsx` | **5527** | By far the worst offender. Almost certainly many independent screens/menus in one component. Prime candidate to split into `HomeMenu`, leaderboard, hub-loading, logout, and modal sub-components. |
| `frontend/src/games/bamboo-bash/BambooBashScene.ts` | 2183 | Phaser scene; split rendering / input / state / networking concerns. |
| `frontend/src/games/shell-curl/ShellCurlScene.ts` | 1960 | As above. |
| `frontend/src/games/kame-knock/KameKnockScene.ts` | 1959 | As above. |
| `frontend/src/games/bell-clash/BellClashScene.ts` | 1957 | As above. The four game scenes share a shape; a common base/helper extraction would cut all four at once. |
| `backend/src/modules/matchmaking/matchmaking.gateway.ts` | 1696 | WebSocket gateway; split per-game handlers into helpers. |
| `frontend/src/styles/modules/social-replays.css` | 1570 | Over CLAUDE.md's own 1600-line hard limit soon; the guide says split before 1600. |
| `frontend/src/features/tournaments/TournamentBoardView.tsx` | 1428 | Split board / controls / overlays. |
| `backend/src/modules/tournaments/runtime/tournament-runtime.ts` | 1376 | |
| `backend/src/modules/chat/chat.service.ts` | 1372 | |
| `frontend/src/styles/modules/hub.css` | 1352 | |
| `frontend/src/features/hub/ShellPickerScene.ts` | 1328 | |
| `frontend/src/games/common/ReplayScene.ts` | 1296 | |
| `frontend/src/routes/GamePage.tsx` | 1207 | |
| `backend/src/modules/tournaments/events/tournament-event.types.ts` | 1135 | Mostly type definitions — low risk, low priority. |
| `frontend/src/styles/modules/hub-modals.css` | 1114 | |
| `frontend/src/features/hub/api.ts` | 1088 | Split by resource/domain. |
| `backend/src/modules/tournaments/tournament-lobby.service.ts` | 1064 | |

### Test files ≥ 1000 LOC (lower priority — tests, but still large)

`backend/src/modules/chat/chat.service.spec.ts` (1698),
`backend/src/modules/matchmaking/matchmaking.gateway.spec.ts` (1258),
`backend/src/modules/tournaments/runtime/tournament-runtime.spec.ts` (1155).

### Approaching the limit (800–999 LOC) — worth watching

`profiles.css` (960), `BambooBashOnline.ts` (892),
`replay.service.ts` (882), `friends.service.spec.ts` (836).

**Suggested priority order:** (1) `HomePage.tsx`, (2) the four game scenes via a
shared extraction, (3) `matchmaking.gateway.ts` and `chat.service.ts`, (4) the
oversized CSS modules (`social-replays.css` first — it is closest to CLAUDE.md's
1600-line hard cap).

---

## 7. Unused CSS and assets

**CSS modules:** Clean. All 18 feature modules are registered in
`frontend/src/styles/modules/index.css`; none are orphaned. (Per-selector
unused-CSS detection was not run — it needs a runtime coverage pass; I can do
that separately if you want.)

**Assets:** 35 of 94 image assets in `public/assets/` are **not referenced**
anywhere in `frontend/src` or the HTML. There are **no dynamically-constructed
asset paths** in the codebase (verified), so unreferenced really means unused.
The pattern is clear: an older set of button/character names was superseded but
the old files were left behind.

Unreferenced assets, grouped:

- **Duplicate game buttons (old naming, superseded):**
  `bambooBashButton.png`, `oniDodgeButton.png`, `koiDiceButton.png`,
  `threeShellMonteButton.png`, `fortuneWheelButton.png`, `templeCurlingButton.png`,
  `shellFlipButton.png`, `riverRushButton.png`, `bellClashButton.png`,
  `kameKnockButton.png`, `shellDropButton.png`, `shrineSlotsButton.png`
  *(the shorter-named variants — `bambooButton.png` etc. — are the ones in use).*
- **Duplicate mode buttons:** `tournamentButton2.png`, `gambitButton2.png`,
  `normalButton2.png`.
- **Unused character portraits:** `sumo-turtle.png`, `assassin-turtle.webp`,
  `rasta-turtle.png`, `ghost-turtle.png`, `ghost-turtle.webp`, `demon-turtle.png`,
  `knight-turtle.png`, `presenter-turtle.png`, `santa-turtle.webp`,
  `pirate-turtle.webp`, `sumo-turtle.webp`.
- **Concept art (not shipped in the app):** `concept-art/ShellSmash_Knock.png`,
  `ShellSmash_GamingHub.png`, `ShellSmash_CommingSoon.png`,
  `ShellSmash_BambooSmash.png`.
- **Misc:** `ui/pongo/button-rect-default@2x.png`,
  `ui/pongo/button-rect-hover@2x.png`, `ui/counter/plate-default@2x.png`,
  `ui/counter/icon-time@2x.png`, `backgrounds/login_bg3.png`.

**Recommendation:** Safe to delete the duplicate buttons and the misc set.
Confirm the character portraits and concept art are not slated for upcoming
content (`docs/modules-progress.md`) before removing — those may be roadmap
assets rather than dead ones.

---

## 8. Scripts, infra & committed tool output

| Item | Finding | Recommendation |
|------|---------|----------------|
| `scripts/check-tournament-contracts.sh` | Not referenced by `Makefile`, Docker Compose, `package.json`, README, CI, or husky hooks. | Confirm it is not a manual/CI helper you run by hand; if not, delete or wire it into `make` or CI. |
| `scripts/generate-cycle-masks.py` + `requirements-cycle-masks.txt` | Referenced only from `docs/` (a fix report and `modules-progress.md`), not wired into any build. | Looks like a **one-off asset generator**. Keep as tooling or move to a `tools/`/archive location; not "dead" but not part of the build. |
| `graphify-out/` (7.0 MB) | **Committed to git** (`.graphify_health.json`, `GRAPH_REPORT.md`, `cache/`…). This is analyser output, not source. | Recommend removing from the repo and adding to `.gitignore` (like `shellsmash/` already is). Serves no purpose in version control. |
| `shellsmash/` (475 MB) | Already git-ignored — **not** in the repo, local only. | No action. |
| `SPEC/` (260 KB) | Tracked at repo root. CLAUDE.md says project docs live under `docs/`. | Low priority — confirm whether it is a live spec set or legacy; if legacy, fold into `docs/` per the repo's own rule. |

---

## 9. What is clean (verified, no action needed)

- **Commented-out code:** None found (one heuristic hit was prose, not code).
- **`debugger` statements:** None.
- **`TODO`/`FIXME`:** 10 total, **all** properly formatted with a reference and
  description (`// TODO(#audio): …`) — exactly matching your own standard. No
  bare `// TODO`s.
- **Skipped/focused tests:** None (`.skip`, `.only`, `xit`, `xdescribe`).
- **Empty `catch` blocks / swallowed errors:** None.
- **`console.*` in production code:** 12, all `console.warn` with contextual tags
  (`[HomeMenu] …`) on real error paths — legitimate, not debug leftovers.
- **`@ts-ignore` / `eslint-disable`:** 5, all `react-hooks/exhaustive-deps` with
  written justifications — acceptable and intentional.

---

## 10. Suggested next steps

1. **You review this document** and mark which items to action.
2. **Quick wins (low risk):** delete the confirmed dead files in §2 (pending the
   `hidpi.ts` rendering check), trim the verified dead exports in §4, delete the
   duplicate assets in §7, and remove `graphify-out/` from git.
3. **Structural (scoped separately):** the file-size work in §6, starting with
   `HomePage.tsx`.

I will not touch anything until you confirm. When you do, I would do it in small,
reviewable commits (one concern each), run
`cd backend && npm run test` and `cd frontend && npm run build && npm run test:run`
after each, and update `docs/modules-progress.md` if any change advances a module.
