import { HttpException, UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { User } from "../users/entities/user.entity";
import { UsersService } from "../users/users.service";
import { CasinoController } from "./casino.controller";
import { CasinoService } from "./casino.service";
import { DiceService } from "./dice.service";
import { FlipService } from "./flip.service";
import { MonteService } from "./monte.service";
import { MonteRoundService } from "./monte-round.service";
import { PlinkoService } from "./plinko.service";
import { SlotsService } from "./slots.service";

function makeUser(): User {
	const user = new User();
	user.id = 1;
	user.username = "TestTurtle";
	user.coins = 500;
	return user;
}

const req = { user: { id: 1 } } as unknown as Parameters<
	CasinoController["spin"]
>[0];

/** Assert a promise rejects with an HttpException carrying the given status. */
async function expectStatus(
	promise: Promise<unknown>,
	status: number,
): Promise<void> {
	const err = await promise.then(() => null).catch((e: unknown) => e);
	expect(err).toBeInstanceOf(HttpException);
	expect((err as HttpException).getStatus()).toBe(status);
}

describe("CasinoController", () => {
	let controller: CasinoController;
	let casinoService: {
		getWheelView: jest.Mock;
		freeSpin: jest.Mock;
		wageredSpin: jest.Mock;
	};
	let flipService: { getFlipConfig: jest.Mock; flip: jest.Mock };
	let monteService: { getMonteConfig: jest.Mock };
	let monteRoundService: {
		startRound: jest.Mock;
		getActiveRound: jest.Mock;
		getSteps: jest.Mock;
		resolveRound: jest.Mock;
	};
	let slotsService: { getSlotsView: jest.Mock; slots: jest.Mock };
	let diceService: { getDiceConfig: jest.Mock; dice: jest.Mock };
	let plinkoService: { getPlinkoView: jest.Mock; drop: jest.Mock };
	let usersService: { findById: jest.Mock };
	let rateLimiter: { allowKey: jest.Mock };

	beforeEach(async () => {
		casinoService = {
			getWheelView: jest.fn().mockResolvedValue({ coins: 500 }),
			freeSpin: jest.fn().mockResolvedValue({ mode: "free" }),
			wageredSpin: jest.fn().mockResolvedValue({ mode: "wagered" }),
		};
		flipService = {
			getFlipConfig: jest.fn().mockReturnValue({ coins: 500, multiplier: 2 }),
			flip: jest.fn().mockResolvedValue({ game: "flip", outcomeId: "heads" }),
		};
		monteService = {
			getMonteConfig: jest
				.fn()
				.mockReturnValue({ coins: 500, defaultShells: 3 }),
		};
		monteRoundService = {
			startRound: jest.fn().mockResolvedValue({
				roundId: "round-1",
				cupIds: ["cup-a", "cup-b", "cup-c"],
				ballStartSlot: 1,
				stepCount: 8,
				coins: 400,
			}),
			getActiveRound: jest.fn().mockResolvedValue(null),
			getSteps: jest.fn().mockResolvedValue({
				roundId: "round-1",
				steps: [],
				stepCount: 8,
				ready: false,
			}),
			resolveRound: jest.fn().mockResolvedValue({
				roundId: "round-1",
				game: "monte",
				selectedSlot: 1,
				won: true,
			}),
		};
		slotsService = {
			getSlotsView: jest.fn().mockReturnValue({ coins: 500, reelCount: 3 }),
			slots: jest
				.fn()
				.mockResolvedValue({ game: "slots", outcomeId: "bell|bell|bell" }),
		};
		diceService = {
			getDiceConfig: jest.fn().mockReturnValue({ coins: 500, range: 100 }),
			dice: jest.fn().mockResolvedValue({ game: "dice", outcomeId: "roll-10" }),
		};
		plinkoService = {
			getPlinkoView: jest.fn().mockReturnValue({ coins: 500, defaultRows: 8 }),
			drop: jest.fn().mockResolvedValue({ game: "drop", outcomeId: "bucket-4" }),
		};
		usersService = { findById: jest.fn().mockResolvedValue(makeUser()) };
		rateLimiter = { allowKey: jest.fn().mockReturnValue(true) };

		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				CasinoController,
				{ provide: CasinoService, useValue: casinoService },
				{ provide: FlipService, useValue: flipService },
				{ provide: MonteService, useValue: monteService },
				{ provide: MonteRoundService, useValue: monteRoundService },
				{ provide: SlotsService, useValue: slotsService },
				{ provide: DiceService, useValue: diceService },
				{ provide: PlinkoService, useValue: plinkoService },
				{ provide: UsersService, useValue: usersService },
				{ provide: RateLimiterService, useValue: rateLimiter },
			],
		}).compile();

		controller = moduleRef.get(CasinoController);
	});

	describe("GET /casino/wheel", () => {
		it("should return the wheel view for the authenticated player", async () => {
			const view = await controller.wheel(req);

			expect(usersService.findById).toHaveBeenCalledWith(1);
			expect(casinoService.getWheelView).toHaveBeenCalledWith(
				expect.any(User),
			);
			expect(view).toEqual({ coins: 500 });
		});

		it("should throw UnauthorizedException when the user is missing", async () => {
			usersService.findById.mockResolvedValue(null);

			await expect(controller.wheel(req)).rejects.toBeInstanceOf(
				UnauthorizedException,
			);
		});
	});

	describe("POST /casino/wheel/free", () => {
		it("should delegate to freeSpin with the client seed", async () => {
			const result = await controller.freeSpin(req, { clientSeed: "abc" });

			expect(casinoService.freeSpin).toHaveBeenCalledWith(
				expect.any(User),
				{ clientSeed: "abc" },
			);
			expect(result).toEqual({ mode: "free" });
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allowKey.mockReturnValue(false);

			await expectStatus(controller.freeSpin(req, {}), 429);
			expect(casinoService.freeSpin).not.toHaveBeenCalled();
		});
	});

	describe("POST /casino/wheel/spin", () => {
		it("should delegate to wageredSpin with stake and client seed", async () => {
			const result = await controller.spin(req, {
				stake: 100,
				clientSeed: "x",
			});

			expect(casinoService.wageredSpin).toHaveBeenCalledWith(
				expect.any(User),
				100,
				{ clientSeed: "x" },
			);
			expect(result).toEqual({ mode: "wagered" });
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allowKey.mockReturnValue(false);

			await expectStatus(controller.spin(req, { stake: 100 }), 429);
			expect(casinoService.wageredSpin).not.toHaveBeenCalled();
		});

		it("should throw UnauthorizedException when the user is missing", async () => {
			usersService.findById.mockResolvedValue(null);

			await expect(
				controller.spin(req, { stake: 100 }),
			).rejects.toBeInstanceOf(UnauthorizedException);
		});
	});

	describe("GET /casino/flip", () => {
		it("should return the flip config for the authenticated player", async () => {
			const config = await controller.flipConfig(req);

			expect(flipService.getFlipConfig).toHaveBeenCalledWith(
				expect.any(User),
			);
			expect(config).toEqual({ coins: 500, multiplier: 2 });
		});
	});

	describe("POST /casino/flip", () => {
		it("should delegate to flip with the pick, stake and client seed", async () => {
			const result = await controller.flip(req, {
				stake: 100,
				pick: "heads",
				clientSeed: "x",
			});

			expect(flipService.flip).toHaveBeenCalledWith(
				expect.any(User),
				"heads",
				100,
				{ clientSeed: "x" },
			);
			expect(result).toEqual({ game: "flip", outcomeId: "heads" });
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allowKey.mockReturnValue(false);

			await expectStatus(
				controller.flip(req, { stake: 100, pick: "heads" }),
				429,
			);
			expect(flipService.flip).not.toHaveBeenCalled();
		});
	});

	describe("GET /casino/monte", () => {
		it("should return the monte config for the authenticated player", async () => {
			const config = await controller.monteConfig(req);

			expect(monteService.getMonteConfig).toHaveBeenCalledWith(
				expect.any(User),
			);
			expect(monteRoundService.getActiveRound).toHaveBeenCalledWith(
				expect.any(User),
			);
			expect(config).toEqual({
				coins: 500,
				defaultShells: 3,
				activeRound: null,
			});
		});
	});

	describe("POST /casino/monte/rounds", () => {
		it("should start a committed round with stake and client seed", async () => {
			const result = await controller.startMonteRound(req, {
				stake: 100,
				clientSeed: "x",
			});

			expect(monteRoundService.startRound).toHaveBeenCalledWith(
				expect.any(User),
				100,
				"x",
			);
			expect(result).toEqual({
				roundId: "round-1",
				cupIds: ["cup-a", "cup-b", "cup-c"],
				ballStartSlot: 1,
				stepCount: 8,
				coins: 400,
			});
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allowKey.mockReturnValue(false);

			await expectStatus(
				controller.startMonteRound(req, { stake: 100 }),
				429,
			);
			expect(monteRoundService.startRound).not.toHaveBeenCalled();
		});
	});

	describe("GET /casino/monte/rounds/:roundId/steps", () => {
		it("should return the just-in-time swaps for the round", async () => {
			const result = await controller.monteRoundSteps(req, "round-1");

			expect(monteRoundService.getSteps).toHaveBeenCalledWith(
				expect.any(User),
				"round-1",
			);
			expect(result).toEqual({
				roundId: "round-1",
				steps: [],
				stepCount: 8,
				ready: false,
			});
		});
	});

	describe("POST /casino/monte/rounds/:roundId/resolve", () => {
		it("should resolve a committed round with the selected slot", async () => {
			const result = await controller.resolveMonteRound(req, "round-1", {
				selectedSlot: 1,
			});

			expect(monteRoundService.resolveRound).toHaveBeenCalledWith(
				expect.any(User),
				"round-1",
				1,
			);
			expect(result).toEqual({
				roundId: "round-1",
				game: "monte",
				selectedSlot: 1,
				won: true,
			});
		});
	});

	describe("GET /casino/slots", () => {
		it("should return the slots view for the authenticated player", async () => {
			const view = await controller.slotsView(req);

			expect(slotsService.getSlotsView).toHaveBeenCalledWith(
				expect.any(User),
			);
			expect(view).toEqual({ coins: 500, reelCount: 3 });
		});
	});

	describe("POST /casino/slots", () => {
		it("should delegate to slots with the stake and client seed", async () => {
			const result = await controller.slots(req, {
				stake: 100,
				clientSeed: "x",
			});

			expect(slotsService.slots).toHaveBeenCalledWith(expect.any(User), 100, {
				clientSeed: "x",
			});
			expect(result).toEqual({ game: "slots", outcomeId: "bell|bell|bell" });
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allowKey.mockReturnValue(false);

			await expectStatus(controller.slots(req, { stake: 100 }), 429);
			expect(slotsService.slots).not.toHaveBeenCalled();
		});
	});

	describe("GET /casino/dice", () => {
		it("should return the dice config for the authenticated player", async () => {
			const config = await controller.diceConfig(req);

			expect(diceService.getDiceConfig).toHaveBeenCalledWith(
				expect.any(User),
			);
			expect(config).toEqual({ coins: 500, range: 100 });
		});
	});

	describe("POST /casino/dice", () => {
		it("should delegate to dice with the direction, target, stake and client seed", async () => {
			const result = await controller.dice(req, {
				stake: 100,
				direction: "under",
				target: 50,
				clientSeed: "x",
			});

			expect(diceService.dice).toHaveBeenCalledWith(
				expect.any(User),
				"under",
				50,
				100,
				{ clientSeed: "x" },
			);
			expect(result).toEqual({ game: "dice", outcomeId: "roll-10" });
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allowKey.mockReturnValue(false);

			await expectStatus(
				controller.dice(req, { stake: 100, direction: "under", target: 50 }),
				429,
			);
			expect(diceService.dice).not.toHaveBeenCalled();
		});
	});

	describe("GET /casino/plinko", () => {
		it("should return the plinko view for the authenticated player", async () => {
			const view = await controller.plinkoView(req);

			expect(plinkoService.getPlinkoView).toHaveBeenCalledWith(
				expect.any(User),
			);
			expect(view).toEqual({ coins: 500, defaultRows: 8 });
		});
	});

	describe("POST /casino/plinko", () => {
		it("should delegate to drop with the rows, stake and client seed", async () => {
			const result = await controller.plinko(req, {
				stake: 100,
				rows: 8,
				clientSeed: "x",
			});

			expect(plinkoService.drop).toHaveBeenCalledWith(
				expect.any(User),
				8,
				100,
				{ clientSeed: "x" },
			);
			expect(result).toEqual({ game: "drop", outcomeId: "bucket-4" });
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allowKey.mockReturnValue(false);

			await expectStatus(controller.plinko(req, { stake: 100 }), 429);
			expect(plinkoService.drop).not.toHaveBeenCalled();
		});
	});

	// Bug Audit 2.1: the spin rate limit used to be a single bucket shared by
	// all six games, keyed by client IP — one fast game (or a shared NAT)
	// could starve every player/game sharing that bucket. It must now key on
	// the authenticated user id, with a separate bucket per game.
	describe("spin rate limiting (Bug Audit 2.1)", () => {
		it("should rate-limit by the authenticated user id, not the request IP", async () => {
			await controller.spin(req, { stake: 100 });

			expect(rateLimiter.allowKey).toHaveBeenCalledWith(
				expect.any(String),
				"1",
				expect.any(Number),
				expect.any(Number),
			);
		});

		it("should use a separate bucket per game so one fast game can't starve the others", async () => {
			await controller.spin(req, { stake: 100 });
			await controller.dice(req, {
				stake: 100,
				direction: "under",
				target: 50,
			});

			const buckets = rateLimiter.allowKey.mock.calls.map(
				(call) => call[0] as string,
			);
			expect(new Set(buckets).size).toBe(buckets.length);
		});

		it("should not let being rate-limited on one game block a different game", async () => {
			rateLimiter.allowKey.mockImplementation(
				(bucket: string) => !bucket.endsWith(":wheel"),
			);

			await expectStatus(controller.spin(req, { stake: 100 }), 429);
			const result = await controller.dice(req, {
				stake: 100,
				direction: "under",
				target: 50,
			});

			expect(result).toEqual({ game: "dice", outcomeId: "roll-10" });
		});
	});
});
