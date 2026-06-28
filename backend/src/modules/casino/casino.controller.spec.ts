import { HttpException, UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { User } from "../users/entities/user.entity";
import { UsersService } from "../users/users.service";
import { CasinoController } from "./casino.controller";
import { CasinoService } from "./casino.service";
import { FlipService } from "./flip.service";
import { MonteService } from "./monte.service";
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
	let monteService: { getMonteConfig: jest.Mock; monte: jest.Mock };
	let slotsService: { getSlotsView: jest.Mock; slots: jest.Mock };
	let usersService: { findById: jest.Mock };
	let rateLimiter: { allow: jest.Mock };

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
			monte: jest
				.fn()
				.mockResolvedValue({ game: "monte", outcomeId: "shell-1" }),
		};
		slotsService = {
			getSlotsView: jest.fn().mockReturnValue({ coins: 500, reelCount: 3 }),
			slots: jest
				.fn()
				.mockResolvedValue({ game: "slots", outcomeId: "bell|bell|bell" }),
		};
		usersService = { findById: jest.fn().mockResolvedValue(makeUser()) };
		rateLimiter = { allow: jest.fn().mockReturnValue(true) };

		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				CasinoController,
				{ provide: CasinoService, useValue: casinoService },
				{ provide: FlipService, useValue: flipService },
				{ provide: MonteService, useValue: monteService },
				{ provide: SlotsService, useValue: slotsService },
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
			rateLimiter.allow.mockReturnValue(false);

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
			rateLimiter.allow.mockReturnValue(false);

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
			rateLimiter.allow.mockReturnValue(false);

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
			expect(config).toEqual({ coins: 500, defaultShells: 3 });
		});
	});

	describe("POST /casino/monte", () => {
		it("should delegate to monte with pick, shells, stake and client seed", async () => {
			const result = await controller.monte(req, {
				stake: 100,
				pick: 1,
				shells: 4,
				clientSeed: "x",
			});

			expect(monteService.monte).toHaveBeenCalledWith(
				expect.any(User),
				1,
				4,
				100,
				{ clientSeed: "x" },
			);
			expect(result).toEqual({ game: "monte", outcomeId: "shell-1" });
		});

		it("should reject with HTTP 429 when rate-limited", async () => {
			rateLimiter.allow.mockReturnValue(false);

			await expectStatus(
				controller.monte(req, { stake: 100, pick: 0 }),
				429,
			);
			expect(monteService.monte).not.toHaveBeenCalled();
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
			rateLimiter.allow.mockReturnValue(false);

			await expectStatus(controller.slots(req, { stake: 100 }), 429);
			expect(slotsService.slots).not.toHaveBeenCalled();
		});
	});
});
