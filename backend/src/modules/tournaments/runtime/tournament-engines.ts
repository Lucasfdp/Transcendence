/**
 * tournament-engines.ts — the per-tournament ENGINE COMPOSITION ROOT (F2).
 *
 * The Runtime owns one instance of every stateful engine per tournament
 * (SPEC-001 "Datos mantenidos"); this factory constructs all six and WIRES the
 * dependency-inverted seams each engine deliberately left open so it could ship
 * standalone:
 *
 *   • Economy ← `RewardRuleApplier` adapter over the Rule Engine (SPEC-011
 *     "Rule Engine": Rules shape rewards through `queryRewardMultiplier`; they
 *     never touch the wallet directly).
 *   • Action Engine ← a single `ActionServices` capability bundle exposing the
 *     Economy / Rule Engine / Inventory public ports (SPEC-008 "Context",
 *     ruling F2-4). Actions drive owner systems ONLY through this bundle.
 *   • Inventory `ItemEffectRunner` AND Reward Resolver `RewardActionRunner` ←
 *     the SAME `ActionEngine`-backed adapter (both ports are the identical
 *     `run(configs, context) => ExecutionResult[]` shape on purpose — one
 *     concrete runner satisfies both, SPEC-013/SPEC-014 "Todo uso pasa por
 *     Action Engine").
 *
 * This is composition only: it constructs and connects, it runs no gameplay and
 * touches no TypeORM. It shares the Runtime's bus/clock/logger and reads the
 * validated `TournamentSettings` (never hardcodes a number — SPEC-024/025).
 * Determinism is inherited from the engines it wires (SPEC-028): the shared
 * clock is the only time source; no `Math.random`/`Date.now` here.
 */

import {
	ActionConfig,
	ActionContext,
	ActionServices,
	ExecutionResult,
	StealServices,
	skippedResult,
} from "../actions/action.interface";
import { ActionEngine } from "../actions/action-engine";
import {
	ActionFactory,
	ActionRegistry,
	ConditionRegistry,
} from "../actions/action-registry";
import {
	registerBaseActionsAndConditions,
	registerInventoryActions,
} from "../actions/base-actions";
import { registerTileActions } from "../actions/tile-actions";
import {
	BoardDefinition,
	BoardSnapshot,
	TileActionRunner,
} from "../board/board.types";
import { V1_BOARD_ID, createBoardRegistry } from "../board/board-registry";
import { TournamentBoard } from "../board/tournament-board";
import { DiceSnapshot, DiceValueModifier } from "../dice/dice.types";
import { createDiceRegistry } from "../dice/dice-registry";
import { TournamentDice } from "../dice/tournament-dice";
import { TournamentTurnSystem } from "../turn/tournament-turn-system";
import { TurnSnapshot } from "../turn/turn.types";
import { TournamentRandomEvents } from "../random-events/tournament-random-events";
import {
	RandomEventActionRunner,
	RandomEventsSnapshot,
} from "../random-events/random-event.types";
import { TournamentSettings } from "../config/settings.catalog";
import {
	EconomySnapshot,
	RewardRuleApplier,
	TournamentEconomy,
} from "../economy/tournament-economy";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { TournamentRng, TournamentRngSnapshot } from "../infra/tournament-rng";
import {
	InventorySnapshot,
	ItemDefinition,
	ItemEffectRunner,
} from "../inventory/item.types";
import { createItemRegistry } from "../inventory/item-registry";
import { TournamentInventory } from "../inventory/tournament-inventory";
import {
	LeaderboardSerialized,
	TournamentLeaderboard,
} from "../leaderboard/tournament-leaderboard";
import { Registry } from "../registry/registry";
import { createRewardRegistry } from "../rewards/reward-registry";
import { TournamentRewardResolver } from "../rewards/reward-resolver";
import {
	RewardActionRunner,
	RewardDefinition,
	RewardResolverSnapshot,
} from "../rewards/reward.types";
import {
	SerializedRuleEngine,
	TournamentRuleEngine,
} from "../rules/tournament-rule-engine";

export interface TournamentEnginesOptions {
	readonly tournamentId: string;
	/** Participant user ids; one wallet/inventory/leaderboard entry per id. */
	readonly participantIds: readonly number[];
	/** Validated settings resolved by configId (SPEC-024/025). */
	readonly settings: TournamentSettings;
	/** Tournament seed (SPEC-000): the Dice System rolls reproducibly from it. */
	readonly seed: string;
	/** Shared per-tournament bus (SPEC-004: one bus per tournament). */
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	readonly logger?: TournamentLogger;
	/** Lets every engine stamp the live round on events/queries; defaults to 0. */
	readonly getRound?: () => number;
	/** Item content registry (defaults to the seeded v1 fixtures). */
	readonly itemRegistry?: Registry<ItemDefinition>;
	/** Reward content registry (defaults to an empty registry). */
	readonly rewardRegistry?: Registry<RewardDefinition>;
	/** Board content registry (defaults to the seeded v1 placeholder board). */
	readonly boardRegistry?: Registry<BoardDefinition>;
	/** Which board to load (defaults to the v1 placeholder board id). */
	readonly boardId?: string;
}

/** JSON-safe snapshot of every engine, embedded in the Runtime snapshot. */
export interface TournamentEnginesSnapshot {
	readonly economy: EconomySnapshot;
	readonly rules: SerializedRuleEngine;
	readonly leaderboard: LeaderboardSerialized;
	readonly inventory: InventorySnapshot;
	readonly rewards: RewardResolverSnapshot;
	readonly board: BoardSnapshot;
	readonly dice: DiceSnapshot;
	readonly turn: TurnSnapshot;
	readonly randomEvents: RandomEventsSnapshot;
	readonly rng: TournamentRngSnapshot;
}

/** Input for building an `ActionContext` bound to this bundle's services. */
export interface ActionContextInput {
	readonly playerId: number;
	readonly round?: number;
	readonly tileId?: string;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The wired engine bundle a Runtime holds for one tournament. */
export interface TournamentEngines {
	readonly economy: TournamentEconomy;
	readonly rules: TournamentRuleEngine;
	readonly leaderboard: TournamentLeaderboard;
	readonly inventory: TournamentInventory;
	readonly rewards: TournamentRewardResolver;
	readonly board: TournamentBoard;
	readonly dice: TournamentDice;
	readonly turnSystem: TournamentTurnSystem;
	readonly randomEvents: TournamentRandomEvents;
	readonly actionEngine: ActionEngine;
	readonly actionFactory: ActionFactory;
	/** The capability bundle every Action runs against (SPEC-008 "Context"). */
	readonly services: ActionServices;
	/** Builds an ActionContext bound to `services` (so rewards/items resolve). */
	makeActionContext(input: ActionContextInput): ActionContext;
	serialize(): TournamentEnginesSnapshot;
}

/**
 * Constructs and wires all six per-tournament engines (F2 composition). Order
 * respects the real dependency edges: Rule Engine first (Economy's reward seam
 * consults it), then Economy/Leaderboard, then the Action Engine + factory (the
 * shared runner adapter needs them), then Inventory and the Reward Resolver
 * (both driven by that runner), and finally the `ActionServices` bundle the
 * Actions run against.
 */
export function createTournamentEngines(
	options: TournamentEnginesOptions,
): TournamentEngines {
	const {
		tournamentId,
		participantIds,
		settings,
		seed,
		bus,
		clock,
		logger,
		itemRegistry,
		rewardRegistry,
		boardRegistry,
		boardId,
	} = options;
	const getRound = options.getRound ?? ((): number => 0);

	// 1. Rule Engine — consulted by the Economy reward seam (SPEC-009).
	const rules = new TournamentRuleEngine({
		tournamentId,
		bus,
		clock,
		logger,
		getRound,
	});

	// Economy ← Rule Engine reward seam (SPEC-011 "Rule Engine"): the base
	// award/cost amount is shaped by active rules, which never touch the wallet.
	const rewardRuleApplier: RewardRuleApplier = {
		applyRewardMultiplier: ({ playerId, baseAmount }) =>
			rules.queryRewardMultiplier(
				{ tournamentId, round: getRound(), playerId, eventBus: bus },
				baseAmount,
			),
	};

	// 2. Economy + Leaderboard (Leaderboard projects off the Economy's
	//    WalletUpdated facts — SPEC-018 — but subscribes on the shared bus).
	const economy = new TournamentEconomy({
		tournamentId,
		participantIds,
		initialPoints: settings.initialPoints,
		bus,
		clock,
		logger,
		rewardRuleApplier,
		getRound,
	});
	const leaderboard = new TournamentLeaderboard({
		tournamentId,
		participantIds,
		bus,
		clock,
		logger,
		getRound,
	});

	// 3. Action Engine + factory. `grantItem` is registered here (only where an
	//    Inventory service is actually wired) on top of the six base Actions.
	const actionRegistry = new ActionRegistry();
	const conditionRegistry = new ConditionRegistry();
	registerBaseActionsAndConditions(actionRegistry, conditionRegistry);
	registerInventoryActions(actionRegistry);
	registerTileActions(actionRegistry);

	const actionEngine = new ActionEngine({ clock, logger });
	const actionFactory = new ActionFactory(actionRegistry, conditionRegistry, {
		engine: actionEngine,
		logger,
	});

	// The ONE runner satisfying both `ItemEffectRunner` (Inventory consume) and
	// `RewardActionRunner` (Reward Resolver): build each config into an Action
	// via the factory and run it through the engine, returning one result per
	// config in order. Never throws (the engine catches internal errors).
	const actionRunner: RewardActionRunner & ItemEffectRunner = {
		run(
			configs: readonly ActionConfig[],
			context: ActionContext,
		): ExecutionResult[] {
			return configs.map((config) => {
				const action = actionFactory.create(config);
				return action
					? actionEngine.execute(action, context)
					: skippedResult(`unbuildable action "${config.type}"`);
			});
		},
	};

	// 4. Inventory (consumes via the runner) + Reward Resolver (resolves via it).
	const inventory = new TournamentInventory({
		tournamentId,
		participantIds,
		capacity: settings.inventoryCapacity,
		registry: itemRegistry ?? createItemRegistry({ seed: true }),
		bus,
		clock,
		logger,
		effectRunner: actionRunner,
		getRound,
	});
	const rewards = new TournamentRewardResolver({
		tournamentId,
		bus,
		clock,
		registry: rewardRegistry ?? createRewardRegistry(),
		actionRunner,
		logger,
		getRound,
	});

	// 5. Dice ← Rule Engine value-modifier seam (SPEC-010 "Rule Engine"): the
	//    rolled value passes through the Rule Engine's DiceModifier composition.
	const diceValueModifier: DiceValueModifier = {
		apply: ({ playerId, round, baseValue }) =>
			rules.queryDiceModifier(
				{ tournamentId, round, playerId, eventBus: bus },
				baseValue,
			),
	};
	const dice = new TournamentDice({
		tournamentId,
		seed,
		registry: createDiceRegistry({ seed: true }),
		bus,
		clock,
		logger,
		valueModifier: diceValueModifier,
		getRound,
	});

	// 6. The capability bundle Actions run against (SPEC-008 "Context"). Declared
	//    with `let` because the Board's context factory closes over it and the
	//    Board is itself a member (`services.board`) — a benign construction cycle
	//    resolved by re-binding `services` once the Board exists.
	let services: ActionServices = { economy, rules, inventory };

	// 7. Board (SPEC-002): resolves tiles through the SAME runner; its Actions run
	//    against `services` (which by roll time includes the Board itself, so
	//    Teleport/MovePlayer Actions can drive it).
	const resolvedBoardRegistry =
		boardRegistry ?? createBoardRegistry({ seed: true });
	const boardDefinition = resolvedBoardRegistry.get(boardId ?? V1_BOARD_ID);
	if (!boardDefinition) {
		throw new Error(
			`[createTournamentEngines] unknown board "${boardId ?? V1_BOARD_ID}"`,
		);
	}
	const board = new TournamentBoard({
		tournamentId,
		definition: boardDefinition as BoardDefinition,
		participantIds,
		bus,
		clock,
		logger,
		actionRunner: actionRunner as TileActionRunner,
		makeContext: (input) => ({
			tournamentId,
			playerId: input.playerId,
			round: getRound(),
			tileId: input.tileId,
			eventBus: bus,
			services,
			clock,
		}),
		getRound,
	});

	// Random Events (SPEC-019): a per-tournament system that runs event Actions
	// through the SAME runner; the `randomEvent` tile Action triggers it.
	const randomEvents = new TournamentRandomEvents({
		tournamentId,
		seed,
		bus,
		clock,
		logger,
		actionRunner: actionRunner as RandomEventActionRunner,
		makeContext: (input) => ({
			tournamentId,
			playerId: input.playerId,
			round: input.round,
			eventBus: bus,
			services,
			clock,
		}),
		getRound,
	});

	// Steal (SPEC-006 AttemptStealAction): a per-tournament serializable seeded RNG
	// stream + the primitives the steal Action needs (eligible victims from the
	// roster ∩ Economy balances, a seeded pick, the StealPrevention Rule query).
	const rng = new TournamentRng(seed);
	const stealServices: StealServices = {
		candidates: (thiefId) =>
			participantIds.filter(
				(id) => id !== thiefId && (economy.getBalance(id) ?? 0) > 0,
			),
		pickIndex: (count) => rng.pickIndex(count),
		isProtected: (victimId) =>
			rules.isStealPrevented({
				tournamentId,
				round: getRound(),
				playerId: victimId,
				eventBus: bus,
			}),
	};

	// Re-bind so every context (Board tiles + `makeActionContext`) exposes the
	// Board (SPEC-006), Random Events (SPEC-019) and steal (SPEC-006) capabilities.
	services = { economy, rules, inventory, board, randomEvents, steal: stealServices };

	// 8. Turn System (SPEC-005): drives one turn at a time through the Dice + Board
	//    commands; the Runtime sequences players.
	const turnSystem = new TournamentTurnSystem({
		tournamentId,
		bus,
		clock,
		dice,
		board,
		turnTimeoutMs: settings.timeouts.turnSeconds * 1000,
		logger,
		getRound,
	});

	return {
		economy,
		rules,
		leaderboard,
		inventory,
		rewards,
		board,
		dice,
		turnSystem,
		randomEvents,
		actionEngine,
		actionFactory,
		services,
		makeActionContext: (input) => ({
			tournamentId,
			playerId: input.playerId,
			round: input.round ?? getRound(),
			tileId: input.tileId,
			eventBus: bus,
			services,
			clock,
			metadata: input.metadata,
		}),
		serialize: () => ({
			economy: economy.serialize(),
			rules: rules.serialize(),
			leaderboard: leaderboard.serialize(),
			inventory: inventory.serialize(),
			rewards: rewards.serialize(),
			board: board.serialize(),
			dice: dice.serialize(),
			turn: turnSystem.serialize(),
			randomEvents: randomEvents.serialize(),
			rng: rng.serialize(),
		}),
	};
}
