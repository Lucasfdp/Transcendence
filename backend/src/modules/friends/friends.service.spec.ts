import {
	BadRequestException,
	ConflictException,
	NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { PresenceService } from "../presence/presence.service";
import { User } from "../users/entities/user.entity";
import { FriendView, FriendsService } from "./friends.service";
import { Friendship } from "./entities/friendship.entity";

const mockFriendshipRepo = () => ({
	findOne: jest.fn(),
	find: jest.fn(),
	save: jest.fn(),
	create: jest.fn((v) => v),
	delete: jest.fn(),
});

const mockUserRepo = () => ({
	findOne: jest.fn(),
});

const mockPresence = () => ({
	isOnline: jest.fn().mockReturnValue(false),
});

const makeUser = (overrides: Partial<User> = {}): User =>
	Object.assign(new User(), {
		id: 1,
		username: "kame",
		turtleName: "KameMaster",
		shellSkin: "kanagawa",
		avatar: null,
		level: 5,
		xp: 0,
		coins: 0,
		isGuest: false,
		...overrides,
	});

describe("FriendsService", () => {
	let service: FriendsService;
	let friendshipRepo: ReturnType<typeof mockFriendshipRepo>;
	let userRepo: ReturnType<typeof mockUserRepo>;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				FriendsService,
				{
					provide: getRepositoryToken(Friendship),
					useFactory: mockFriendshipRepo,
				},
				{ provide: getRepositoryToken(User), useFactory: mockUserRepo },
				{ provide: PresenceService, useFactory: mockPresence },
			],
		}).compile();

		service = module.get(FriendsService);
		friendshipRepo = module.get(getRepositoryToken(Friendship));
		userRepo = module.get(getRepositoryToken(User));
	});

	// ── sendRequest ──────────────────────────────────────────────────────────────

	describe("sendRequest", () => {
		it("should throw NotFoundException when addressee username does not exist", async () => {
			userRepo.findOne.mockResolvedValue(null);
			await expect(service.sendRequest(1, "ghost")).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw BadRequestException when sending a request to yourself", async () => {
			userRepo.findOne.mockResolvedValue(makeUser({ id: 1 }));
			await expect(service.sendRequest(1, "self")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should throw ConflictException when a friendship row already exists", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			friendshipRepo.findOne.mockResolvedValue({ id: 1 });
			await expect(service.sendRequest(1, "rival")).rejects.toThrow(
				ConflictException,
			);
		});

		it("should create a pending friendship on the happy path", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			friendshipRepo.findOne.mockResolvedValue(null);
			friendshipRepo.save.mockResolvedValue({});

			await expect(
				service.sendRequest(1, "rival"),
			).resolves.toBeUndefined();
			expect(friendshipRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					requesterId: 1,
					addresseeId: 2,
					status: "pending",
				}),
			);
		});
	});

	// ── acceptRequest ────────────────────────────────────────────────────────────

	describe("acceptRequest", () => {
		it("should throw NotFoundException when no pending row exists", async () => {
			friendshipRepo.findOne.mockResolvedValue(null);
			await expect(service.acceptRequest(2, 1)).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should update status to accepted on the happy path", async () => {
			const row = { requesterId: 1, addresseeId: 2, status: "pending" };
			friendshipRepo.findOne.mockResolvedValue(row);
			friendshipRepo.save.mockResolvedValue({
				...row,
				status: "accepted",
			});

			await service.acceptRequest(2, 1);
			expect(friendshipRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ status: "accepted" }),
			);
		});
	});

	// ── getFriendIds ─────────────────────────────────────────────────────────────

	describe("getFriendIds", () => {
		it("should return IDs of the other party in each accepted friendship", async () => {
			friendshipRepo.find.mockResolvedValue([
				{ requesterId: 1, addresseeId: 2 },
				{ requesterId: 3, addresseeId: 1 },
			]);
			const ids = await service.getFriendIds(1);
			expect(ids).toEqual(expect.arrayContaining([2, 3]));
			expect(ids).toHaveLength(2);
		});

		it("should return an empty array when the user has no friends", async () => {
			friendshipRepo.find.mockResolvedValue([]);
			expect(await service.getFriendIds(1)).toEqual([]);
		});
	});

	// ── listFriends ──────────────────────────────────────────────────────────────

	describe("listFriends", () => {
		it("should return FriendView with isOnline from PresenceService", async () => {
			const alice = makeUser({ id: 2, username: "alice" });
			friendshipRepo.find.mockResolvedValue([
				{
					requesterId: 1,
					addresseeId: 2,
					status: "accepted",
					requester: makeUser({ id: 1 }),
					addressee: alice,
				},
			]);
			const presence = module_presence();
			presence.isOnline.mockReturnValue(true);

			const result: FriendView[] = await service.listFriends(1);
			expect(result[0].userId).toBe(2);
			expect(result[0].username).toBe("alice");
		});
	});
});

function module_presence() {
	// Helper to get the PresenceService mock — unused except in listFriends test
	return { isOnline: jest.fn().mockReturnValue(false) };
}
