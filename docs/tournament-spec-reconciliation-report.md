# SPEC Reconciliation Pass — Final Report

Date: 2026-07-13
Scope: `SPEC/` (Tournament game mode specification suite, SPEC_000–SPEC_040)
Role: Technical Editor
Source of issues: `docs/tournament-architecture-review.md` (Architecture Review, findings AR-01…AR-17)

Constraints honored: no code implemented, no project source code modified, only documentation inside the SPEC folder edited. No system redesign, no architecture boundary changes, no new gameplay or systems, no roadmap changes.

---

## Modified SPECs (30 files)

SPEC_001, SPEC_002, SPEC_003, SPEC_004, SPEC_005, SPEC_006, SPEC_007, SPEC_008, SPEC_009, SPEC_010, SPEC_011, SPEC_012, SPEC_013, SPEC_014, SPEC_015, SPEC_016, SPEC_017, SPEC_018, SPEC_019, SPEC_020, SPEC_021, SPEC_023, SPEC_024, SPEC_026, SPEC_028, SPEC_029, SPEC_031, SPEC_032, SPEC_037, SPEC_040.

Not modified: SPEC_000 (constitution — untouched by design), SPEC_022, SPEC_025, SPEC_027, SPEC_030, SPEC_033–036 (merged stubs), SPEC_038, SPEC_039 — no findings applied to them.

---

## Summary of changes, with reasons

### Task 1 — Canonical Event Catalog (SPEC-004) — resolves AR-01, AR-17

- SPEC-004's "Eventos Base" replaced with a **Catálogo Canónico de Eventos**: every event listed exactly once under its single owner-emitter, a flow-control table (which event unblocks which wait), and a **retired-names ledger**:
  - MovePlayer / MovementRequested / TeleportRequested → movement is a COMMAND to the Board public API, never an event
  - DiceRequested → DiceRollRequested; DiceResult → DiceRolled
  - TurnCompleted / PlayerFinishedTurn → PlayerTurnFinished
  - PurchaseCompleted → ItemPurchased; ItemConsumed → ConsumableUsed
  - PointsChanged → WalletUpdated
  - PlayerLeft → PlayerAbandoned
  - BossReady → BossIntroCompleted
  - PlayerEnteredShop → ShopRequested
  - PlayerStopped, MovementInterrupted → eliminated (nothing emitted or consumed them)
- Every other SPEC's event list now references the catalog; module lists are declared non-normative references.

*Reason: eleven event-name drifts and three consumed-but-never-emitted events made the contract unimplementable as written.*

### Task 2 — Runtime terminology (SPEC-001, 005, 010, 020, 021) — resolves AR-01 emitter ambiguities

- PlayerTurnStarted is owned by the Turn System, not Runtime (SPEC-005).
- DiceRolled / DiceModified owned by the Dice System; DiceRollRequested emitted by the Turn System (SPEC-010).
- TournamentFinished emitted only by Runtime — SPEC-021 now emits FinalChallengeFinished instead, consumed by the State Machine to transition to VICTORY.
- KeyItemUnlocked emitted only by Key Item Progression (SPEC-016, SPEC-017).
- BossIntroCompleted created as the Boss System's owned transition trigger (SPEC-020), consumed in SPEC-003 (replaces the never-emitted BossReady).

*Reason: multi-emitter events destroy the "one owner per event" doctrine SPEC-004 itself declares.*

### Task 3 — Action Engine terminology (SPEC-006, 007, 008) — resolves AR-05, AR-07

- ActionContext has one canonical definition (SPEC-008): TournamentId, PlayerId, Round, TileId (if applicable), EventBus, Services, Metadata. No raw Runtime/Board references; all capabilities via the public contracts in ActionContext.Services. SPEC-006 now references SPEC-008 instead of duplicating a divergent definition.
- "Effect" formally defined as the role of a registered `*Action` executed by an Item (SPEC-007); registry names use the `*Action` suffix.
- TeleportAction, MovePlayerAction, ActivateRuleAction added to the base Actions catalog with their own sections (Board commands, anti-loop guard, Rule Engine command).
- StartMinigameAction retired with an explanatory note (minigames are a Runtime phase, never started from a Tile). Extensibility example changed to SwapPositionsAction.
- SPEC-008 examples rewritten: Teleport → Board.teleportPlayer() command; UnlockKeyItem → command to Key Item Progression (sole emitter of KeyItemUnlocked). Acceptance criterion reworded: the Action Engine knows only the public contracts exposed in ActionContext.Services.

*Reason: two conflicting ActionContext definitions and a catalog missing the very Actions other SPECs invoke.*

### Task 4 — Shop protocol (SPEC-012, 005, 003, 006, 024) — resolves AR-02

- New "Protocolo de interacción (ventana de turno)" section in SPEC-012: Open (ShopRequested → ShopOpened) → Waiting → Buy / Cancel / Timeout → Close (ShopClosed **always** emitted, any outcome) → Resume (turn continues). Never an automatic purchase.
- New WAITING_INTERACTION turn substate (SPEC-003) between RESOLVE_TILE and END_TURN, entered only if the Tile opened an interactive session.
- New "Ventana de interacción" section in the Turn System (SPEC-005): waits for ShopClosed; Gambling explicitly excluded (it is a Runtime phase, never a turn window).
- OpenShopAction note in SPEC-006; 30 s shop-interaction timeout added to SPEC-024.

*Reason: a shop tile stalled the turn forever — nothing defined how the turn resumed.*

### Task 5 — Gambling protocol (SPEC-016) — resolves AR-01 (GamblingFinished)

- New "Modelo de interacción" section mirroring the Shop protocol at Tournament-phase scale: Open (GamblingOpened) → Waiting → Bet / Abandon / Timeout → Close (GamblingFinished) → continue.
- GamblingFinished added as the always-emitted closing event the State Machine consumes; GamblingWon / GamblingLost / GamblingCancelled demoted to detail events for UI/Analytics.
- KeyItemUnlocked removed from the module's emitted list (owned by SPEC-017).

*Reason: SPEC-003 consumed GamblingFinished but no module emitted it.*

### Task 6 — Runtime State Machine (SPEC-001, 003) — resolves AR-04 (partial)

- Terminal **CANCELLED** state added to both canonical state lists, reachable from any non-terminal state only at Match Lifecycle request.
- Full "# Cancelled" section in SPEC-003: causes (server restart, all-disconnected timeout, actives < 2, admin), explicit State Machine transition (never a manual jump), freeze match, release resources, Runtime emits TournamentCancelled, no further transitions.
- SPEC-003 consumed-events list fixed: PlayerFinishedTurn → PlayerTurnFinished; BossReady → BossIntroCompleted.
- SPEC-001: CANCELLED section, WAITING_PLAYERS/CREATED ownership note (session phase owned by Match Lifecycle), fixed TurnOrder note (D13), minigame watchdog cross-reference, emitted-events list reduced to Runtime-owned events, winner invariant covers DEFEAT and CANCELLED.

*Reason: cancellation existed in the Lifecycle and the DB schema but not in the FSM.*

### Task 7 — Match Lifecycle ↔ Tournament Runtime relationship (SPEC-023) — resolves AR-04

New section "Relación con la State Machine del Runtime y el status en BD":

- Match Lifecycle = SESSION machine, sole owner of admission and cancellation; Runtime FSM = GAME machine.
- Canonical mapping table:

| Match Lifecycle | State Machine (SPEC-003) | `tournaments.status` |
| --- | --- | --- |
| Creating | CREATED | pending |
| WaitingPlayers | WAITING_PLAYERS | pending |
| Loading | INITIALIZING | active |
| Running | ROUND_START … REWARDS | active |
| Finished | FINISHED (via VICTORY/REWARDS or DEFEAT) | finished |
| Closed | FINISHED (resources released) | finished |
| Cancelación | CANCELLED | cancelled |

- Exhaustive cancellation causes; the Lifecycle *requests* the explicit CANCELLED transition, never manipulates the FSM directly.

*Reason: two state machines coexisted with no documented correspondence.*

### Task 8 — Naming conventions (SPEC-032) — prevents the AR-01/AR-10 class of drift

- New "Convenciones de nomenclatura" block: events PascalCase past-tense with `*Requested` for result-less requests and one owner per event; `*Intent`, `*Action` (including Item Effects), `*Rule`, `*Reward`, `*Registry`, `*Service` suffixes; imperative command verbs (Economy.Award/Remove/Transfer, Board.movePlayer/teleportPlayer); `tournament:*` WS handler prefix; UPPER_SNAKE_CASE FSM states; snake_case type-prefixed catalog IDs (item_lucky_dice, tile_random_event).
- Pre-merge WS-mirror structural check added to the integration checklist (script in `scripts/`, cross-referenced with SPEC-037) — resolves AR-17.

*Reason: the drift the review found was the product of having no written convention.*

### Task 9 — Broken cross-references (SPEC-037) — resolves AR-12

- Dependency on the non-existent `docs/tournament-mode-architecture-report.md` replaced with the factual statement: seams verified directly against `backend/src/modules/`.
- WS mirror sentence extended to reference the structural check script and the SPEC-032 checklist.

*Reason: dead reference.*

### Task 10 — Deduplication / single source of truth — resolves AR-03, AR-06, AR-08, AR-09, AR-10, AR-11, AR-13, AR-14, AR-15, AR-16

- **SPEC-002 (Board)**: consumed-events section replaced by a **public command API** — initialize(boardConfig), reset(), movePlayer(playerId, steps), teleportPlayer(playerId, tileId); authorized consumers Runtime, Turn System, Actions via ActionContext.Services; "No existe el evento MovePlayer". Anti-loop guard generalized from teleports to all forced relocations (TeleportAction + MovePlayerAction, max one chained relocation). Single-successor v1 topology note on Tile connections (D13).
- **SPEC-009 / SPEC-010 (Rules & Dice)**: "Prioridad" → "Prioridad y composición" — exclusive parameters (dice override, boolean flags): highest priority wins; value modifiers (DiceModifier value, PriceModifier, RewardMultiplier): ALL apply in descending priority order (Lucky Dice +2 and Double Dice x2 both apply); deterministic tiebreak by rule id. Conflictos section aligned; SPEC-010 Rule Engine section aligned; dice event ownership clarified.
- **SPEC-011 / SPEC-018 (Economy & Leaderboard)**: `RemovePoints()` → `Remove()` in Gambling/Shop sections (also SPEC-012); WalletUpdated documented as emitted after every applied operation with the resulting balance; Leaderboard redefined as a derived projection listening exclusively to WalletUpdated (never calculates or corrects balances); pipeline PointsChanged → WalletUpdated.
- **SPEC-013 (Reward Resolver)**: Achievements removed from the architecture diagram (not a Reward source in v1); `actions[]` removed from the Reward definition — the Resolver translates type + payload into Actions, Rewards never carry built Actions; BundleReward merged into CompositeReward.
- **SPEC-014 / SPEC-026**: ItemConsumed → ConsumableUsed; PurchaseCompleted → ItemPurchased in monitored events.
- **SPEC-015 (Minigames)**: empty-candidate rule — if no minigame supports exactly N active players, skip the round's minigame (same transition, log warning; Fase 0 verifies 2/3/4-player coverage). New **watchdog de reconciliación** (v1: 10 min, SPEC-024): MatchLifecycleEvents is best-effort in-memory, so on expiry perform ONE reconciliation from the `matches` table (same mechanism as onModuleInit); result exists → process, else treated as cancelled without result → CHECK_KEY_ITEMS; single reconciliation, never polling; also covers FINAL_CHALLENGE waits. — resolves AR-08, AR-09.
- **SPEC-017 (Key Items)**: sole-emitter note for all its events.
- **SPEC-019 (Random Events)**: weighted selection uses the Tournament seed (deterministic layer, D13); MovePlayerAction/TeleportAction from Random Events count as forced relocations under the Board anti-loop limit.
- **SPEC-024 (Configuration)**: shop-interaction timeout (30 s) and minigame reconciliation watchdog (10 min) added to the v1 values.
- **SPEC-028 (Testing)**: new "Tiempo y timers" section — all Tournament timers via an injectable clock/scheduler owned by Runtime, never direct setTimeout in states; timeout expirations recorded as input events of the deterministic layer, enabling simulation without real time. — resolves AR-15.
- **SPEC-029 (Performance)**: Networking section rewritten — the sync strategy is snapshot-first as defined by SPEC-022, which prevails; the full-snapshot redundancy is deliberate (eliminates desync by construction) and must NOT be optimized away at v1 scale. — resolves AR-03.
- **SPEC-031 (Plan)**: Fase 0 task added — verify the minigame catalog covers 2, 3 and 4-player matches.
- **SPEC-040 (Decisions)**: header updated; new **D13 — Defaults editoriales del Reconciliation Pass (DEFAULT PROVISIONAL)**: (1) fixed TurnOrder generated in INITIALIZING with the Tournament seed, no rotation; (2) v1 single-successor board topology, player-choice forks are a future extension; (3) weighted Random Event selection uses the Tournament seed. Applied in SPEC-001, SPEC-002, SPEC-019. Added to "Pendientes futuros": optional D13 review if playtesting contradicts the defaults. — resolves AR-14.

---

## Verification

Final sweep of `SPEC/` for retired names (`grep` over all files): the only remaining occurrences are intentional — SPEC-004's retired-names ledger, explanatory merge/retirement notes, `TournamentPlayerLeft` (a legitimate lobby event distinct from the retired `PlayerLeft`), and `DiceResult` used as a turn-state field / condition name (data, not events).

---

## Confirmation

**No architectural decisions were changed.** Every edit is contract precision (event ownership and names), protocol documentation (shop/gambling interaction windows, watchdog), terminology unification, or an explicitly-flagged provisional default recorded in SPEC-040 as D13 for user review. Module boundaries, the FSM flow, the command/event doctrine, the roadmap, and all D1–D12 decisions are exactly as they were.

**No Architectural Proposals were needed** — every Architecture Review finding had a documentation-level resolution.

The documentation is now internally consistent and ready for implementation.
