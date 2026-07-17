import { Logger } from "@nestjs/common";
import { TournamentLogger } from "./tournament-logger";

describe("TournamentLogger", () => {
	const context = {
		tournamentId: "tour-1",
		matchId: "match-9",
		system: "Runtime",
	};

	let verboseSpy: jest.SpyInstance;
	let debugSpy: jest.SpyInstance;
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;
	let fatalSpy: jest.SpyInstance;

	beforeEach(() => {
		verboseSpy = jest
			.spyOn(Logger.prototype, "verbose")
			.mockImplementation(() => undefined);
		debugSpy = jest
			.spyOn(Logger.prototype, "debug")
			.mockImplementation(() => undefined);
		logSpy = jest
			.spyOn(Logger.prototype, "log")
			.mockImplementation(() => undefined);
		warnSpy = jest
			.spyOn(Logger.prototype, "warn")
			.mockImplementation(() => undefined);
		errorSpy = jest
			.spyOn(Logger.prototype, "error")
			.mockImplementation(() => undefined);
		fatalSpy = jest
			.spyOn(Logger.prototype, "fatal")
			.mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	function lastLine(spy: jest.SpyInstance): string {
		expect(spy).toHaveBeenCalledTimes(1);
		return spy.mock.calls[0][0] as string;
	}

	function jsonSuffix(line: string): Record<string, unknown> {
		const separator = line.indexOf(" | ");
		expect(separator).toBeGreaterThan(-1);
		const suffix = line.slice(separator + 3);
		expect(suffix).not.toContain("\n");
		return JSON.parse(suffix) as Record<string, unknown>;
	}

	it("includes tournamentId, matchId and system on every line", () => {
		const logger = new TournamentLogger(context);
		logger.log("turn started");

		const line = lastLine(logSpy);
		expect(line.startsWith("turn started | ")).toBe(true);
		expect(jsonSuffix(line)).toEqual({
			tournamentId: "tour-1",
			matchId: "match-9",
			system: "Runtime",
		});
	});

	it("routes each level to the matching Nest Logger method", () => {
		const logger = new TournamentLogger(context);

		logger.verbose("trace msg");
		logger.debug("debug msg");
		logger.log("info msg");
		logger.warn("warn msg");
		logger.error("error msg");
		logger.fatal("fatal msg");

		expect(lastLine(verboseSpy)).toContain("trace msg");
		expect(lastLine(debugSpy)).toContain("debug msg");
		expect(lastLine(logSpy)).toContain("info msg");
		expect(lastLine(warnSpy)).toContain("warn msg");
		expect(lastLine(errorSpy)).toContain("error msg");
		expect(lastLine(fatalSpy)).toContain("fatal msg");
	});

	it("routes error({ fatal: true }) to the fatal level", () => {
		const logger = new TournamentLogger(context);

		logger.error("cannot continue", { fatal: true });

		expect(errorSpy).not.toHaveBeenCalled();
		expect(lastLine(fatalSpy)).toContain("cannot continue");
	});

	it("serializes per-call playerId and metadata", () => {
		const logger = new TournamentLogger(context);

		logger.warn("intent rejected", {
			playerId: "player-3",
			metadata: { intent: "MOVE", reason: "not your turn" },
		});

		expect(jsonSuffix(lastLine(warnSpy))).toEqual({
			tournamentId: "tour-1",
			matchId: "match-9",
			system: "Runtime",
			playerId: "player-3",
			metadata: { intent: "MOVE", reason: "not your turn" },
		});
	});

	it("omits matchId, playerId and metadata when absent", () => {
		const logger = new TournamentLogger({
			tournamentId: "tour-1",
			system: "Lobby",
		});

		logger.log("lobby open");

		expect(jsonSuffix(lastLine(logSpy))).toEqual({
			tournamentId: "tour-1",
			system: "Lobby",
		});
	});

	it("child() keeps the tournament context and swaps the system tag", () => {
		const logger = new TournamentLogger(context);
		const child = logger.child("Economy");

		child.log("reward granted", { playerId: "player-7" });

		expect(jsonSuffix(lastLine(logSpy))).toEqual({
			tournamentId: "tour-1",
			matchId: "match-9",
			system: "Economy",
			playerId: "player-7",
		});
	});
});
