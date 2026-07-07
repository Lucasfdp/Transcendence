import {
	BadRequestException,
	ConflictException,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import type { EntityManager } from "typeorm";
import { PresenceService } from "../presence/presence.service";
import { NotificationsService } from "../notifications/notifications.service";
import { User } from "../users/entities/user.entity";
import { FriendView, FriendsService, PendingView } from "./friends.service";
import { Friendship } from "./entities/friendship.entity";

const mockFriendshipRepo = () => {
	const repo: Record<string, jest.Mock> & {
		manager?: { transaction: jest.Mock };
	} = {
		findOne: jest.fn(),
		find: jest.fn(),
		save: jest.fn(),
		create: jest.fn((v) => v),
		delete: jest.fn(),
	};
	// The transaction callback receives an EntityManager; `getRepository`
	// just needs to hand back this same mock repo so assertions on
	// delete/save/create apply the same whether block() ran inside a
	// transaction it opened itself or one passed in by the caller.
	repo.manager = {
		transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
			cb({ getRepository: () => repo } as unknown as EntityManager),
		),
	};
	return repo;
};

const mockUserRepo = () => ({
	// Default to a resolved promise so the service's `.catch()` chaining on
	// findOne behaves like a real repository. Tests override per-case.
	findOne: jest.fn().mockResolvedValue(null),
	find: jest.fn().mockResolvedValue([]),
});

const mockPresence = () => ({
	isOnline: jest.fn().mockReturnValue(false),
	getStatus: jest.fn().mockReturnValue("offline"),
	getGameId: jest.fn().mockReturnValue(null),
});

const makeUser = (overrides: Partial<User> = {}): User =>
	Object.assign(new User(), {
		id: 1,
		username: "kame",
		turtleName: "KameMaster",
		shellSkin: "base",
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
	let presence: ReturnType<typeof mockPresence>;

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
				{
					provide: NotificationsService,
					useValue: {
						create: jest.fn().mockResolvedValue(undefined),
						removeWhere: jest.fn().mockResolvedValue(undefined),
					},
				},
			],
		}).compile();

		service = module.get(FriendsService);
		friendshipRepo = module.get(getRepositoryToken(Friendship));
		userRepo = module.get(getRepositoryToken(User));
		presence = module.get(PresenceService);
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

		it("should throw ConflictException when an outgoing request already exists", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			// My own outstanding pending row (I am the requester).
			friendshipRepo.findOne.mockResolvedValue({
				requesterId: 1,
				addresseeId: 2,
				status: "pending",
			});
			await expect(service.sendRequest(1, "rival")).rejects.toThrow(
				ConflictException,
			);
		});

		it("should auto-accept when the addressee already sent me a pending request (Bug Audit M2)", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			// Reverse-direction pending: they (id 2) requested me (id 1).
			const reverse = { requesterId: 2, addresseeId: 1, status: "pending" };
			friendshipRepo.findOne
				.mockResolvedValueOnce(reverse) // sendRequest's existing lookup
				.mockResolvedValueOnce(reverse); // acceptRequest's lookup
			friendshipRepo.save.mockResolvedValue({ ...reverse, status: "accepted" });

			await expect(service.sendRequest(1, "rival")).resolves.toBeUndefined();

			// Resolved by accepting the existing row, never by inserting a new one.
			expect(friendshipRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ status: "accepted" }),
			);
			expect(friendshipRepo.save).not.toHaveBeenCalledWith(
				expect.objectContaining({ status: "pending" }),
			);
		});

		it("should silently no-op (not leak the block) when the addressee has blocked me (Bug Audit M8)", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			// The other user (id 2) blocked me (id 1).
			friendshipRepo.findOne.mockResolvedValue({
				requesterId: 2,
				addresseeId: 1,
				status: "blocked",
			});

			await expect(service.sendRequest(1, "rival")).resolves.toBeUndefined();
			expect(friendshipRepo.save).not.toHaveBeenCalled();
		});

		it("should throw an actionable ConflictException when I have blocked the target", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			friendshipRepo.findOne.mockResolvedValue({
				requesterId: 1,
				addresseeId: 2,
				status: "blocked",
			});

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

		it("should map a concurrent unique-violation (23505) to ConflictException, not a 500 (Bug Audit M5)", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			// The check-then-insert's `existing` lookup finds nothing (a
			// concurrent request for the same pair hasn't committed yet), but
			// the insert itself then races the DB unique index and loses.
			friendshipRepo.findOne.mockResolvedValue(null);
			friendshipRepo.save.mockRejectedValue(
				Object.assign(new Error("duplicate key"), { code: "23505" }),
			);

			await expect(service.sendRequest(1, "rival")).rejects.toThrow(
				ConflictException,
			);
		});

		it("should throw InternalServerErrorException for a non-unique-violation save failure", async () => {
			userRepo.findOne.mockResolvedValue(
				makeUser({ id: 2, username: "rival" }),
			);
			friendshipRepo.findOne.mockResolvedValue(null);
			friendshipRepo.save.mockRejectedValue(new Error("connection lost"));

			await expect(service.sendRequest(1, "rival")).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── block ────────────────────────────────────────────────────────────────────

	describe("block", () => {
		it("should throw BadRequestException when blocking yourself", async () => {
			await expect(service.block(1, 1)).rejects.toThrow(
				BadRequestException,
			);
			expect(friendshipRepo.manager?.transaction).not.toHaveBeenCalled();
		});

		it("should throw NotFoundException when the target user does not exist (Bug Audit M3)", async () => {
			userRepo.findOne.mockResolvedValue(null);

			await expect(service.block(1, 2)).rejects.toThrow(NotFoundException);
			expect(friendshipRepo.manager?.transaction).not.toHaveBeenCalled();
		});

		it("should delete pending/accepted rows in both directions plus the caller's own block row, but NOT the other user's block, then insert a blocked row (Bug Audit M1)", async () => {
			userRepo.findOne.mockResolvedValue(makeUser({ id: 2 }));
			friendshipRepo.delete.mockResolvedValue({ affected: 1 });
			friendshipRepo.save.mockResolvedValue({});

			await service.block(1, 2);

			expect(friendshipRepo.manager?.transaction).toHaveBeenCalledTimes(1);
			// Crucially, { requesterId: 2, addresseeId: 1, status: "blocked" } is
			// absent — the other user's block of the caller must survive so mutual
			// blocks coexist.
			expect(friendshipRepo.delete).toHaveBeenCalledWith([
				{ requesterId: 1, addresseeId: 2, status: "pending" },
				{ requesterId: 2, addresseeId: 1, status: "pending" },
				{ requesterId: 1, addresseeId: 2, status: "accepted" },
				{ requesterId: 2, addresseeId: 1, status: "accepted" },
				{ requesterId: 1, addresseeId: 2, status: "blocked" },
			]);
			expect(friendshipRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					requesterId: 1,
					addresseeId: 2,
					status: "blocked",
				}),
			);
		});

		it("should join a caller-provided manager instead of opening its own transaction", async () => {
			userRepo.findOne.mockResolvedValue(makeUser({ id: 2 }));
			friendshipRepo.delete.mockResolvedValue({ affected: 0 });
			friendshipRepo.save.mockResolvedValue({});
			const callerManager = {
				getRepository: () => friendshipRepo,
			} as unknown as EntityManager;

			await service.block(1, 2, callerManager);

			expect(friendshipRepo.manager?.transaction).not.toHaveBeenCalled();
			expect(friendshipRepo.save).toHaveBeenCalled();
		});

		it("should throw InternalServerErrorException when the transaction fails", async () => {
			userRepo.findOne.mockResolvedValue(makeUser({ id: 2 }));
			friendshipRepo.manager!.transaction.mockRejectedValueOnce(
				new Error("db down"),
			);

			await expect(service.block(1, 2)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── unblock / listBlocked (Bug Audit H3) ──────────────────────────────────

	describe("unblock", () => {
		it("should delete only the caller's own block row, never the other user's", async () => {
			friendshipRepo.delete.mockResolvedValue({ affected: 1 });

			await service.unblock(1, 2);

			expect(friendshipRepo.delete).toHaveBeenCalledWith({
				requesterId: 1,
				addresseeId: 2,
				status: "blocked",
			});
		});

		it("should resolve without throwing when there is no matching block row", async () => {
			friendshipRepo.delete.mockResolvedValue({ affected: 0 });

			await expect(service.unblock(1, 2)).resolves.toBeUndefined();
		});
	});

	describe("listBlocked", () => {
		it("should return the users the caller has blocked (rows they own)", async () => {
			friendshipRepo.find.mockResolvedValue([
				{
					requesterId: 1,
					status: "blocked",
					addressee: makeUser({ id: 2, username: "rival" }),
				},
			]);

			const result = await service.listBlocked(1);

			expect(friendshipRepo.find).toHaveBeenCalledWith({
				where: { requesterId: 1, status: "blocked" },
				relations: ["addressee"],
			});
			expect(result).toEqual([
				expect.objectContaining({ userId: 2, username: "rival" }),
			]);
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

	// ── removeFriend / declineOrCancelRequest ───────────────────────────────────
	//
	// These used to be one method (removeOrDecline) that deleted ANY row
	// regardless of status. That was a real bug: if Accept happens on one UI
	// surface (e.g. the notification drawer) and Decline/Cancel fires from a
	// stale UI elsewhere (e.g. the social tab's pending list) for the same
	// pair, the stale decline would delete the *just-accepted* friendship.
	// Splitting by status makes the stale action a safe no-op instead.

	describe("removeFriend", () => {
		it("should delete only the accepted row between the two users, in either direction", async () => {
			friendshipRepo.delete.mockResolvedValue({ affected: 1 });

			await service.removeFriend(1, 2);

			expect(friendshipRepo.delete).toHaveBeenCalledWith([
				{ requesterId: 1, addresseeId: 2, status: "accepted" },
				{ requesterId: 2, addresseeId: 1, status: "accepted" },
			]);
		});

		it("should resolve without throwing when there is no matching accepted row (already removed elsewhere)", async () => {
			friendshipRepo.delete.mockResolvedValue({ affected: 0 });

			await expect(service.removeFriend(1, 2)).resolves.toBeUndefined();
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			friendshipRepo.delete.mockRejectedValue(new Error("db down"));

			await expect(service.removeFriend(1, 2)).rejects.toThrow(
				"Failed to remove friend",
			);
		});
	});

	describe("declineOrCancelRequest", () => {
		it("should delete only the pending row between the two users, in either direction", async () => {
			friendshipRepo.delete.mockResolvedValue({ affected: 1 });

			await service.declineOrCancelRequest(1, 2);

			expect(friendshipRepo.delete).toHaveBeenCalledWith([
				{ requesterId: 1, addresseeId: 2, status: "pending" },
				{ requesterId: 2, addresseeId: 1, status: "pending" },
			]);
		});

		it("should resolve without throwing when there is no matching pending row (e.g. already accepted elsewhere)", async () => {
			friendshipRepo.delete.mockResolvedValue({ affected: 0 });

			await expect(
				service.declineOrCancelRequest(1, 2),
			).resolves.toBeUndefined();
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			friendshipRepo.delete.mockRejectedValue(new Error("db down"));

			await expect(service.declineOrCancelRequest(1, 2)).rejects.toThrow(
				"Failed to decline friend request",
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
		const friendshipWith = (addressee: User) => ({
			requesterId: 1,
			addresseeId: addressee.id,
			status: "accepted",
			requester: makeUser({ id: 1 }),
			addressee,
		});

		it("should map basic friend fields from the friendship row", async () => {
			const alice = makeUser({ id: 2, username: "alice" });
			friendshipRepo.find.mockResolvedValue([friendshipWith(alice)]);

			const result: FriendView[] = await service.listFriends(1);
			expect(result[0].userId).toBe(2);
			expect(result[0].username).toBe("alice");
			expect(result[0].requesterId).toBe(1);
		});

		it("should derive status, isOnline and gameId from PresenceService", async () => {
			const alice = makeUser({ id: 2, username: "alice" });
			friendshipRepo.find.mockResolvedValue([friendshipWith(alice)]);
			presence.getStatus.mockReturnValue("in-game");
			presence.getGameId.mockReturnValue("bamboo-bash");

			const [view] = await service.listFriends(1);
			expect(view.status).toBe("in-game");
			expect(view.isOnline).toBe(true);
			expect(view.gameId).toBe("bamboo-bash");
		});

		it("should report isOnline false and null gameId when the friend is offline", async () => {
			const bob = makeUser({ id: 3, username: "bob" });
			friendshipRepo.find.mockResolvedValue([friendshipWith(bob)]);
			presence.getStatus.mockReturnValue("offline");
			presence.getGameId.mockReturnValue(null);

			const [view] = await service.listFriends(1);
			expect(view.status).toBe("offline");
			expect(view.isOnline).toBe(false);
			expect(view.gameId).toBeNull();
		});

		it("should serialise lastSeenAt to an ISO string when present", async () => {
			const seen = new Date("2026-07-01T12:00:00.000Z");
			const carol = makeUser({ id: 4, username: "carol", lastSeenAt: seen });
			friendshipRepo.find.mockResolvedValue([friendshipWith(carol)]);

			const [view] = await service.listFriends(1);
			expect(view.lastSeenAt).toBe("2026-07-01T12:00:00.000Z");
		});

		it("should leave lastSeenAt null when the friend has never been seen", async () => {
			const dave = makeUser({ id: 5, username: "dave", lastSeenAt: null });
			friendshipRepo.find.mockResolvedValue([friendshipWith(dave)]);

			const [view] = await service.listFriends(1);
			expect(view.lastSeenAt).toBeNull();
		});
	});

	// ── listOutgoing ─────────────────────────────────────────────────────────────

	describe("listOutgoing", () => {
		const outgoingRow = (addressee: User) => ({
			requesterId: 1,
			addresseeId: addressee.id,
			status: "pending",
			addressee,
		});

		it("should map outgoing pending requests to PendingView shape", async () => {
			const alice = makeUser({ id: 2, username: "alice" });
			friendshipRepo.find.mockResolvedValue([outgoingRow(alice)]);
			presence.isOnline.mockReturnValue(true);

			const result: PendingView[] = await service.listOutgoing(1);
			expect(friendshipRepo.find).toHaveBeenCalledWith({
				where: { requesterId: 1, status: "pending" },
				relations: ["addressee"],
			});
			expect(result).toEqual([
				{
					userId: 2,
					username: "alice",
					turtleName: "KameMaster",
					shellSkin: "base",
					avatar: null,
					level: 5,
					isOnline: true,
				},
			]);
		});

		it("should return an empty array when there are no outgoing requests", async () => {
			friendshipRepo.find.mockResolvedValue([]);
			expect(await service.listOutgoing(1)).toEqual([]);
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			friendshipRepo.find.mockRejectedValue(new Error("db down"));
			await expect(service.listOutgoing(1)).rejects.toThrow(
				"Failed to list outgoing requests",
			);
		});
	});

	// ── getSuggestions ───────────────────────────────────────────────────────────

	describe("getSuggestions", () => {
		it("should return an empty array when the user has no friends", async () => {
			friendshipRepo.find.mockResolvedValueOnce([]); // getFriendIds

			const result = await service.getSuggestions(1);

			expect(result).toEqual([]);
			// Only the getFriendIds lookup should have run — no point querying further.
			expect(friendshipRepo.find).toHaveBeenCalledTimes(1);
		});

		it("should suggest a friend-of-friend who has no existing row with the user", async () => {
			// 1 is friends with 2. 2 is friends with 3 ("friend of a friend").
			friendshipRepo.find
				.mockResolvedValueOnce([{ requesterId: 1, addresseeId: 2 }]) // getFriendIds(1) -> [2]
				.mockResolvedValueOnce([{ requesterId: 2, addresseeId: 3 }]) // friends of [2] -> 3
				.mockResolvedValueOnce([]); // no existing row between 1 and 3
			userRepo.find = jest
				.fn()
				.mockResolvedValue([makeUser({ id: 3, username: "carol" })]);

			const result = await service.getSuggestions(1);

			expect(result).toEqual([
				expect.objectContaining({ userId: 3, username: "carol" }),
			]);
		});

		it("should exclude the requesting user themselves from suggestions", async () => {
			// 1 and 3 are both friends with 2, so a naive join would suggest 1 to themselves.
			friendshipRepo.find
				.mockResolvedValueOnce([{ requesterId: 1, addresseeId: 2 }])
				.mockResolvedValueOnce([
					{ requesterId: 1, addresseeId: 2 },
					{ requesterId: 3, addresseeId: 2 },
				])
				.mockResolvedValueOnce([]);
			userRepo.find = jest
				.fn()
				.mockResolvedValue([makeUser({ id: 3, username: "dave" })]);

			const result = await service.getSuggestions(1);

			expect(result.map((r) => r.userId)).not.toContain(1);
			expect(result.map((r) => r.userId)).toEqual([3]);
		});

		it("should exclude users the requester is already friends with", async () => {
			// 1 is friends with 2 and 3. 2 is also friends with 3 — 3 must not be re-suggested.
			friendshipRepo.find
				.mockResolvedValueOnce([
					{ requesterId: 1, addresseeId: 2 },
					{ requesterId: 1, addresseeId: 3 },
				])
				.mockResolvedValueOnce([{ requesterId: 2, addresseeId: 3 }]);
			userRepo.find = jest.fn().mockResolvedValue([]);

			const result = await service.getSuggestions(1);

			expect(result).toEqual([]);
		});

		it("should exclude candidates with a pending request in either direction", async () => {
			friendshipRepo.find
				.mockResolvedValueOnce([{ requesterId: 1, addresseeId: 2 }])
				.mockResolvedValueOnce([{ requesterId: 2, addresseeId: 3 }])
				// exclusion query finds a pending row between 1 and 3
				.mockResolvedValueOnce([
					{ requesterId: 1, addresseeId: 3, status: "pending" },
				]);
			userRepo.find = jest.fn().mockResolvedValue([]);

			const result = await service.getSuggestions(1);

			expect(result).toEqual([]);
		});

		it("should exclude candidates with a blocked row in either direction", async () => {
			friendshipRepo.find
				.mockResolvedValueOnce([{ requesterId: 1, addresseeId: 2 }])
				.mockResolvedValueOnce([{ requesterId: 2, addresseeId: 3 }])
				.mockResolvedValueOnce([
					{ requesterId: 3, addresseeId: 1, status: "blocked" },
				]);
			userRepo.find = jest.fn().mockResolvedValue([]);

			const result = await service.getSuggestions(1);

			expect(result).toEqual([]);
		});

		it("should deduplicate a candidate reachable through multiple mutual friends", async () => {
			// 1 is friends with 2 and 4. Both 2 and 4 are friends with 3.
			friendshipRepo.find
				.mockResolvedValueOnce([
					{ requesterId: 1, addresseeId: 2 },
					{ requesterId: 1, addresseeId: 4 },
				])
				.mockResolvedValueOnce([
					{ requesterId: 2, addresseeId: 3 },
					{ requesterId: 4, addresseeId: 3 },
				])
				.mockResolvedValueOnce([]);
			userRepo.find = jest
				.fn()
				.mockResolvedValue([makeUser({ id: 3, username: "erin" })]);

			const result = await service.getSuggestions(1);

			expect(result).toHaveLength(1);
			expect(result[0].userId).toBe(3);
		});

		it("should apply a stable ordering and the limit at the query level", async () => {
			friendshipRepo.find
				.mockResolvedValueOnce([{ requesterId: 1, addresseeId: 2 }])
				.mockResolvedValueOnce([{ requesterId: 2, addresseeId: 3 }])
				.mockResolvedValueOnce([]);
			const findMock = jest.fn().mockResolvedValue([]);
			userRepo.find = findMock;

			await service.getSuggestions(1, 5);

			expect(findMock).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ isGuest: false }),
					order: { level: "DESC", username: "ASC" },
					take: 5,
				}),
			);
		});

		it("should throw InternalServerErrorException when the friendIds lookup fails", async () => {
			friendshipRepo.find.mockRejectedValue(new Error("db down"));

			await expect(service.getSuggestions(1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});

		it("should wrap a generic failure from the final user lookup in InternalServerErrorException", async () => {
			friendshipRepo.find
				.mockResolvedValueOnce([{ requesterId: 1, addresseeId: 2 }])
				.mockResolvedValueOnce([{ requesterId: 2, addresseeId: 3 }])
				.mockResolvedValueOnce([]);
			userRepo.find = jest.fn().mockRejectedValue(new Error("db down"));

			await expect(service.getSuggestions(1)).rejects.toThrow(
				"Failed to get friend suggestions",
			);
		});
	});
});
