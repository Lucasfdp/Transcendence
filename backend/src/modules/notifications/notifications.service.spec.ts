import {
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { IsNull } from "typeorm";
import { PresenceService } from "../presence/presence.service";
import { Notification } from "./entities/notification.entity";
import { NotificationsService } from "./notifications.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeNotification = (overrides: Partial<Notification> = {}): Notification =>
	Object.assign(new Notification(), {
		id: 1,
		type: "friend_request" as const,
		fromUserId: 10,
		toUserId: 20,
		fromUser: { id: 10, username: "kame" },
		payload: { username: "kame" },
		readAt: null,
		createdAt: new Date("2026-06-27T00:00:00Z"),
		...overrides,
	});

const mockRepo = () => ({
	create: jest.fn((v) => v),
	save: jest.fn(async (v) => ({ ...v, id: 1 })),
	find: jest.fn(),
	delete: jest.fn().mockResolvedValue({ affected: 0 }),
	// Default to a resolved promise so the service's `.catch()` chaining on
	// findOne behaves like a real repository. Tests override per-case.
	findOne: jest.fn().mockResolvedValue(null),
	createQueryBuilder: jest.fn(() => ({
		update: jest.fn().mockReturnThis(),
		set: jest.fn().mockReturnThis(),
		where: jest.fn().mockReturnThis(),
		execute: jest.fn().mockResolvedValue(undefined),
	})),
});

const mockPresence = () => ({
	getSocketIds: jest.fn().mockReturnValue([]),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationsService", () => {
	let service: NotificationsService;
	let repo: ReturnType<typeof mockRepo>;
	let presence: ReturnType<typeof mockPresence>;

	beforeEach(async () => {
		repo = mockRepo();
		presence = mockPresence();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				NotificationsService,
				{ provide: getRepositoryToken(Notification), useValue: repo },
				{ provide: PresenceService, useValue: presence },
			],
		}).compile();

		service = module.get(NotificationsService);
	});

	// ── create ───────────────────────────────────────────────────────────────

	describe("create", () => {
		it("should persist a notification and not push when no server is set", async () => {
			repo.save.mockResolvedValue(makeNotification());

			await service.create("friend_request", 10, 20, { username: "kame" });

			expect(repo.save).toHaveBeenCalledWith(
				expect.objectContaining({ type: "friend_request", fromUserId: 10, toUserId: 20 }),
			);
			// server is null by default — presence.getSocketIds should not be called
			expect(presence.getSocketIds).not.toHaveBeenCalled();
		});

		it("should push notification:new to live sockets when server is set", async () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			const mockServer = { to: mockTo } as never;
			service.setServer(mockServer);
			presence.getSocketIds.mockReturnValue(["socket-abc"]);
			repo.save.mockResolvedValue(makeNotification());

			await service.create("friend_request", 10, 20, { username: "kame" });

			expect(presence.getSocketIds).toHaveBeenCalledWith(20);
			expect(mockTo).toHaveBeenCalledWith("socket-abc");
			expect(mockEmit).toHaveBeenCalledWith(
				"notification:new",
				expect.objectContaining({ type: "friend_request", fromUserId: 10 }),
			);
		});

		it("should push to all open sockets when user has multiple tabs", async () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue(["socket-1", "socket-2"]);
			repo.save.mockResolvedValue(makeNotification());

			await service.create("friend_request", 10, 20, {});

			expect(mockTo).toHaveBeenCalledTimes(2);
		});

		it("should throw InternalServerErrorException when repo.save throws", async () => {
			repo.save.mockRejectedValue(new Error("DB error"));

			await expect(
				service.create("friend_request", 10, 20, {}),
			).rejects.toThrow(InternalServerErrorException);
		});

		it("should not persist a duplicate unread notification for the same type/from/to", async () => {
			repo.findOne.mockResolvedValue(makeNotification());

			await service.create("friend_request", 10, 20, { username: "kame" });

			expect(repo.findOne).toHaveBeenCalledWith({
				where: {
					type: "friend_request",
					fromUserId: 10,
					toUserId: 20,
					readAt: IsNull(),
				},
			});
			expect(repo.save).not.toHaveBeenCalled();
		});

		it("should not push a real-time event when a duplicate is skipped", async () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			repo.findOne.mockResolvedValue(makeNotification());

			await service.create("friend_request", 10, 20, {});

			expect(presence.getSocketIds).not.toHaveBeenCalled();
			expect(mockTo).not.toHaveBeenCalled();
		});

		it("should persist a new notification when no unread duplicate exists", async () => {
			repo.findOne.mockResolvedValue(null);
			repo.save.mockResolvedValue(makeNotification());

			await service.create("friend_request", 10, 20, { username: "kame" });

			expect(repo.save).toHaveBeenCalledWith(
				expect.objectContaining({ type: "friend_request", fromUserId: 10, toUserId: 20 }),
			);
		});

		it("should throw InternalServerErrorException when the dedup lookup fails", async () => {
			repo.findOne.mockRejectedValue(new Error("DB down"));

			await expect(
				service.create("friend_request", 10, 20, {}),
			).rejects.toThrow(InternalServerErrorException);
		});

		it("should reload the notification with its fromUser relation before pushing, since save() does not return relations", async () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue(["socket-abc"]);

			// Mirrors real TypeORM behaviour: a fresh .save() only returns the
			// columns/relations that were part of the input — no fromUser here.
			const savedWithoutRelation = Object.assign(new Notification(), {
				id: 1,
				type: "friend_request" as const,
				fromUserId: 10,
				toUserId: 20,
				payload: { username: "kame" },
				readAt: null,
				createdAt: new Date("2026-06-27T00:00:00Z"),
			});
			const reloadedWithRelation = makeNotification();

			repo.findOne
				.mockResolvedValueOnce(null) // dedup check — no existing duplicate
				.mockResolvedValueOnce(reloadedWithRelation); // post-save reload for the push
			repo.save.mockResolvedValue(savedWithoutRelation);

			await service.create("friend_request", 10, 20, { username: "kame" });

			expect(repo.findOne).toHaveBeenLastCalledWith({
				where: { id: 1 },
				relations: ["fromUser"],
			});
			expect(mockEmit).toHaveBeenCalledWith(
				"notification:new",
				expect.objectContaining({ fromUsername: "kame" }),
			);
		});

		it("should fall back to the un-related notification without throwing if the reload finds nothing", async () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue(["socket-abc"]);

			const savedWithoutRelation = Object.assign(new Notification(), {
				id: 1,
				type: "friend_request" as const,
				fromUserId: 10,
				toUserId: 20,
				payload: {},
				readAt: null,
				createdAt: new Date("2026-06-27T00:00:00Z"),
			});

			repo.findOne
				.mockResolvedValueOnce(null) // dedup check
				.mockResolvedValueOnce(null); // reload finds nothing (edge case)
			repo.save.mockResolvedValue(savedWithoutRelation);

			await expect(
				service.create("friend_request", 10, 20, {}),
			).resolves.toBeUndefined();
			expect(mockEmit).toHaveBeenCalledWith(
				"notification:new",
				expect.objectContaining({ fromUsername: "" }),
			);
		});
	});

	// ── removeWhere (Bug Audit M9) ─────────────────────────────────────────────

	describe("removeWhere", () => {
		it("should delete matching notifications by (type, from, to)", async () => {
			repo.delete.mockResolvedValue({ affected: 1 });
			repo.find.mockResolvedValue([]);

			await service.removeWhere("friend_request", 10, 20);

			expect(repo.delete).toHaveBeenCalledWith({
				type: "friend_request",
				fromUserId: 10,
				toUserId: 20,
			});
		});

		it("should push a fresh inbox to the recipient's sockets when rows were removed", async () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue(["socket-abc"]);
			repo.delete.mockResolvedValue({ affected: 1 });
			repo.find.mockResolvedValue([]);

			await service.removeWhere("friend_request", 10, 20);

			expect(presence.getSocketIds).toHaveBeenCalledWith(20);
			expect(mockEmit).toHaveBeenCalledWith("notification:inbox", []);
		});

		it("should not push when nothing was removed", async () => {
			service.setServer({ to: jest.fn() } as never);
			repo.delete.mockResolvedValue({ affected: 0 });

			await service.removeWhere("friend_request", 10, 20);

			expect(presence.getSocketIds).not.toHaveBeenCalled();
		});
	});

	// ── listUnread ───────────────────────────────────────────────────────────

	describe("listUnread", () => {
		it("should return mapped NotificationView array for unread notifications", async () => {
			repo.find.mockResolvedValue([makeNotification()]);

			const result = await service.listUnread(20);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: 1,
				type: "friend_request",
				fromUserId: 10,
				fromUsername: "kame",
			});
		});

		it("should return empty array when user has no unread notifications", async () => {
			repo.find.mockResolvedValue([]);

			const result = await service.listUnread(20);

			expect(result).toEqual([]);
		});

		it("should throw InternalServerErrorException when repo.find throws", async () => {
			repo.find.mockRejectedValue(new Error("DB error"));

			await expect(service.listUnread(20)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── markRead ─────────────────────────────────────────────────────────────
	//
	// markRead is a single atomic UPDATE (Bug Audit L5) rather than a
	// findOne+save round trip — mock createQueryBuilder().execute() returning
	// { affected } instead of repo.findOne/save.

	describe("markRead", () => {
		const mockExecute = (affected: number) =>
			repo.createQueryBuilder.mockReturnValue({
				update: jest.fn().mockReturnThis(),
				set: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				execute: jest.fn().mockResolvedValue({ affected }),
			});

		it("should update readAt when the notification belongs to the user and is unread", async () => {
			mockExecute(1);

			await expect(service.markRead(20, 1)).resolves.toBeUndefined();
		});

		it("should throw NotFoundException when nothing matched (wrong user, missing row, or already read)", async () => {
			mockExecute(0);

			await expect(service.markRead(99, 1)).rejects.toThrow(NotFoundException);
		});

		it("should throw InternalServerErrorException when the update query throws", async () => {
			repo.createQueryBuilder.mockReturnValue({
				update: jest.fn().mockReturnThis(),
				set: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				execute: jest.fn().mockRejectedValue(new Error("DB down")),
			});

			await expect(service.markRead(20, 1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});

		it("should push a fresh inbox to every open socket of the user on success (Bug Audit M1)", async () => {
			mockExecute(1);
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue(["socket-abc"]);
			repo.find.mockResolvedValue([]);

			await service.markRead(20, 1);

			expect(presence.getSocketIds).toHaveBeenCalledWith(20);
			expect(mockEmit).toHaveBeenCalledWith("notification:inbox", []);
		});

		it("should not push an inbox when the update finds nothing (NotFoundException case)", async () => {
			mockExecute(0);
			const mockEmit = jest.fn();
			service.setServer({ to: jest.fn().mockReturnValue({ emit: mockEmit }) } as never);

			await expect(service.markRead(99, 1)).rejects.toThrow(NotFoundException);

			expect(presence.getSocketIds).not.toHaveBeenCalled();
		});
	});

	// ── markAllRead ──────────────────────────────────────────────────────────

	describe("markAllRead", () => {
		it("should execute an update query for the given userId", async () => {
			const executeMock = jest.fn().mockResolvedValue(undefined);
			repo.createQueryBuilder.mockReturnValue({
				update: jest.fn().mockReturnThis(),
				set: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				execute: executeMock,
			});
			repo.find.mockResolvedValue([]);

			await service.markAllRead(20);

			expect(executeMock).toHaveBeenCalled();
		});

		it("should throw InternalServerErrorException when query fails", async () => {
			repo.createQueryBuilder.mockReturnValue({
				update: jest.fn().mockReturnThis(),
				set: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				execute: jest.fn().mockRejectedValue(new Error("DB error")),
			});

			await expect(service.markAllRead(20)).rejects.toThrow(
				InternalServerErrorException,
			);
		});

		it("should push a fresh inbox to every open socket of the user on success (Bug Audit M1)", async () => {
			repo.createQueryBuilder.mockReturnValue({
				update: jest.fn().mockReturnThis(),
				set: jest.fn().mockReturnThis(),
				where: jest.fn().mockReturnThis(),
				execute: jest.fn().mockResolvedValue(undefined),
			});
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue(["socket-1", "socket-2"]);
			repo.find.mockResolvedValue([]);

			await service.markAllRead(20);

			expect(presence.getSocketIds).toHaveBeenCalledWith(20);
			expect(mockTo).toHaveBeenCalledTimes(2);
		});
	});

	// ── listUnread cap (Bug Audit L3) ────────────────────────────────────────

	describe("listUnread cap", () => {
		it("should request at most 50 unread rows", async () => {
			repo.find.mockResolvedValue([]);

			await service.listUnread(20);

			expect(repo.find).toHaveBeenCalledWith(
				expect.objectContaining({ take: 50 }),
			);
		});
	});

	// ── toView payload fallback (Bug Audit L1) ──────────────────────────────

	describe("fromUsername fallback", () => {
		it("should fall back to payload.username when the fromUser relation isn't loaded", async () => {
			repo.find.mockResolvedValue([
				makeNotification({
					fromUser: undefined,
					payload: { username: "snapshotted-name" },
				}),
			]);

			const result = await service.listUnread(20);

			expect(result[0].fromUsername).toBe("snapshotted-name");
		});

		it("should fall back to an empty string when neither the relation nor payload.username exist", async () => {
			repo.find.mockResolvedValue([
				makeNotification({ fromUser: undefined, payload: {} }),
			]);

			const result = await service.listUnread(20);

			expect(result[0].fromUsername).toBe("");
		});
	});

	// ── pushLiveEvent (Bug Audit catalog gap — friend_removed) ──────────────

	describe("pushLiveEvent", () => {
		it("should emit the given event to every open socket of the recipient", () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue(["socket-1", "socket-2"]);

			service.pushLiveEvent("friend:removed", 20, { userId: 10 });

			expect(mockTo).toHaveBeenCalledTimes(2);
			expect(mockEmit).toHaveBeenCalledWith("friend:removed", { userId: 10 });
		});

		it("should be a no-op when no server is wired up", () => {
			expect(() =>
				service.pushLiveEvent("friend:removed", 20, { userId: 10 }),
			).not.toThrow();
			expect(presence.getSocketIds).not.toHaveBeenCalled();
		});

		it("should be a no-op when the recipient has no open sockets", () => {
			const mockEmit = jest.fn();
			const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
			service.setServer({ to: mockTo } as never);
			presence.getSocketIds.mockReturnValue([]);

			service.pushLiveEvent("friend:removed", 20, { userId: 10 });

			expect(mockTo).not.toHaveBeenCalled();
		});
	});
});
