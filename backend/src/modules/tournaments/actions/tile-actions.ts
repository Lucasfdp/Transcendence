/**
 * tile-actions.ts — the Board-driving + placeholder Tile Actions (SPEC-006).
 *
 * Tile Actions are ordinary `IAction`s (SPEC-006 "Definición de una Action":
 * "No existe una interfaz específica para Tile Actions. Toda Action implementa
 * IAction, definida en SPEC-008, y vive en el ActionRegistry"). This file adds
 * the F3 subset — the ones a v1 board tile needs — on top of the economy/rule/
 * composite base Actions:
 *   - `nothing`    → NothingAction: does absolutely nothing (SPEC-006 "NothingAction",
 *                    a placeholder tile Action; used by empty tiles in the catalog).
 *   - `teleport`   → TeleportAction: drives `Board.teleportPlayer` (SPEC-006).
 *   - `movePlayer` → MovePlayerAction: drives `Board.movePlayer` (SPEC-006).
 *
 * The Steal / OpenShop / RandomEvent Tile Actions belong to later content phases
 * (F6) and the presentation Actions (PlayAnimation/PlaySound/DisplayMessage) to
 * the frontend phase (F7); they are intentionally NOT added here.
 *
 * Each Action drives the Board ONLY through the `ctx.services.board` capability
 * port (SPEC-006 "Action Context": no direct Runtime/Board reference); the Board
 * emits the movement facts (PlayerMoved/TileResolved/…), never the Action. When
 * no Board is wired the Action is `skipped` (benign no-op) so it can never crash
 * a turn (SPEC-006 "Casos límite": nunca detener el turno).
 */

import {
	AnyTournamentEvent,
	TournamentEventName,
	TournamentEventPayloadMap,
	createTournamentEvent,
} from "../events/tournament-event.types";
import { ActionBuildContext, ActionRegistry } from "./action-registry";
import {
	ActionContext,
	ExecutionOutcome,
	ExecutionResult,
	failedResult,
	skippedResult,
	successResult,
} from "./action.interface";
import { BaseAction } from "./base-actions";

const readNumber = (
	parameters: Readonly<Record<string, unknown>>,
	key: string,
): number | undefined => {
	const value = parameters[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const readString = (
	parameters: Readonly<Record<string, unknown>>,
	key: string,
): string | undefined => {
	const value = parameters[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
};

/**
 * NothingAction (SPEC-006 "NothingAction"): does absolutely nothing. Used as a
 * placeholder tile Action so an "empty" tile still resolves cleanly to `success`
 * rather than skipping an unregistered type.
 */
export class NothingAction extends BaseAction {
	constructor(build: ActionBuildContext) {
		super(build);
	}

	execute(_ctx: ActionContext): ExecutionResult {
		return successResult();
	}
}

/**
 * TeleportAction (SPEC-006 "TeleportAction"): relocates the acting player to a
 * configured destination tile via `Board.teleportPlayer` (a command). Subject to
 * the Board's forced-relocation anti-loop limit (SPEC-002). Result mirrors the
 * command: a rejected relocation ⇒ `failed`.
 *
 * Config: `{ tileId: string, playerId?: number }` — `playerId` defaults to the
 * acting player.
 */
export class TeleportAction extends BaseAction {
	private readonly tileId?: string;
	private readonly explicitPlayerId?: number;

	constructor(build: ActionBuildContext) {
		super(build);
		this.tileId = readString(build.parameters, "tileId");
		this.explicitPlayerId = readNumber(build.parameters, "playerId");
	}

	validate(): ExecutionOutcome {
		if (this.tileId === undefined) {
			return failedResult("teleport requires a non-empty `tileId`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const board = ctx.services.board;
		if (!board) {
			return skippedResult("teleport: no board service in context");
		}
		const playerId = this.explicitPlayerId ?? ctx.playerId;
		const result = board.teleportPlayer(playerId, this.tileId as string);
		return result.status === "moved"
			? successResult({ tileId: this.tileId })
			: failedResult(`board rejected teleport to "${this.tileId}"`, undefined, {
					tileId: this.tileId,
			  });
	}
}

/**
 * MovePlayerAction (SPEC-006 "MovePlayerAction"): moves the acting player a
 * configured number of steps (positive or negative) via `Board.movePlayer` (a
 * command). Counts as a forced relocation (SPEC-002 anti-loop). Result mirrors
 * the command.
 *
 * Config: `{ steps: number, playerId?: number }`.
 */
export class MovePlayerAction extends BaseAction {
	private readonly steps?: number;
	private readonly explicitPlayerId?: number;

	constructor(build: ActionBuildContext) {
		super(build);
		this.steps = readNumber(build.parameters, "steps");
		this.explicitPlayerId = readNumber(build.parameters, "playerId");
	}

	validate(): ExecutionOutcome {
		if (this.steps === undefined) {
			return failedResult("movePlayer requires a numeric `steps`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const board = ctx.services.board;
		if (!board) {
			return skippedResult("movePlayer: no board service in context");
		}
		const playerId = this.explicitPlayerId ?? ctx.playerId;
		const result = board.movePlayer(playerId, this.steps as number);
		return result.status === "moved"
			? successResult({ steps: this.steps })
			: failedResult(`board rejected movePlayer(${this.steps})`, undefined, {
					steps: this.steps,
			  });
	}
}

/**
 * RandomEventAction (SPEC-006 "RandomEventAction" / SPEC-019): requests a random
 * event for the acting player via `ctx.services.randomEvents.trigger` (a
 * command). The Random Events System owns selection + execution and emits the
 * facts; the Action never decides the event (SPEC-006: "Nunca decide el
 * evento."). Skips (benign) when no Random Events service is wired.
 */
export class RandomEventAction extends BaseAction {
	constructor(build: ActionBuildContext) {
		super(build);
	}

	execute(ctx: ActionContext): ExecutionResult {
		const randomEvents = ctx.services.randomEvents;
		if (!randomEvents) {
			return skippedResult("randomEvent: no random-events service in context");
		}
		randomEvents.trigger(ctx.playerId, ctx.round);
		return successResult();
	}
}

/**
 * AttemptStealAction (SPEC-006 "AttemptStealAction", v1 resolution per SPEC-040):
 *   1. Emit StealStarted.
 *   2. Pick a victim: another player with points > 0, chosen with the tournament
 *      seed (via `services.steal.candidates` + `pickIndex`). None → StealFailed.
 *   3. Consult the StealPrevention Rule (`services.steal.isProtected`): protected
 *      → StealFailed (the protecting Item is consumed by its own Rule config).
 *   4. Request `economy.transfer(victim → thief)` for the configured amount.
 *   5. Economy emits PointsTransferred; the Action emits StealSucceeded.
 * The Action NEVER modifies Wallets directly — always via Economy. It emits its
 * OWN Steal* facts (no owner system) using `ctx.clock` (SPEC-028). Skips when no
 * steal service is wired.
 *
 * Config: `{ amount: number }` (v1 fixed, from SPEC-024 stealAmount).
 */
export class AttemptStealAction extends BaseAction {
	private readonly amount?: number;

	constructor(build: ActionBuildContext) {
		super(build);
		this.amount = readNumber(build.parameters, "amount");
	}

	validate(): ExecutionOutcome {
		if (this.amount === undefined || this.amount <= 0) {
			return failedResult("attemptSteal requires a positive numeric `amount`");
		}
		return successResult();
	}

	execute(ctx: ActionContext): ExecutionResult {
		const steal = ctx.services.steal;
		if (!steal) {
			return skippedResult("attemptSteal: no steal service in context");
		}
		const amount = this.amount as number;
		const thiefId = ctx.playerId;
		this.emit(ctx, "StealStarted", thiefId, { amount });

		const candidates = steal.candidates(thiefId);
		if (candidates.length === 0) {
			this.emit(ctx, "StealFailed", thiefId, { reason: "no_victim" });
			return skippedResult("attemptSteal: no eligible victim");
		}

		const victimId = candidates[steal.pickIndex(candidates.length)];
		if (steal.isProtected(victimId)) {
			this.emit(ctx, "StealFailed", thiefId, { reason: "prevented", victimId });
			return skippedResult("attemptSteal: victim protected");
		}

		const result = ctx.services.economy.transfer(
			victimId,
			thiefId,
			amount,
			"action:attemptSteal",
			"steal",
		);
		if (result.status !== "success") {
			this.emit(ctx, "StealFailed", thiefId, { reason: "rejected", victimId });
			return failedResult(`economy rejected steal: ${result.rejection}`, undefined, {
				victimId,
			});
		}
		this.emit(ctx, "StealSucceeded", thiefId, { victimId, amount });
		return successResult({ victimId, amount });
	}

	/** Emits one of this Action's OWN facts with the context clock (SPEC-028). */
	private emit<TName extends TournamentEventName>(
		ctx: ActionContext,
		name: TName,
		playerId: number,
		payload: TournamentEventPayloadMap[TName],
	): void {
		const event = createTournamentEvent({
			name,
			tournamentId: ctx.tournamentId,
			round: ctx.round,
			playerId,
			payload,
			timestamp: ctx.clock?.now() ?? 0,
		});
		ctx.eventBus.emit(event as AnyTournamentEvent);
	}
}

/**
 * Registers the Tile Actions (SPEC-006). Kept SEPARATE from the economy/rule
 * base set (`registerBaseActions`) and the inventory set: these are only
 * registered in the engine composition where the Board / Random Events / steal
 * services are wired into `ctx.services`.
 */
export function registerTileActions(registry: ActionRegistry): void {
	registry.register("nothing", (build) => new NothingAction(build));
	registry.register("teleport", (build) => new TeleportAction(build));
	registry.register("movePlayer", (build) => new MovePlayerAction(build));
	registry.register("randomEvent", (build) => new RandomEventAction(build));
	registry.register("attemptSteal", (build) => new AttemptStealAction(build));
}
