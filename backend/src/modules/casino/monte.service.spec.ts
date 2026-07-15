import { Test, TestingModule } from "@nestjs/testing";
import { User } from "../users/entities/user.entity";
import { MAX_WAGER_COINS, MIN_WAGER_COINS } from "./casino.constants";
import { DEFAULT_SHELLS, MONTE_SHELL_OPTIONS } from "./monte.constants";
import { MonteService } from "./monte.service";

function makeUser(overrides: Partial<User> = {}): User {
	const user = new User();
	user.id = overrides.id ?? 1;
	user.username = overrides.username ?? "TestTurtle";
	user.coins = overrides.coins ?? 0;
	return user;
}

describe("MonteService", () => {
	let service: MonteService;

	beforeEach(async () => {
		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [MonteService],
		}).compile();

		service = moduleRef.get(MonteService);
	});

	describe("getMonteConfig", () => {
		it("should expose the shell options, default, RTP, bounds and balance", () => {
			const config = service.getMonteConfig(makeUser({ coins: 222 }));

			expect(config.shellOptions).toEqual([...MONTE_SHELL_OPTIONS]);
			expect(config.defaultShells).toBe(DEFAULT_SHELLS);
			expect(config.rtp).toBeCloseTo(1, 10);
			expect(config.minWager).toBe(MIN_WAGER_COINS);
			expect(config.maxWager).toBe(MAX_WAGER_COINS);
			expect(config.coins).toBe(222);
		});
	});
});
