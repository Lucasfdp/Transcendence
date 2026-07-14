import { Logger } from "@nestjs/common";
import { TournamentEventBus } from "../events/tournament-event-bus";
import { AnyTournamentEvent } from "../events/tournament-event.types";
import { ManualClock } from "../infra/clock";
import { TournamentLogger } from "../infra/tournament-logger";
import {
	BaseTournamentPhaseState,
	TournamentStateFactory,
	createPhaseState,
} from "./phase-states";
import {
	TOURNAMENT_PHASES,
	TournamentPhase,
	isLegalTransition,
	isTerminalPhase,
} from "./tournament-phase";
import { TournamentStateMachine } from "./tournament-state-machine";

const TOURNAMENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** CREATED → … → CHECK_KEY_ITEMS, walking the main-round edges. */
const PATH_TO_CHECK_KEY_ITEMS: readonly TournamentPhase[] = [
	"WAITING_PLAYERS",
	"INITIALIZING",
	"ROUND_START",
	"PLAYER_TURNS",
	"MINIGAME",
	"GAMBLING_PHASE",
	"CHECK_KEY_ITEMS",
];

/** CHECK_KEY_ITEMS → … → FINISHED via the VICTORY branch. */
const VICTORY_TAIL: readonly TournamentPhase[] = [
	"BOSS_EVENT",
	"FINAL_CHALLENGE",
	"VICTORY",
	"REWARDS",
	"FINISHED",
];

describe("TournamentStateMachine", () => {
	let clock: ManualClock;
	let bus: TournamentEventBus;
	let logger: TournamentLogger;
	let emitted: AnyTournamentEvent[];

	beforeEach(() => {
		jest.spyOn(Logger.prototype, "log").mockImplementation(
			() => undefined,
		);
		jest.spyOn(Logger.prototype, "warn").mockImplementation(
			() => undefined,
		);
		jest.spyOn(Logger.prototype, "error").mockImplementation(
			() => undefined,
		);
		clock = new ManualClock(1_000);
		bus = new TournamentEventBus();
		logger = new TournamentLogger({
			tournamentId: TOURNAMENT_ID,
			system: "StateMachine",
		});
		emitted = [];
		bus.onAny((event) => emitted.push(event));
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	function makeMachine(
		stateFactory?: TournamentStateFactory,
	): TournamentStateMachine {
		return new TournamentStateMachine(
			bus,
			clock,
			logger,
			TOURNAMENT_ID,
			stateFactory,
		);
	}

	function walk(
		machine: TournamentStateMachine,
		phases: readonly TournamentPhase[],
	): void {
		for (const phase of phases) {
			expect(machine.requestTransition(phase)).toBe(true);
			expect(machine.currentPhase).toBe(phase);
		}
	}

	function eventNames(): string[] {
		return emitted.map((event) => event.name);
	}

	describe("construction", () => {
		it("starts in CREATED with exactly one active state and emits StateEntered", () => {
			const machine = makeMachine();

			expect(machine.currentPhase).toBe("CREATED");
			expect(machine.isTerminal).toBe(false);
			expect(eventNames()).toEqual(["StateEntered"]);
			expect(emitted[0].payload).toEqual({ state: "CREATED" });
		});

		it("stamps events with the injected clock's time", () => {
			makeMachine();
			expect(emitted[0].timestamp).toBe(1_000);
		});
	});

	describe("canonical flow", () => {
		it("walks the full happy path to FINISHED via the VICTORY branch", () => {
			const machine = makeMachine();

			walk(machine, PATH_TO_CHECK_KEY_ITEMS);
			walk(machine, VICTORY_TAIL);

			expect(machine.currentPhase).toBe("FINISHED");
			expect(machine.isTerminal).toBe(true);
		});

		it("walks the DEFEAT branch: CHECK_KEY_ITEMS → DEFEAT → FINISHED", () => {
			const machine = makeMachine();

			walk(machine, PATH_TO_CHECK_KEY_ITEMS);
			walk(machine, ["DEFEAT", "FINISHED"]);

			expect(machine.isTerminal).toBe(true);
		});

		it("loops CHECK_KEY_ITEMS → ROUND_START for the next round", () => {
			const machine = makeMachine();

			walk(machine, PATH_TO_CHECK_KEY_ITEMS);
			walk(machine, ["ROUND_START", "PLAYER_TURNS"]);
		});

		it("takes the PLAYER_TURNS → CHECK_KEY_ITEMS shortcut (all key items mid-round)", () => {
			const machine = makeMachine();

			walk(machine, [
				"WAITING_PLAYERS",
				"INITIALIZING",
				"ROUND_START",
				"PLAYER_TURNS",
				"CHECK_KEY_ITEMS",
			]);
		});

		it("skips gambling: MINIGAME → CHECK_KEY_ITEMS (draw/cancelled/omitted)", () => {
			const machine = makeMachine();

			walk(machine, [
				"WAITING_PLAYERS",
				"INITIALIZING",
				"ROUND_START",
				"PLAYER_TURNS",
				"MINIGAME",
				"CHECK_KEY_ITEMS",
			]);
		});
	});

	describe("rejections", () => {
		it("rejects an illegal transition: state unchanged, TransitionFailed, no StateExited", () => {
			const machine = makeMachine();
			emitted = [];

			const accepted = machine.requestTransition("MINIGAME");

			expect(accepted).toBe(false);
			expect(machine.currentPhase).toBe("CREATED");
			expect(eventNames()).toEqual(["TransitionFailed"]);
			expect(emitted[0].payload).toEqual({
				from: "CREATED",
				to: "MINIGAME",
				reason: expect.stringContaining("canonical graph"),
			});
		});

		it("rejects requestTransition(CANCELLED): cancel() is the only path", () => {
			const machine = makeMachine();
			emitted = [];

			expect(machine.requestTransition("CANCELLED")).toBe(false);
			expect(machine.currentPhase).toBe("CREATED");
			expect(eventNames()).toEqual(["TransitionFailed"]);
		});

		it("rejects self-transitions (no phase has an edge to itself)", () => {
			const machine = makeMachine();
			walk(machine, ["WAITING_PLAYERS"]);
			emitted = [];

			expect(machine.requestTransition("WAITING_PLAYERS")).toBe(false);
			expect(machine.currentPhase).toBe("WAITING_PLAYERS");
		});

		it("rejects when the active state vetoes even a legal edge", () => {
			class VetoState extends BaseTournamentPhaseState {
				canTransition(): boolean {
					return false;
				}
			}
			const machine = makeMachine((phase) => new VetoState(phase));
			emitted = [];

			expect(machine.requestTransition("WAITING_PLAYERS")).toBe(false);
			expect(machine.currentPhase).toBe("CREATED");
			expect(eventNames()).toEqual(["TransitionFailed"]);
		});
	});

	describe("cancellation", () => {
		it.each([
			["CREATED", []],
			["INITIALIZING", ["WAITING_PLAYERS", "INITIALIZING"]],
			["GAMBLING_PHASE", PATH_TO_CHECK_KEY_ITEMS.slice(0, 6)],
			["VICTORY", [...PATH_TO_CHECK_KEY_ITEMS, ...VICTORY_TAIL.slice(0, 3)]],
		] as [TournamentPhase, TournamentPhase[]][])(
			"cancel() reaches CANCELLED from %s",
			(from, path) => {
				const machine = makeMachine();
				walk(machine, path);
				expect(machine.currentPhase).toBe(from);

				expect(machine.cancel("admin request")).toBe(true);
				expect(machine.currentPhase).toBe("CANCELLED");
				expect(machine.isTerminal).toBe(true);
			},
		);

		it("rejects cancel() from FINISHED (terminal)", () => {
			const machine = makeMachine();
			walk(machine, PATH_TO_CHECK_KEY_ITEMS);
			walk(machine, VICTORY_TAIL);
			emitted = [];

			expect(machine.cancel("too late")).toBe(false);
			expect(machine.currentPhase).toBe("FINISHED");
			expect(eventNames()).toEqual(["TransitionFailed"]);
		});

		it("rejects any transition from CANCELLED (terminal)", () => {
			const machine = makeMachine();
			machine.cancel("server restart");
			emitted = [];

			expect(machine.requestTransition("WAITING_PLAYERS")).toBe(false);
			expect(machine.cancel("again")).toBe(false);
			expect(machine.currentPhase).toBe("CANCELLED");
			expect(eventNames()).toEqual([
				"TransitionFailed",
				"TransitionFailed",
			]);
		});
	});

	describe("invariants", () => {
		it("holds exactly one active state through the whole happy path", () => {
			let active = 0;
			let maxActive = 0;
			class CountingState extends BaseTournamentPhaseState {
				onEnter(): void {
					active++;
					maxActive = Math.max(maxActive, active);
				}
				onExit(): void {
					active--;
				}
			}
			const machine = makeMachine((phase) => new CountingState(phase));
			expect(active).toBe(1);

			walk(machine, PATH_TO_CHECK_KEY_ITEMS);
			walk(machine, VICTORY_TAIL);

			expect(active).toBe(1);
			expect(maxActive).toBe(1);
		});

		it("emits the contractual event order on one transition", () => {
			const machine = makeMachine();
			emitted = [];

			machine.requestTransition("WAITING_PLAYERS");

			expect(eventNames()).toEqual([
				"TransitionStarted",
				"StateExited",
				"StateEntered",
				"TransitionCompleted",
			]);
			expect(emitted[0].payload).toEqual({
				from: "CREATED",
				to: "WAITING_PLAYERS",
			});
			expect(emitted[1].payload).toEqual({ state: "CREATED" });
			expect(emitted[2].payload).toEqual({ state: "WAITING_PLAYERS" });
			expect(emitted[3].payload).toEqual({
				from: "CREATED",
				to: "WAITING_PLAYERS",
			});
		});

		it("rejects re-entrant transition requests fired from a bus listener", () => {
			const machine = makeMachine();
			const nested: boolean[] = [];
			bus.on("StateExited", () => {
				nested.push(machine.requestTransition("INITIALIZING"));
			});

			expect(machine.requestTransition("WAITING_PLAYERS")).toBe(true);

			// StateExited is dispatched synchronously mid-transition, so the
			// nested request hits the in-progress guard and is rejected; the
			// outer transition completes untouched.
			expect(nested).toEqual([false]);
			expect(machine.currentPhase).toBe("WAITING_PLAYERS");
			expect(eventNames()).toContain("TransitionFailed");
		});
	});

	describe("declarative graph", () => {
		it("allows CANCELLED from every non-terminal phase and from no terminal one", () => {
			for (const phase of TOURNAMENT_PHASES) {
				expect(isLegalTransition(phase, "CANCELLED")).toBe(
					!isTerminalPhase(phase),
				);
			}
		});

		it("gives terminal phases no outgoing edges at all", () => {
			for (const from of ["FINISHED", "CANCELLED"] as const) {
				for (const to of TOURNAMENT_PHASES) {
					expect(isLegalTransition(from, to)).toBe(false);
				}
			}
		});
	});

	describe("persistence", () => {
		it("serializes phase, round, active player, remaining time and temp vars", () => {
			const machine = makeMachine();
			walk(machine, PATH_TO_CHECK_KEY_ITEMS.slice(0, 4));
			machine.setRound(3);
			machine.setActivePlayer(42);
			machine.setTempVariable("pityCounter", 2);
			machine.setTempVariable("lastWinner", null);

			expect(machine.serialize()).toEqual({
				phase: "PLAYER_TURNS",
				remainingTimeMs: null,
				activePlayerId: 42,
				round: 3,
				tempVariables: { pityCounter: 2, lastWinner: null },
			});
		});

		it("returns a defensive copy of temp variables", () => {
			const machine = makeMachine();
			machine.setTempVariable("a", 1);

			const snapshot = machine.serialize();
			snapshot.tempVariables.a = 999;

			expect(machine.serialize().tempVariables.a).toBe(1);
		});

		it("roundtrips through restoreFrom and keeps transitioning legally", () => {
			const machine = makeMachine();
			walk(machine, PATH_TO_CHECK_KEY_ITEMS);
			machine.setRound(5);
			machine.setActivePlayer(7);
			machine.setTempVariable("keyItems", 2);
			const snapshot = machine.serialize();

			emitted = [];
			const restored = TournamentStateMachine.restoreFrom(
				snapshot,
				bus,
				clock,
				logger,
				TOURNAMENT_ID,
			);

			// Restore is a resumption, not a new entry: no events replayed.
			expect(emitted).toEqual([]);
			expect(restored.currentPhase).toBe("CHECK_KEY_ITEMS");
			expect(restored.serialize()).toEqual(snapshot);

			// The restored machine enforces the same graph.
			expect(restored.requestTransition("VICTORY")).toBe(false);
			expect(restored.requestTransition("BOSS_EVENT")).toBe(true);
			expect(restored.currentPhase).toBe("BOSS_EVENT");
		});

		it("restored events carry the restored round in their envelope", () => {
			const machine = makeMachine();
			walk(machine, PATH_TO_CHECK_KEY_ITEMS);
			machine.setRound(5);
			const restored = TournamentStateMachine.restoreFrom(
				machine.serialize(),
				bus,
				clock,
				logger,
				TOURNAMENT_ID,
			);

			emitted = [];
			restored.requestTransition("ROUND_START");

			expect(emitted).toHaveLength(4);
			for (const event of emitted) {
				expect(event.round).toBe(5);
			}
		});
	});

	describe("shells", () => {
		it("update() delegates to the active state", () => {
			const updated: TournamentPhase[] = [];
			class TrackingState extends BaseTournamentPhaseState {
				update(): void {
					updated.push(this.phase);
				}
			}
			const machine = makeMachine((phase) => new TrackingState(phase));

			machine.update();
			machine.requestTransition("WAITING_PLAYERS");
			machine.update();

			expect(updated).toEqual(["CREATED", "WAITING_PLAYERS"]);
		});

		it("default shells request no transition on their own", () => {
			for (const phase of TOURNAMENT_PHASES) {
				expect(createPhaseState(phase).nextState()).toBeNull();
			}
		});
	});
});
