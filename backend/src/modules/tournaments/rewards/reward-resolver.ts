/**
 * reward-resolver.ts — Tournament Reward Resolver (SPEC-013).
 *
 * ONE INSTANCE PER TOURNAMENT. The single system authorised to turn an abstract
 * `Reward` into real effects (SPEC-013 "Objetivo"): every system that hands out
 * a reward delegates here, and NONE grants directly. Its ONLY job is to
 * TRANSLATE `type + payload` into `ActionConfig[]` and DELEGATE execution to the
 * Action Engine through the `RewardActionRunner` port — it NEVER implements
 * behaviour (SPEC-013 "Integración con Action Engine": "Solo traduce.").
 *
 * It knows nothing of UI, Networking, Base de Datos or Frontend (SPEC-013
 * "Restricciones"): it imports ONLY the public Action Engine TYPES and runs
 * configs through the injected port, never the concrete engine. Per-tournament,
 * in-memory, deterministic (SPEC-028): no `Math.random`, no `Date.now` —
 * timestamps come only from the injected `TournamentClock`; the only randomness
 * is `randomUUID` for event identity via `createTournamentEvent`.
 *
 * Pattern mirrors `tournament-inventory.ts`: an options-object constructor, a
 * no-op default runner so the Resolver is standalone-testable, emission via
 * `createTournamentEvent(...)` cast to `AnyTournamentEvent`, and a JSON-safe
 * `serialize()`. No public method ever throws.
 */

import {
	ActionConfig,
	ActionContext,
	ExecutionResult,
} from "../actions/action.interface";
import { TournamentEventBus } from "../events/tournament-event-bus";
import {
	AnyTournamentEvent,
	RewardActionStatus,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { TournamentClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import { Registry } from "../registry/registry";
import { createRewardRegistry } from "./reward-registry";
import {
	applyRewardConditions,
	createRewardTranslators,
	readCompositeChildren,
	translateReward,
} from "./reward-translators";
import {
	GrantRewardResult,
	Reward,
	RewardActionRunner,
	RewardDefinition,
	RewardResolverSnapshot,
	RewardTranslatorMap,
	isReward,
	isRewardType,
} from "./reward.types";

export interface TournamentRewardResolverOptions {
	readonly tournamentId: string;
	readonly bus: TournamentEventBus;
	readonly clock: TournamentClock;
	/** Reward definition registry for `grantById` (empty when omitted). */
	readonly registry?: Registry<RewardDefinition>;
	/** Translation map (defaults to the standard per-type translators). */
	readonly translators?: RewardTranslatorMap;
	/**
	 * Execution seam (SPEC-013 "Arquitectura": Reward Resolver → Action Engine).
	 * The real runner (ActionFactory + ActionEngine) is injected by the architect;
	 * a no-op runner is used when omitted so the Resolver stays standalone.
	 */
	readonly actionRunner?: RewardActionRunner;
	readonly logger?: TournamentLogger;
	/** Current tournament round for event envelopes; 0 when omitted. */
	readonly getRound?: () => number;
}

/**
 * Default runner used when no Action Engine is injected (v1 standalone): runs
 * nothing and returns no results (SPEC-013: the Resolver never executes
 * behaviour itself).
 */
const NOOP_ACTION_RUNNER: RewardActionRunner = {
	run: () => [],
};

export class TournamentRewardResolver {
	private readonly tournamentId: string;
	private readonly bus: TournamentEventBus;
	private readonly clock: TournamentClock;
	private readonly registry: Registry<RewardDefinition>;
	private readonly translators: RewardTranslatorMap;
	private readonly actionRunner: RewardActionRunner;
	private readonly logger: TournamentLogger;
	private readonly getRound: () => number;

	constructor(options: TournamentRewardResolverOptions) {
		this.tournamentId = options.tournamentId;
		this.bus = options.bus;
		this.clock = options.clock;
		this.registry = options.registry ?? createRewardRegistry();
		this.translators = options.translators ?? createRewardTranslators();
		this.actionRunner = options.actionRunner ?? NOOP_ACTION_RUNNER;
		this.logger =
			options.logger?.child("RewardResolver") ??
			new TournamentLogger({
				tournamentId: this.tournamentId,
				system: "RewardResolver",
			});
		this.getRound = options.getRound ?? (() => 0);
	}

	// ── Grant (SPEC-013 "Pipeline": Validate → Resolve → Execute → Emit → Finish) ─

	/**
	 * Resolves a Reward end-to-end (SPEC-013 "Pipeline"). Validates the Reward,
	 * emits RewardGranted, translates `type + payload` to `ActionConfig[]`, runs
	 * them through the injected Action Engine port, and emits RewardResolved. A
	 * composite additionally emits CompositeRewardStarted/Finished around its
	 * children. Never throws (any unexpected error becomes an `invalid_config`
	 * rejection — SPEC-013 aligns with SPEC-008 "Error interno → Log → Continuar").
	 */
	grant(reward: Reward, context: ActionContext): GrantRewardResult {
		try {
			return this.grantInternal(reward, context);
		} catch (error) {
			const rewardId =
				typeof reward?.id === "string" ? reward.id : "";
			this.logger.error("unexpected error during grant; rejected", {
				metadata: {
					rewardId,
					error: error instanceof Error ? error.message : String(error),
				},
			});
			return { status: "rejected", rewardId, reason: "invalid_config" };
		}
	}

	/**
	 * Looks a Reward up in the registry and grants it (SPEC-013 "Reward":
	 * definitions referenced by id). An unknown id is a logged `invalid_config`
	 * rejection, never a throw.
	 */
	grantById(rewardId: string, context: ActionContext): GrantRewardResult {
		const reward = this.registry.get(rewardId);
		if (!reward) {
			this.logger.warn("grantById for unknown reward id rejected", {
				metadata: { rewardId },
			});
			return { status: "rejected", rewardId, reason: "invalid_config" };
		}
		return this.grant(reward, context);
	}

	/** JSON-safe snapshot (SPEC-013): the Resolver is largely stateless. */
	serialize(): RewardResolverSnapshot {
		return {
			tournamentId: this.tournamentId,
			rewardCount: this.registry.getAll().length,
		};
	}

	// ── Internals ────────────────────────────────────────────────────────────

	private grantInternal(
		reward: Reward,
		context: ActionContext,
	): GrantRewardResult {
		const rewardId = typeof reward?.id === "string" ? reward.id : "";
		const rawType = (reward as { type?: unknown })?.type;

		// Validate (SPEC-013 "Validación"): known type, then a well-formed id.
		if (!isRewardType(rawType)) {
			// Reward desconocida → Registrar error → Cancelar (SPEC-013 "Casos límite").
			this.emit("RewardRejected", context.playerId, {
				rewardId,
				type: String(rawType),
				reason: "unknown_type",
			});
			this.logger.error("reward with unknown type rejected", {
				metadata: { rewardId, type: String(rawType) },
			});
			return { status: "rejected", rewardId, reason: "unknown_type" };
		}
		if (!isReward(reward)) {
			// Known type but a missing/blank id → malformed configuration.
			this.emit("RewardRejected", context.playerId, {
				rewardId,
				type: rawType,
				reason: "invalid_config",
			});
			this.logger.error("reward with a missing/blank id rejected", {
				metadata: { type: rawType },
			});
			return { status: "rejected", rewardId, reason: "invalid_config" };
		}

		// Malformed composite payload (rewards not an array) → invalid_config.
		if (reward.type === "composite" && !this.hasRewardArray(reward)) {
			this.emit("RewardRejected", context.playerId, {
				rewardId,
				type: reward.type,
				reason: "invalid_config",
			});
			this.logger.error("composite reward with no rewards[] payload rejected", {
				metadata: { rewardId },
			});
			return { status: "rejected", rewardId, reason: "invalid_config" };
		}

		// Emit RewardGranted at the start of a valid grant (SPEC-013 "Eventos").
		this.emit("RewardGranted", context.playerId, {
			rewardId,
			type: reward.type,
		});

		if (reward.type === "composite") {
			return this.grantComposite(reward, rewardId, context);
		}
		return this.grantLeaf(reward, rewardId, context);
	}

	/**
	 * Non-composite grant: translate → (no_actions guard) → execute → resolved.
	 * `future` translating to `[]` is a legitimate resolved no-op, never
	 * `no_actions` (SPEC-013 "FutureReward").
	 */
	private grantLeaf(
		reward: Reward,
		rewardId: string,
		context: ActionContext,
	): GrantRewardResult {
		const configs = translateReward(reward, this.translators);
		if (reward.type !== "future" && configs.length === 0) {
			// Nothing to do (SPEC-013 "Validación": Configuración correcta).
			this.emit("RewardRejected", context.playerId, {
				rewardId,
				type: reward.type,
				reason: "no_actions",
			});
			this.logger.warn("reward translated to zero actions; rejected", {
				metadata: { rewardId, type: reward.type },
			});
			return { status: "rejected", rewardId, reason: "no_actions" };
		}

		const results = this.runConfigs(configs, context);
		this.emitResolved(reward.type, rewardId, context.playerId, results);
		return { status: "resolved", rewardId, results };
	}

	/**
	 * Composite grant (SPEC-013 "Composite Reward"): emit CompositeRewardStarted,
	 * flatten each VALID child (invalid children skipped + warned — SPEC-013
	 * "Reward parcialmente inválida": ejecutar únicamente las válidas), emit
	 * CompositeRewardFinished with the resolved-child count, run the flattened
	 * configs, then emit RewardResolved. The composite's own `conditions`
	 * propagate onto every child's leaf configs (on top of each child's own).
	 */
	private grantComposite(
		reward: Reward,
		rewardId: string,
		context: ActionContext,
	): GrantRewardResult {
		const children = readCompositeChildren(reward);
		this.emit("CompositeRewardStarted", context.playerId, {
			rewardId,
			childCount: children.length,
		});

		const configs: ActionConfig[] = [];
		let resolvedCount = 0;
		for (const child of children) {
			if (!isReward(child)) {
				this.logger.warn("composite child skipped: not a valid reward", {
					metadata: { rewardId },
				});
				continue;
			}
			const childConfigs = applyRewardConditions(
				translateReward(child, this.translators),
				reward.conditions,
			);
			configs.push(...childConfigs);
			resolvedCount += 1;
		}
		if (resolvedCount < children.length) {
			this.logger.warn(
				"composite reward partially invalid; resolving only the valid children",
				{ metadata: { rewardId, childCount: children.length, resolvedCount } },
			);
		}

		this.emit("CompositeRewardFinished", context.playerId, {
			rewardId,
			resolvedCount,
		});

		const results = this.runConfigs(configs, context);
		this.emitResolved(reward.type, rewardId, context.playerId, results);
		return { status: "resolved", rewardId, results };
	}

	/**
	 * Runs the translated configs through the Action Engine port. The runner must
	 * never throw (SPEC-008 "Error interno → Log → Continuar"); if it does, the
	 * grant treats it as empty results and keeps going.
	 */
	private runConfigs(
		configs: readonly ActionConfig[],
		context: ActionContext,
	): ExecutionResult[] {
		try {
			return this.actionRunner.run(configs, context);
		} catch (error) {
			this.logger.error("action runner threw during grant; treated as no results", {
				metadata: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
			return [];
		}
	}

	private emitResolved(
		type: string,
		rewardId: string,
		playerId: number | null,
		results: readonly ExecutionResult[],
	): void {
		this.emit("RewardResolved", playerId, {
			rewardId,
			type,
			actionStatuses: results.map(
				(result) => result.status as RewardActionStatus,
			),
		});
	}

	private hasRewardArray(reward: Reward): boolean {
		const rewards = (reward.payload as { rewards?: unknown } | undefined)?.rewards;
		return Array.isArray(rewards);
	}

	private emit<TName extends TournamentEventName>(
		name: TName,
		playerId: number | null,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: this.tournamentId,
			round: this.getRound(),
			playerId,
			payload,
			timestamp: this.clock.now(),
		});
		this.bus.emit(event as AnyTournamentEvent);
	}
}
