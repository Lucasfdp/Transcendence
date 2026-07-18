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
	registerKeyItemActions,
	registerShellActions,
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
import { TournamentShop } from "../shop/tournament-shop";
import { ShopPriceModifier, ShopSnapshot } from "../shop/shop.types";
import { TournamentKeyItems } from "../key-items/tournament-key-items";
import { createKeyItemRegistry } from "../key-items/key-item-registry";
import {
	KeyItemDefinition,
	KeyItemProgressionSnapshot,
} from "../key-items/key-item.types";
import {
	MinigameLaunchGateConfig,
	TieBreakGateConfig,
	TournamentMinigame,
} from "../minigame/tournament-minigame";
import {
	MinigameCatalogPort,
	MinigameLauncherPort,
	MinigameLifecyclePort,
	MinigameReconcilerPort,
	MinigameSnapshot,
} from "../minigame/minigame.types";
import { TournamentGambling } from "../gambling/tournament-gambling";
import { GamblingFairness, GamblingSnapshot } from "../gambling/gambling.types";
import { CASINO_GAMBLING_FAIRNESS } from "../gambling/gambling-fairness";
import { TournamentBoss } from "../boss/tournament-boss";
import { BossDefinition, BossSnapshot } from "../boss/boss.types";
import { TournamentShell } from "../final-challenge/tournament-shell";
import { TournamentFinalChallenge } from "../final-challenge/tournament-final-challenge";
import {
	FinalChallengeDefinition,
	FinalChallengeSnapshot,
	ShellSnapshot,
} from "../final-challenge/final-challenge.types";
import { createRule } from "../rules/configured-rule";
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
	/** Key Item content registry (defaults to the seeded v1 placeholders). */
	readonly keyItemRegistry?: Registry<KeyItemDefinition>;
	/** Boss content registry (defaults to the seeded v1 placeholder Boss). */
	readonly bossRegistry?: Registry<BossDefinition>;
	/** Final Challenge content registry (defaults to the seeded v1 sudden death). */
	readonly finalChallengeRegistry?: Registry<FinalChallengeDefinition>;
	/**
	 * Minigame platform ports (SPEC-015). Inert by default so a standalone
	 * tournament cleanly skips/cancels its minigame; the NestJS Runtime layer
	 * injects adapters over MatchFactoryService / MatchLifecycleEvents / the
	 * `matches` table.
	 */
	readonly minigameLauncher?: MinigameLauncherPort;
	readonly minigameLifecycle?: MinigameLifecyclePort;
	readonly minigameReconciler?: MinigameReconcilerPort;
	readonly minigameCatalog?: MinigameCatalogPort;
	/**
	 * Pre-launch "MINIGAME TIME!" confirmation gate (SPEC-015 v2). Absent ⇒
	 * matches launch immediately (Phase-1 behaviour, standalone tests).
	 */
	readonly minigameLaunchGate?: MinigameLaunchGateConfig;
	/**
	 * Tie-break audience gate (SPEC-015 v2): the roulette waits for every
	 * player's board before spinning. Absent ⇒ spin immediately.
	 */
	readonly minigameTieBreakGate?: TieBreakGateConfig;
	/**
	 * Provably-fair seam for Gambling (SPEC-016). Defaults to the existing
	 * casino's primitives; tests inject a deterministic stub.
	 */
	readonly gamblingFairness?: GamblingFairness;
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
	readonly shop: ShopSnapshot;
	readonly keyItems: KeyItemProgressionSnapshot;
	readonly minigame: MinigameSnapshot;
	readonly gambling: GamblingSnapshot;
	readonly boss: BossSnapshot;
	readonly shell: ShellSnapshot;
	readonly finalChallenge: FinalChallengeSnapshot;
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
	readonly shop: TournamentShop;
	readonly keyItems: TournamentKeyItems;
	readonly minigame: TournamentMinigame;
	readonly gambling: TournamentGambling;
	readonly boss: TournamentBoss;
	readonly shell: TournamentShell;
	readonly finalChallenge: TournamentFinalChallenge;
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
		keyItemRegistry,
		bossRegistry,
		finalChallengeRegistry,
		minigameLauncher,
		minigameLifecycle,
		minigameReconciler,
		minigameCatalog,
		gamblingFairness,
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
	registerKeyItemActions(actionRegistry);
	registerShellActions(actionRegistry);
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

	// Shop (SPEC-012): charges via Economy, delegates rewards to the Reward
	// Resolver, and prices through the Rule Engine price seam. Its reward runs
	// against the full `services` bundle (so an item reward reaches Inventory).
	const shopPriceModifier: ShopPriceModifier = {
		apply: ({ playerId, round, basePrice }) =>
			rules.queryPriceModifier(
				{ tournamentId, round, playerId, eventBus: bus },
				basePrice,
			),
	};
	const shop = new TournamentShop({
		tournamentId,
		bus,
		clock,
		logger,
		economy,
		rewardGranter: rewards,
		priceModifier: shopPriceModifier,
		makeContext: (input) => ({
			tournamentId,
			playerId: input.playerId,
			round: input.round,
			eventBus: bus,
			services,
			clock,
		}),
		shopTimeoutMs: settings.timeouts.shopInteractionSeconds * 1000,
		getRound,
	});

	// Key Item Progression (SPEC-017): the global match progress. The sole emitter
	// of KeyItemUnlocked/…; driven only by the Reward Resolver's `unlockKeyItem`
	// Action (a gambling win / shop purchase) through `services.keyItems`.
	const keyItems = new TournamentKeyItems({
		tournamentId,
		required: settings.keyItemsRequired,
		registry: keyItemRegistry ?? createKeyItemRegistry({ seed: true }),
		bus,
		clock,
		logger,
		getRound,
	});

	// Shell match state (SPEC-013 "ShellReward" / SPEC-021 "Recompensa"): THE ONE
	// Shell, granted only through the Reward Resolver's `grantShell` Action; the
	// holder enforces single-grant and emits ShellGranted.
	const shell = new TournamentShell({ tournamentId, bus, clock, logger, getRound });

	// Re-bind so every context (Board tiles + `makeActionContext`) exposes the
	// Board (SPEC-006), Random Events (SPEC-019), steal (SPEC-006), shop
	// (SPEC-012), Key Item (SPEC-017) and Shell (SPEC-021) capabilities.
	services = {
		economy,
		rules,
		inventory,
		board,
		randomEvents,
		steal: stealServices,
		shop: { open: (playerId, round) => shop.open(playerId, round) },
		keyItems: { unlock: (unlockedBy) => keyItems.unlock(unlockedBy) },
		shell: { grant: (winnerId) => shell.grant(winnerId) },
	};

	// Minigame Integration (SPEC-015): a pure consumer of the existing platform.
	// Outcome-point Rewards flow through the SAME Reward Resolver + context bundle;
	// the platform ports are inert here (a standalone tournament skips/cancels its
	// minigame) and injected with real adapters by the NestJS Runtime layer.
	const minigame = new TournamentMinigame({
		tournamentId,
		seed,
		bus,
		clock,
		logger,
		reward: settings.minigameReward,
		watchdogMs: settings.timeouts.minigameWatchdogMinutes * 60 * 1000,
		launcher: minigameLauncher,
		lifecycle: minigameLifecycle,
		reconciler: minigameReconciler,
		catalog: minigameCatalog,
		launchGate: options.minigameLaunchGate,
		tieBreakGate: options.minigameTieBreakGate,
		rewardGranter: rewards,
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

	// Gambling Integration (SPEC-016): the minigame winner bets Tournament POINTS
	// for a Key Item, resolved provably-fair (the casino primitives via the
	// fairness port). The win probability with pity is computed by the Runtime and
	// passed to `open`; the reward is a KeyItemReward through the same Resolver.
	const gambling = new TournamentGambling({
		tournamentId,
		bus,
		clock,
		logger,
		economy,
		rewardGranter: rewards,
		keyItems: { hasLockedRemaining: () => keyItems.hasLockedRemaining() },
		fairness: gamblingFairness ?? CASINO_GAMBLING_FAIRNESS,
		makeContext: (input) => ({
			tournamentId,
			playerId: input.playerId,
			round: input.round,
			eventBus: bus,
			services,
			clock,
		}),
		cost: settings.gambling.cost,
		decisionTimeoutMs: settings.timeouts.gamblingDecisionSeconds * 1000,
		getRound,
	});

	// Boss System (SPEC-020): a pure orchestrator that appears once every Key Item
	// is unlocked, alters the game ONLY by activating Rules through the Rule Engine
	// (register+activate a config, remove by id), plays its intro through the ONE
	// Action runner, and emits BossIntroCompleted to start the Final Challenge.
	const boss = new TournamentBoss({
		tournamentId,
		bus,
		clock,
		logger,
		keyItems: { isComplete: () => keyItems.isComplete() },
		ruleController: {
			activate: (config) =>
				rules.registerAndActivate(createRule(config), { round: getRound() })
					? config.id
					: null,
			remove: (ruleId) => {
				rules.remove(ruleId);
			},
		},
		registry: bossRegistry,
		introRunner: actionRunner,
		makeContext: (input) => ({
			tournamentId,
			playerId: 0,
			round: input.round,
			eventBus: bus,
			services,
			clock,
		}),
		getRound,
	});

	// Final Challenge (SPEC-021): the last phase, triggered by the Runtime on
	// BossIntroCompleted (the Boss carries WHICH challenge). v1 sudden death runs
	// EXACTLY the SPEC-015 pipeline; the Shell Reward flows through the SAME
	// Reward Resolver into the Shell holder; the ranking freezes via Leaderboard.
	// Active players default to the full roster here — the NestJS Runtime layer
	// narrows this to connected/non-abandoned players (Vertical Slice).
	const finalChallenge = new TournamentFinalChallenge({
		tournamentId,
		bus,
		clock,
		logger,
		minigame: { run: (playerIds, round) => minigame.run(playerIds, round) },
		rewardGranter: rewards,
		ranking: leaderboard,
		getActivePlayers: () => participantIds,
		challengeId: boss.getFinalChallengeId(),
		registry: finalChallengeRegistry,
		ruleController: {
			activate: (config) =>
				rules.registerAndActivate(createRule(config), { round: getRound() })
					? config.id
					: null,
			remove: (ruleId) => {
				rules.remove(ruleId);
			},
		},
		actionRunner,
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
		shop,
		keyItems,
		minigame,
		gambling,
		boss,
		shell,
		finalChallenge,
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
			shop: shop.serialize(),
			keyItems: keyItems.serialize(),
			minigame: minigame.serialize(),
			gambling: gambling.serialize(),
			boss: boss.serialize(),
			shell: shell.serialize(),
			finalChallenge: finalChallenge.serialize(),
		}),
	};
}
