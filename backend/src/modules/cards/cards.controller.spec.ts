import { UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { User } from "../users/entities/user.entity";
import { UsersService } from "../users/users.service";
import { CardsController } from "./cards.controller";
import { CardsService } from "./cards.service";

function makeUser(): User {
	const user = new User();
	user.id = 1;
	user.username = "TestTurtle";
	user.coins = 500;
	return user;
}

const req = { user: { id: 1 } } as unknown as Parameters<
	CardsController["binder"]
>[0];

describe("CardsController", () => {
	let controller: CardsController;
	let cardsService: { getBinder: jest.Mock; openPack: jest.Mock };
	let usersService: { findById: jest.Mock };

	beforeEach(async () => {
		cardsService = {
			getBinder: jest.fn().mockResolvedValue({ cards: [], packTiers: [] }),
			openPack: jest.fn().mockResolvedValue({ pulls: [], coins: 400 }),
		};
		usersService = { findById: jest.fn().mockResolvedValue(makeUser()) };

		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				CardsController,
				{ provide: CardsService, useValue: cardsService },
				{ provide: UsersService, useValue: usersService },
			],
		}).compile();

		controller = moduleRef.get(CardsController);
	});

	describe("GET /cards", () => {
		it("should return the binder for the authenticated player", async () => {
			const binder = await controller.binder(req);

			expect(usersService.findById).toHaveBeenCalledWith(1);
			expect(cardsService.getBinder).toHaveBeenCalledWith(expect.any(User));
			expect(binder).toEqual({ cards: [], packTiers: [] });
		});

		it("should throw UnauthorizedException when the user is missing", async () => {
			usersService.findById.mockResolvedValue(null);

			await expect(controller.binder(req)).rejects.toBeInstanceOf(
				UnauthorizedException,
			);
			expect(cardsService.getBinder).not.toHaveBeenCalled();
		});
	});

	describe("POST /cards/packs/open", () => {
		it("should default to the basic tier when no tierId is given", async () => {
			const result = await controller.openPack(req, {});

			expect(cardsService.openPack).toHaveBeenCalledWith(
				expect.any(User),
				"basic",
			);
			expect(result).toEqual({ pulls: [], coins: 400 });
		});

		it("should pass through the requested tierId", async () => {
			await controller.openPack(req, { tierId: "legendary" });

			expect(cardsService.openPack).toHaveBeenCalledWith(
				expect.any(User),
				"legendary",
			);
		});

		it("should throw UnauthorizedException when the user is missing", async () => {
			usersService.findById.mockResolvedValue(null);

			await expect(
				controller.openPack(req, { tierId: "deluxe" }),
			).rejects.toBeInstanceOf(UnauthorizedException);
			expect(cardsService.openPack).not.toHaveBeenCalled();
		});
	});
});
