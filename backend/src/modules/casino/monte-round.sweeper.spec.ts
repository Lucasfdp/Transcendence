import { MONTE_SWEEP_INTERVAL_MS } from "./monte-round.constants";
import type { MonteRoundService } from "./monte-round.service";
import { MonteRoundSweeper } from "./monte-round.sweeper";

describe("MonteRoundSweeper", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it("sweeps on an interval and stops after destroy", async () => {
		jest.useFakeTimers();
		const rounds = {
			expireStaleRounds: jest.fn().mockResolvedValue(0),
		} as unknown as MonteRoundService;
		const sweeper = new MonteRoundSweeper(rounds);

		sweeper.onModuleInit();
		expect(rounds.expireStaleRounds).not.toHaveBeenCalled();

		jest.advanceTimersByTime(MONTE_SWEEP_INTERVAL_MS);
		expect(rounds.expireStaleRounds).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(MONTE_SWEEP_INTERVAL_MS);
		expect(rounds.expireStaleRounds).toHaveBeenCalledTimes(2);

		sweeper.onModuleDestroy();
		jest.advanceTimersByTime(MONTE_SWEEP_INTERVAL_MS * 3);
		expect(rounds.expireStaleRounds).toHaveBeenCalledTimes(2);
	});

	it("swallows a sweep failure instead of throwing", async () => {
		jest.useFakeTimers();
		const rounds = {
			expireStaleRounds: jest.fn().mockRejectedValue(new Error("db down")),
		} as unknown as MonteRoundService;
		const sweeper = new MonteRoundSweeper(rounds);

		sweeper.onModuleInit();
		expect(() =>
			jest.advanceTimersByTime(MONTE_SWEEP_INTERVAL_MS),
		).not.toThrow();
		// Let the rejected promise settle without an unhandled rejection.
		await Promise.resolve();
		sweeper.onModuleDestroy();
	});
});
