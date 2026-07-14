# Architecture Review — Tournament ("THE PARROT'S SHELL")

**Reviewer role:** Principal Software Architect, pre-implementation audit
**Scope:** SPEC-000 → SPEC-040 (41 documents), cross-checked against the existing platform code in `backend/src/modules/`
**Date:** 2026-07-13

---

## Overall impression

This is an unusually disciplined spec suite. The core patterns are sound and mutually reinforcing: server-authoritative FSM orchestrator, a single Action Engine shared by Tiles/Items/Events/Rewards, a canonical event catalog with an explicit precedence rule, the command-vs-event distinction (SPEC-004), snapshot-first sync (SPEC-022), and honest v1 de-scoping (rollback, plugins, hot reload, horizontal scaling all explicitly deferred). SPEC-037/040 ground the abstractions in real code and resolved decisions. The problems found below are almost entirely **contract reconciliation and missing protocol definitions**, not structural defects. No component needs to be redesigned.

Platform-grounding claims were verified against the real codebase: `match-factory.service.ts`, `match-lifecycle.events.ts`, `casino.fair.ts`, and `private-lobbies.service.ts` all exist where SPEC-037 says they do. One referenced document does not exist (see AR-12).

---

## HIGH severity findings

### AR-01 — Event contract drift across specs: several consumed events are never emitted, and the same fact has 2–3 names

**Severity:** High

**Description:** Despite SPEC-004 declaring itself canonical, the per-module emit/consume lists do not reconcile:

- SPEC-003 consumes `BossReady` — no spec emits it (SPEC-020 emits `BossSpawned`/`BossFinished`).
- SPEC-003 consumes `FinalChallengeFinished` — SPEC-021 emits `ShellGranted`/`TournamentFinished`, never `FinalChallengeFinished` (it is in the canonical list but has no emitter).
- SPEC-001/003 consume `GamblingFinished` — SPEC-016 emits `GamblingWon`/`GamblingLost`/`GamblingCancelled`, never `GamblingFinished`.
- Turn end has three names: `PlayerTurnFinished` (canonical, emitted by SPEC-001), `TurnCompleted` (emitted by SPEC-005), `PlayerFinishedTurn` (consumed by SPEC-003).
- Dice: SPEC-005 emits `DiceRequested` and consumes `DiceResult`; SPEC-010 emits `DiceRollRequested` and `DiceRolled`.
- Movement: SPEC-002 consumes `MovePlayer`; SPEC-005 emits `MovementRequested` — and *also* says it calls `Board.movePlayer()` directly, so it is undefined whether movement is a command or an event (per SPEC-004's own rule it must be a command, since Turn System needs the result).
- Shop/Items: canonical `ItemPurchased`/`ConsumableUsed` vs module-level `PurchaseCompleted` (SPEC-012) / `ItemConsumed` (SPEC-014); SPEC-026 Analytics subscribes to the **non-canonical** names.
- SPEC-018's pipeline is triggered by `PointsChanged`, which no document defines.
- SPEC-001 consumes `PlayerLeft`; SPEC-023 (the owner) emits `PlayerAbandoned`.
- Ambiguous ownership: `TournamentFinished` is listed as emitted by both SPEC-001 and SPEC-021; `KeyItemUnlocked` appears as emitted by SPEC-001, SPEC-016, SPEC-017 and as the output of an SPEC-008 action. SPEC-004 says the state owner emits facts — for global progression that owner is SPEC-017, and no other spec should claim it.

**Why it is a problem:** SPEC-031 Phase 0/1 has subagents generate the WS/event contract files directly from these lists, and SPEC-036 forbids subagents from resolving ambiguity themselves. Every mismatch above is a guaranteed stop-and-escalate or, worse, a silently dead listener (state machine waiting forever on `BossReady`). This is the exact failure mode an event-driven architecture is most vulnerable to: nothing crashes, the tournament just hangs.

**Possible solutions:** (a) Rely on SPEC-004's precedence rule and let implementers reconcile ad hoc; (b) do a single reconciliation pass producing one authoritative emit/consume matrix (event → owner/emitter → consumers → payload) and update SPEC-001/002/003/005/010/012/014/016/018/020/021/023/026 to match; (c) drop per-module lists entirely and keep only SPEC-004.

**Recommended:** (b). One editing pass before Phase 0, adding an "Owner" column to the SPEC-004 catalog. The mechanically checkable rule should be: every consumed event has exactly one owning emitter. This is a documentation day, not an architecture change.

### AR-02 — Turn completion is undefined when a tile opens an interactive session (Shop): the game can stall indefinitely

**Severity:** High

**Description:** SPEC-005 ends a turn when "movement finished, tile fully resolved, no pending events." But `OpenShopAction` is fire-and-forget (`ShopRequested`, per the SPEC-004/006 command rules), so tile resolution completes instantly while the shop modal is still open. No spec defines whether the turn waits for `ShopClosed`, and no timeout exists for the shop decision: SPEC-024's timeout list covers dice (30 s), gambling decision (30 s), and all-disconnected (10 min) — nothing for in-turn shop interaction. SPEC-005's timeout is explicitly scoped "para lanzar el dado."

**Why it is a problem:** A connected but idle player who lands on a shop tile blocks the whole match forever. Disconnection auto-resolve doesn't cover this (the player is connected). It also leaves the Turn System's core exit condition ("no pending events") unimplementable as specced — the implementer cannot know what counts as pending. Gambling got this treatment (explicit open/decide/timeout/abandon protocol); the shop, which occurs far more often, did not.

**Possible solutions:** (a) Define an in-turn interaction window: after tile resolution, if any `*Requested` interactive session was opened, the turn enters a `WAITING_INTERACTION` sub-step that ends on `ShopClosed` or on a configurable timeout (reuse the 30 s pattern), resolving as "close without purchase"; (b) make the shop non-blocking: turn ends immediately and the shop stays open only during the player's own dice window of the *next* phase — this changes gameplay feel; (c) fold shop interaction into the existing turn timeout (one global per-turn clock covering dice + interactions).

**Recommended:** (a), specified in SPEC-005 (sub-state) + SPEC-012 (decision timeout, default 30 s in SPEC-024). It mirrors the Gambling protocol exactly, so it adds no new concepts.

---

## MEDIUM severity findings

### AR-03 — SPEC-029 directly contradicts SPEC-022 on synchronization strategy

**Severity:** Medium

**Description:** SPEC-022 mandates snapshot-first: full snapshot with monotonic `seq` after every authoritative change; incremental events are presentation-only and never a source of state. SPEC-029 (Networking section) says: "Nunca enviar información redundante. Priorizar: eventos incrementales. Snapshots únicamente cuando sean necesarios."

**Why it is a problem:** These prescribe opposite designs for the same wire protocol. A subagent implementing Networking reads SPEC-022; a subagent doing the Phase 8 performance pass reads SPEC-029 and will "optimize" the snapshots away — undoing the property SPEC-022 relies on to eliminate desync by construction.

**Possible solutions:** (a) Amend SPEC-029 to defer to SPEC-022 ("redundancy of snapshots is a deliberate design choice; do not optimize it away at v1 scale"); (b) declare SPEC-022 canonical for networking in SPEC-022 itself.

**Recommended:** (a). Snapshot-first is the right call for a 4-player, low-tick board game — the SPEC-029 paragraph is a generic platitude that survived the revision and should be rewritten.

### AR-04 — Two overlapping state machines (Runtime FSM vs Match Lifecycle) with no defined mapping, and cancellation is missing from the canonical FSM

**Severity:** Medium

**Description:** SPEC-001/003 define the canonical 14-state Tournament FSM (including `CREATED`, `WAITING_PLAYERS`). SPEC-023 defines a second session-level machine (`Creating → WaitingPlayers → Loading → Running → Finished → Closed`). SPEC-037 adds a third vocabulary: the DB `status` enum (`pending | active | finished | cancelled`). No document maps them, and both machines claim the "waiting for players" responsibility. Additionally, cancellation — required in v1 by three concrete flows (server restart marks in-flight tournaments cancelled, all-disconnected 10-min timeout, active players < 2) — has **no state or transition in the canonical FSM**, whose only terminal is `FINISHED` and whose invariant is "always exactly one active state."

**Why it is a problem:** Duplicate responsibility (who owns WAITING_PLAYERS?) is exactly the class of conflict SPEC-031 says must halt integration when two subagents (Runtime vs Match Lifecycle domains) touch it. And an FSM that cannot express its own mandatory abort path forces implementers to add out-of-band transitions, violating SPEC-003's "no manual jumps."

**Possible solutions:** (a) Add a mapping table (Lifecycle state ↔ FSM state range ↔ DB status) and move `CREATED`/`WAITING_PLAYERS` ownership to Match Lifecycle, with the Runtime FSM starting at `INITIALIZING`; (b) keep both machines but add a `CANCELLED` terminal reachable from any state, and declare Lifecycle as the sole owner of pre-game states; (c) merge Lifecycle into the Runtime FSM.

**Recommended:** (b) plus the mapping table in SPEC-023. Keep the machines separate (session concerns vs game-flow concerns is a good split); just draw the boundary explicitly and give the FSM a legal abort transition.

### AR-05 — ActionContext is defined twice, inconsistently, and its contents contradict the Actions' own isolation rules

**Severity:** Medium

**Description:** SPEC-006 defines `ActionContext` as {Tournament, Player, Tile, Board, Round, Runtime, EventBus} and says "No recibe referencias a otros sistemas." SPEC-008 defines it as {TournamentId, PlayerId, Board, Runtime, Round, Tile, Inventory, EventBus, Services, Metadata}. Beyond the drift (objects vs IDs; Services/Inventory/Metadata only in one), both versions hand every Action live references to `Runtime` and `Board` — while SPEC-006/008 restrictions say Actions "never access another system's internal state," "never know other modules," and SPEC-008's acceptance criterion states "Action Engine desconoce completamente Tournament."

**Why it is a problem:** A context carrying the Runtime is a service locator that makes every prohibited coupling available in one property access — the restrictions become unenforceable by construction, and the "engine reusable in other game modes" criterion is unachievable if the context type names Tournament concepts. Two subagents (Board domain, Gameplay domain) will also implement two different context shapes.

**Possible solutions:** (a) Make SPEC-008 canonical, reduce the context to IDs + `Services` (capability interfaces: EconomyApi, InventoryApi, RuleEngineApi, BoardQueryApi…) + `EventBus`, and remove raw `Runtime`/`Board` references; (b) keep the god-context and delete the isolation claims.

**Recommended:** (a). It matches the command/event doctrine the specs already commit to — every legitimate use of `Runtime`/`Board` in an Action is expressible as either a Services command or a `*Requested` event. SPEC-006 should then just reference SPEC-008's definition instead of restating it.

### AR-06 — Modifier composition semantics contradict each other (priority-wins vs stacking)

**Severity:** Medium

**Description:** SPEC-009: when several Rules modify the same parameter, "mayor prioridad gana" — exclusive selection. SPEC-010: the Rule Engine may modify the final dice value "p. ej. +2 de Lucky Dice, x2 de Double Dice Rule" — an example that only makes sense if both apply (stacking), and which is the intended v1 content (a player holding Lucky Dice during a Boss Double-Dice phase).

**Why it is a problem:** These produce different game results (8 vs 16 on a roll of 6, or 12 if only one wins). Dice modification is on the deterministic layer, so the ambiguity also breaks replay/simulation comparability across implementations. This is not a deferred gameplay decision — it's an engine semantics decision the Rule Engine subagent cannot make alone (SPEC-036 forbids it).

**Possible solutions:** (a) Priority defines *ordering*, not exclusion: all active modifiers of a query point apply in priority order (additive before multiplicative, or strictly by priority); (b) priority is exclusive per query point (highest wins); (c) exclusive for dice-override, stacking for value modifiers.

**Recommended:** (c), documented in SPEC-009: dice *override* (which die is rolled) is winner-takes-all by priority; *value* modifiers stack applied in priority order. That matches every v1 content example and keeps determinism well-defined.

### AR-07 — Teleport / MovePlayer execution path is unwired, and the anti-loop guard covers only teleports

**Severity:** Medium

**Description:** `TeleportAction` emits `TeleportRequested` (SPEC-008), but no spec consumes it — SPEC-002's Board consumes only `MovePlayer`, `BoardInitialized`, `TournamentReset`. `MovePlayerAction` and `ActivateRuleAction` are required by SPEC-019's v1 Random Events but are absent from SPEC-006's base Action catalog. And the loop guard in SPEC-002 ("one chained teleport max") covers teleports only: a Random Event tile whose event runs `MovePlayerAction` → lands on another Random Event tile → another `MovePlayerAction` → … has no chain limit at all.

**Why it is a problem:** Teleport is v1 content (Golden Compass item, Random Events), so its missing consumer will surface as a stop-work under SPEC-000 on day one of Phase 3. The unbounded movement chain is a genuine liveness/determinism risk — a legally configured board can loop forever.

**Possible solutions:** (a) Movement relocations become commands to Board's public API (`Board.teleportPlayer()`, `Board.movePlayer(delta)`), per the SPEC-004 rule (the caller needs the result), and the Board consumed-events list is corrected; (b) keep `TeleportRequested` as an event and add Board as its consumer; also generalize SPEC-002's guard to "at most one chained *relocation* (teleport or forced move) per tile resolution."

**Recommended:** (a) with the generalized guard, and add `TeleportAction`/`MovePlayerAction`/`ActivateRuleAction` to SPEC-006's base catalog. Consistency point: `StartMinigameAction` sits in that catalog but conflicts with the FSM (minigames are phase-driven, one per round) — remove it from v1.

### AR-08 — MINIGAME phase has no liveness guard over a best-effort, in-memory event source

**Severity:** Medium

**Description:** SPEC-037 itself states `MatchLifecycleEvents` is best-effort and in-memory, and mandates reconciliation from the `matches` table — but only at `onModuleInit`. SPEC-015 requires the MINIGAME state to wait "exclusively on events, no polling" with no maximum duration; SPEC-001's FSM offers no timeout transition out of MINIGAME.

**Why it is a problem:** A single dropped `finished` event (listener exception in another subscriber, race during minigame teardown) parks the tournament in MINIGAME forever, and nothing detects it until a server restart cancels the whole match. The specs correctly banned hot polling but threw out the safety net with it.

**Possible solutions:** (a) A per-wait watchdog: on entering MINIGAME (and FINAL_CHALLENGE), arm a generous timer (e.g., 2× the platform's longest match duration); on expiry, reconcile once from the `matches` table (the pattern SPEC-037 already requires at boot) and either recover the result or cancel the round; (b) periodic low-frequency reconciliation for all in-flight tournament matches.

**Recommended:** (a), stated in SPEC-015. One reconcile-on-timeout is not polling; it is the same recovery pattern the platform already uses, applied at the moment it matters.

### AR-09 — No behavior defined when the minigame catalog has no game supporting the active-player count

**Severity:** Medium

**Description:** SPEC-015 filters candidates to minigames supporting *exactly* the number of active players and covers "< 2 actives → skip," but not "N actives, empty candidate list" (e.g., 3 active players when the catalog holds only 2- and 4-player games).

**Why it is a problem:** With one abandoned player — an explicitly supported v1 situation — the round's minigame selection can yield an empty set. Undefined behavior at the very center of the progression loop (no minigame → no gambling → Key Items only via shop → likely collective defeat), and the subagent must halt on it per SPEC-000. Whether the existing catalog actually contains games for every count of 2–4 is a fact nobody has pinned down in the specs.

**Possible solutions:** (a) Skip the minigame that round (reuse the < 2 rule) and log; (b) relax the filter to "supports ≥ N" or "closest supported count," splitting or subsetting players; (c) verify in Phase 0 grounding that the catalog covers 2, 3, and 4 players and add that as an explicit precondition.

**Recommended:** (a) as the defined fallback plus (c) as a Phase 0 verification task in SPEC-031. (b) invents matchmaking semantics the platform doesn't have.

---

## LOW severity findings

### AR-10 — `BundleReward` vs `CompositeReward`: two undistinguished nesting abstractions

**Severity:** Low

**Description:** SPEC-013 lists both types; only Composite is described; no difference is defined. The `Reward` object also carries both `type/payload` *and* `actions[]`, leaving it unclear whether the Resolver translates types into Actions or executes embedded ones.

**Why it is a problem:** Duplicate abstraction invites two implementations of the same concept — the exact "never duplicate" failure SPEC-000 bans.

**Possible solutions:** Merge into one (`CompositeReward`); clarify that `actions[]` is the Resolver's *output* of translation, or remove it from the data shape.

**Recommended:** Merge and clarify translation direction in SPEC-013.

### AR-11 — Leaderboard's event feed is underspecified

**Severity:** Low

**Description:** `PointsAwarded`'s payload (amount, reason, source) carries deltas, no resulting balance; SPEC-018 says the Leaderboard "never stores its own scores" yet must rebuild ranking from those deltas (i.e., it must accumulate — a contradiction in wording), and never mentions `PointsTransferred` (steals) or the `WalletUpdated` event SPEC-011 already emits.

**Why it is a problem:** An implementer subscribing only to Awarded/Removed silently mis-ranks after every steal.

**Possible solutions:** Subscribe the Leaderboard to `WalletUpdated` (which should carry the new balance), reframing it as a projection/view.

**Recommended:** That; it also fixes the wording contradiction — a projection legitimately caches derived state without being the source of truth.

### AR-12 — Broken reference: `docs/tournament-mode-architecture-report.md` does not exist

**Severity:** Low

**Description:** SPEC-037 lists it as a dependency ("Código existente en `main` (ver docs/tournament-mode-architecture-report.md)"); the file is absent from `docs/`.

**Why it is a problem:** SPEC-037 is the grounding document subagents must trust; its one external evidence pointer is dead.

**Possible solutions:** Restore/commit the report, or delete the reference.

**Recommended:** Commit the report if it exists somewhere; otherwise remove the citation — SPEC-037's inline claims checked out against the code and can stand on their own.

### AR-13 — Documentation-order dependency inversions

**Severity:** Low

**Description:** SPEC-006 defines Tile Actions in terms of `IAction` "defined in SPEC-008," while SPEC-008 declares a dependency on SPEC-006 (similarly 016↔017, 001↔037).

**Why it is a problem:** The suite claims intentional ordering; a reader (or a context-minimized subagent given "SPEC-006 and its dependencies") gets an undefined symbol. Not a code-level cycle — the runtime layering is clean.

**Possible solutions:** Reorder (Action Engine before Tile Actions) or annotate forward references.

**Recommended:** Add a one-line "forward reference, see SPEC-008" note; don't renumber at this point.

### AR-14 — Minor gameplay parameters not defined and not registered in SPEC-040

**Severity:** Low

**Description:** (1) Turn-order rotation across rounds — SPEC-001 says `ROUND_START: seleccionar primer jugador` without stating fixed-order vs rotate; (2) board branching — `Tile.connections[]` implies a graph but no fork-choice mechanic exists (v1 board is presumably a loop, but no spec says so); (3) random-event selection is not explicitly bound to the Tournament seed, unlike dice/minigame selection, though it sits on the deterministic layer.

**Why it is a problem:** These aren't in SPEC-040, so under SPEC-036 they become stop-work escalations rather than known defaults.

**Possible solutions / Recommended:** Add three lines: fixed turn order v1; v1 boards are single-successor (connections carry exactly one next tile); random-event RNG uses the Tournament seed. Register as resolved defaults in SPEC-040.

### AR-15 — Simulation determinism needs injectable time, but no spec requires it

**Severity:** Low

**Description:** SPEC-028 forbids tests depending on real time, and SPEC-000 demands deterministic replay of the board layer, but timeouts (turn, gambling, shop) are wall-clock. Nothing states that timers must be injectable/fakeable and that timeout firings count as recorded inputs.

**Why it is a problem:** Discovered late, this forces retrofitting `setTimeout` calls scattered across states — the classic testability regression.

**Possible solutions / Recommended:** One paragraph in SPEC-028 or SPEC-003: all timers go through an injectable clock/scheduler owned by the Runtime; timeout expirations are events (inputs) for replay purposes.

### AR-16 — Naming drift in public command APIs and one scope-noise diagram

**Severity:** Low

**Description:** SPEC-012 calls `Economy.RemovePoints()`; SPEC-011's canonical API is `Remove()`. SPEC-013's architecture diagram lists "Achievements" as a reward source, contradicting its own scope section (internal rewards only; achievements are platform-persistent, SPEC-037).

**Why it is a problem:** Contract names are frozen by SPEC-032; drift now means churn later.

**Possible solutions / Recommended:** Align SPEC-012 to SPEC-011's names; drop "Achievements" from the SPEC-013 diagram.

### AR-17 — Hand-mirrored WS contracts between backend and frontend

**Severity:** Low (acknowledged risk)

**Description:** SPEC-037 mandates a single backend types file mirrored "consciously by hand" in the frontend.

**Why it is a problem:** With 30+ events and multiple snapshot shapes, manual mirroring will drift exactly once it matters (a field renamed on one side). The spec knows this; it just accepts it.

**Possible solutions:** Shared types package; codegen; or a CI-less `diff` check script in `scripts/`.

**Recommended:** A trivial structural-diff script run as part of the pre-merge checklist (SPEC-032 already has a local checklist to hang it on). Cheap, no build-system surgery.

---

## Checklist coverage — areas with no findings

Explicitly verified and internally coherent, with no issue invented to fill the row:

- **Circular dependencies (runtime):** none — layering (Registries → Engines → Orchestrator; commands down, events up) is acyclic; only doc-order inversions exist (AR-13).
- **Over-engineering:** largely absent — the v1 de-scoping in SPEC-008 (rollback/delay/parallel/retry), SPEC-009 (five fixed query points), SPEC-024 (TS catalogs, no loader), SPEC-029 (single-process honesty), and SPEC-030 (plugins deferred) is exemplary. Residual specks: `Offer.currency` with a single currency, `Registry.unregister()/clear()` for immutable static catalogs — not worth changes.
- **Under-engineering:** none beyond the items already listed (AR-02, AR-08, AR-09).
- **Persistence:** snapshot-per-transition into `tournaments.state` jsonb is appropriate at this scale; v1's cancel-on-restart policy makes intra-`PLAYER_TURNS` snapshot granularity a non-issue today (worth revisiting only when resume is built).
- **Scalability:** correctly scoped — per-tournament isolation, no shared mutable state, ordered bus per match; horizontal scaling explicitly out of scope rather than hand-waved.
- **Economy integrity:** single-writer wallet, atomic Transfer, transaction ledger, no-negative invariant, strict separation from `users.coins` — coherent end to end, including the paper-check of the economic loop (100 start / 50+15 minigame / 120 gamble at 40%+pity / 500 offer).
- **Security/authority:** intents-only client, full server validation, provably-fair gambling reusing `casino.fair.ts` without touching `wagers`/`users.coins` — consistent across SPEC-005/011/016/022.
- **SOLID / Clean Architecture:** aside from AR-05 (context as service locator), the suite is genuinely strong: single responsibility per system, open/closed via registries+config, dependency inversion via public contracts. The known netcode-of-arena risk is documented with an explicit human decision gate (SPEC-037/D9) — the right way to handle it.
- **Intentionally undefined items respected:** theming/narrative (D11), final balance numbers (D2), teleport default revisit (D8), spectator extras (D12) were **not** counted as issues, per the review rules.

---

## Overall assessment

| Dimension | Score | Rationale |
|---|---|---|
| Architecture | **9/10** | Sound, layered, event-driven with a correct command/event split; deductions only for the contract drift (AR-01) and dual-FSM boundary (AR-04). |
| Maintainability | **9/10** | Canonical catalogs, decisions log, merged process docs, single Definition of Done. |
| Scalability | **7/10** | Honest and adequate for v1 (many tournaments, one process); horizontal scale deliberately unaddressed, so capped by design. |
| Modularity | **9/10** | Exemplary boundaries and prohibition lists; AR-05's god-context is the one leak. |
| Testability | **9/10** | Simulation-first strategy, seeds, isolated actions; missing only the injectable-clock mandate (AR-15). |
| Extensibility | **9/10** | Actions/Rules/Registries/Catalogs give real open-closed extension; plugin future is plausible without rework. |
| Readability | **8/10** | Consistent voice and structure; the arrow-diagram style is verbose, and cross-spec name drift forces the reader to reconcile. |
| Production Readiness | **7/10** | No CI, hand-mirrored WS contracts, arena-netcode dependency still unstable (gated but unresolved), and the liveness gaps (AR-02, AR-08) must close before real players touch it. |

## Verdict

**READY FOR IMPLEMENTATION** — conditioned on one spec-reconciliation pass before Phase 0/1 closes:

1. **AR-01** — publish the single event ownership matrix and align all module emit/consume lists (blocking: Phase 0 defines the contract files from these lists).
2. **AR-02** — define the in-turn interaction protocol + shop timeout (blocking before Phase 3).
3. **AR-03, AR-04, AR-05, AR-06, AR-07, AR-08, AR-09** — resolve before their owning phases (networking, lifecycle, engines, gameplay, progression respectively); each is a bounded edit to existing documents.

None of the findings require redesigning a component, changing a boundary, or altering the phase plan — they are missing definitions and cross-document mismatches of the kind this suite's own process (SPEC-036 stop-on-ambiguity + SPEC-040 decision log) is built to absorb. Fixing them on paper now costs about a day; hitting them mid-implementation costs a stalled subagent each time. The architecture itself is internally coherent and better prepared for implementation than the large majority of pre-development spec suites.
