import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import type { Server } from "socket.io";
import { FriendsService } from "../friends/friends.service";
import { PresenceService } from "../presence/presence.service";
import { User } from "../users/entities/user.entity";
import {
	ChatService,
	chatRoomName,
	WS_EVENT_CHAT_READ_SYNC,
	WS_EVENT_CHAT_UNREAD,
	WS_EVENT_CHAT_UNREAD_INBOX,
} from "./chat.service";
import { Conversation } from "./entities/conversation.entity";
import { ConversationParticipant } from "./entities/conversation-participant.entity";
import { Message, MESSAGE_BODY_MAX_LENGTH } from "./entities/message.entity";
import { GifService } from "./gif.service";

/** Minimal fake EntityManager covering the create/save call shapes ChatService uses. */
const mockEntityManager = () => ({
	create: jest.fn((...args: unknown[]) =>
		args.length === 2 ? args[1] : args[0],
	),
	save: jest.fn(async (...args: unknown[]) => {
		const payload = args.length === 2 ? args[1] : args[0];
		if (Array.isArray(payload)) {
			return payload.map((row, i) => ({ id: i + 1, ...(row as object) }));
		}
		return { id: 1, ...(payload as object) };
	}),
});

const mockConversationRepo = () => {
	// Chainable stub for the conditional denormalise UPDATE in sendMessage
	// (Bug B9). Captures the `.set(...)` payload so tests can assert on it.
	const updateBuilder = {
		update: jest.fn().mockReturnThis(),
		set: jest.fn().mockReturnThis(),
		where: jest.fn().mockReturnThis(),
		andWhere: jest.fn().mockReturnThis(),
		execute: jest.fn().mockResolvedValue({ affected: 1 }),
	};
	const repo: Record<string, jest.Mock> & {
		manager?: { transaction: jest.Mock };
		__updateBuilder?: typeof updateBuilder;
	} = {
		findOne: jest.fn(),
		find: jest.fn(),
		save: jest.fn(async (v) => v),
		create: jest.fn((v) => v),
		delete: jest.fn().mockResolvedValue(undefined),
		createQueryBuilder: jest.fn(() => updateBuilder),
	};
	repo.__updateBuilder = updateBuilder;
	repo.manager = {
		transaction: jest.fn(async (cb: (em: unknown) => Promise<unknown>) =>
			cb(mockEntityManager()),
		),
	};
	return repo;
};

const mockParticipantRepo = () => ({
	findOne: jest.fn(),
	find: jest.fn().mockResolvedValue([]),
	// Default >0 so leaveGroup takes the "members remain" path unless a test
	// opts into the empty-group cleanup branch (Bug Audit M10).
	count: jest.fn().mockResolvedValue(1),
	save: jest.fn(async (v) => v),
	create: jest.fn((v) => v),
	delete: jest.fn().mockResolvedValue(undefined),
});

const mockMessageRepo = () => ({
	findOne: jest.fn(),
	find: jest.fn().mockResolvedValue([]),
	save: jest.fn(async (v) => ({ id: 1, createdAt: new Date("2026-07-04T00:00:00Z"), ...v })),
	create: jest.fn((v) => v),
	delete: jest.fn().mockResolvedValue(undefined),
});

const mockUserRepo = () => ({
	findOne: jest.fn().mockResolvedValue(null),
	find: jest.fn().mockResolvedValue([]),
});

const mockPresence = () => ({
	getSocketIds: jest.fn().mockReturnValue([]),
	isOnline: jest.fn().mockReturnValue(false),
});

/** Defaults to "yes, friends" so existing tests don't all need to opt in explicitly. */
const mockFriendsService = () => ({
	areFriends: jest.fn().mockResolvedValue(true),
});

const mockGifService = () => ({
	search: jest.fn(),
	getBySlug: jest.fn(),
});

/** Minimal fake Socket.IO server exposing only what ChatService touches. */
const mockServer = () => {
	const socketMap = new Map<string, { join: jest.Mock; leave?: jest.Mock }>();
	// Default no-op `to().emit()` so system-message broadcasts (leave / add /
	// kick / rename) don't throw when a test sets a server but doesn't care
	// about the emit. Tests that assert on the emit override `to` explicitly.
	return {
		sockets: { sockets: socketMap },
		to: jest.fn().mockReturnValue({ emit: jest.fn() }),
	};
};

const makeUser = (overrides: Partial<User> = {}): User =>
	Object.assign(new User(), {
		id: 2,
		username: "kame",
		avatar: null,
		...overrides,
	});

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation =>
	Object.assign(new Conversation(), {
		id: 10,
		type: "dm",
		name: null,
		ownerId: null,
		lastMessageAt: null,
		lastMessagePreview: null,
		...overrides,
	});

const makeParticipant = (
	overrides: Partial<ConversationParticipant> = {},
): ConversationParticipant =>
	Object.assign(new ConversationParticipant(), {
		id: 1,
		conversationId: 10,
		userId: 1,
		lastReadAt: null,
		...overrides,
	});

describe("ChatService", () => {
	let service: ChatService;
	let conversationRepo: ReturnType<typeof mockConversationRepo>;
	let participantRepo: ReturnType<typeof mockParticipantRepo>;
	let messageRepo: ReturnType<typeof mockMessageRepo>;
	let userRepo: ReturnType<typeof mockUserRepo>;
	let presence: ReturnType<typeof mockPresence>;
	let friendsService: ReturnType<typeof mockFriendsService>;
	let gifService: ReturnType<typeof mockGifService>;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ChatService,
				{
					provide: getRepositoryToken(Conversation),
					useFactory: mockConversationRepo,
				},
				{
					provide: getRepositoryToken(ConversationParticipant),
					useFactory: mockParticipantRepo,
				},
				{ provide: getRepositoryToken(Message), useFactory: mockMessageRepo },
				{ provide: getRepositoryToken(User), useFactory: mockUserRepo },
				{ provide: PresenceService, useFactory: mockPresence },
				{ provide: FriendsService, useFactory: mockFriendsService },
				{ provide: GifService, useFactory: mockGifService },
			],
		}).compile();

		service = module.get(ChatService);
		conversationRepo = module.get(getRepositoryToken(Conversation));
		participantRepo = module.get(getRepositoryToken(ConversationParticipant));
		messageRepo = module.get(getRepositoryToken(Message));
		userRepo = module.get(getRepositoryToken(User));
		presence = module.get(PresenceService);
		friendsService = module.get(FriendsService);
		gifService = module.get(GifService);
	});

	// ── getOrCreateDirectConversation ───────────────────────────────────────

	describe("getOrCreateDirectConversation", () => {
		it("should throw BadRequestException when messaging yourself", async () => {
			await expect(
				service.getOrCreateDirectConversation(1, 1),
			).rejects.toThrow(BadRequestException);
		});

		it("should return the existing dm conversation when one already exists (by dmKey)", async () => {
			const existingConversation = makeConversation({
				id: 5,
				dmKey: "1:2",
			});
			conversationRepo.findOne.mockResolvedValueOnce(existingConversation);

			const result = await service.getOrCreateDirectConversation(1, 2);

			expect(conversationRepo.findOne).toHaveBeenCalledWith({
				where: { dmKey: "1:2" },
			});
			expect(result.id).toBe(5);
			expect(conversationRepo.manager.transaction).not.toHaveBeenCalled();
		});

		it("should look up the same dmKey regardless of argument order", async () => {
			const existingConversation = makeConversation({
				id: 5,
				dmKey: "1:2",
			});
			conversationRepo.findOne.mockResolvedValueOnce(existingConversation);

			await service.getOrCreateDirectConversation(2, 1);

			expect(conversationRepo.findOne).toHaveBeenCalledWith({
				where: { dmKey: "1:2" },
			});
		});

		it("should return the existing dm conversation even when the users are no longer friends", async () => {
			const existingConversation = makeConversation({
				id: 5,
				dmKey: "1:2",
			});
			conversationRepo.findOne.mockResolvedValueOnce(existingConversation);
			friendsService.areFriends.mockResolvedValueOnce(false);

			const result = await service.getOrCreateDirectConversation(1, 2);

			// An existing dm is a frozen thread, not a deleted one — it's always
			// reachable. The friend check never even runs for this path.
			expect(result.id).toBe(5);
			expect(friendsService.areFriends).not.toHaveBeenCalled();
		});

		it("should throw ForbiddenException when starting a brand-new dm with a non-friend", async () => {
			friendsService.areFriends.mockResolvedValueOnce(false);

			await expect(
				service.getOrCreateDirectConversation(1, 2),
			).rejects.toThrow(ForbiddenException);
			expect(userRepo.findOne).not.toHaveBeenCalled();
			expect(conversationRepo.manager.transaction).not.toHaveBeenCalled();
		});

		it("should throw NotFoundException when the other user does not exist", async () => {
			userRepo.findOne.mockResolvedValueOnce(null);

			await expect(
				service.getOrCreateDirectConversation(1, 999),
			).rejects.toThrow(NotFoundException);
		});

		it("should create a new dm conversation with both participants when none exists", async () => {
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 2 }));

			const result = await service.getOrCreateDirectConversation(1, 2);

			expect(conversationRepo.manager.transaction).toHaveBeenCalled();
			expect(result.type).toBe("dm");
		});

		it("should re-read and return the winner's conversation on a concurrent dmKey race (Bug Audit M3)", async () => {
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 2 }));
			const raceWinner = makeConversation({ id: 7, dmKey: "1:2" });
			// First findOne (the initial lookup) finds nothing; the transaction
			// then fails with a unique-violation because a concurrent call won
			// the race; the retry findOne must return that winner's row.
			conversationRepo.findOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(raceWinner);
			conversationRepo.manager.transaction.mockRejectedValueOnce(
				Object.assign(new Error("duplicate key"), { code: "23505" }),
			);

			const result = await service.getOrCreateDirectConversation(1, 2);

			expect(result).toBe(raceWinner);
			expect(conversationRepo.findOne).toHaveBeenCalledTimes(2);
		});

		it("should rethrow a non-unique-violation error from the transaction", async () => {
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 2 }));
			conversationRepo.findOne.mockResolvedValueOnce(null);
			conversationRepo.manager.transaction.mockRejectedValueOnce(
				new Error("connection lost"),
			);

			await expect(
				service.getOrCreateDirectConversation(1, 2),
			).rejects.toThrow(InternalServerErrorException);
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			conversationRepo.findOne.mockRejectedValueOnce(new Error("DB down"));

			await expect(
				service.getOrCreateDirectConversation(1, 2),
			).rejects.toThrow(InternalServerErrorException);
		});

		it("should join already-connected participants' sockets to the new room", async () => {
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 2 }));
			const server = mockServer();
			const joinMock = jest.fn();
			server.sockets.sockets.set("socket-2", { join: joinMock });
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 2 ? ["socket-2"] : [],
			);
			service.setServer(server as unknown as Server);

			const result = await service.getOrCreateDirectConversation(1, 2);

			expect(joinMock).toHaveBeenCalledWith(chatRoomName(result.id));
		});

		it("should not throw when no server has been wired up yet", async () => {
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 2 }));

			// setServer() was never called — joinLiveParticipants must no-op, not throw.
			await expect(
				service.getOrCreateDirectConversation(1, 2),
			).resolves.toBeDefined();
		});
	});

	// ── createGroup ──────────────────────────────────────────────────────────

	describe("createGroup", () => {
		it("should create a group conversation with owner + members as participants", async () => {
			userRepo.find.mockResolvedValueOnce([
				makeUser({ id: 2 }),
				makeUser({ id: 3 }),
			]);

			const result = await service.createGroup(1, "Turtle Squad", [2, 3]);

			expect(result.type).toBe("group");
			expect(conversationRepo.manager.transaction).toHaveBeenCalled();
		});

		it("should throw BadRequestException when the name is blank", async () => {
			await expect(service.createGroup(1, "   ", [2])).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should throw BadRequestException when there are no other members", async () => {
			await expect(service.createGroup(1, "Solo", [1])).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should de-duplicate member ids and drop the owner if included", async () => {
			userRepo.find.mockResolvedValueOnce([makeUser({ id: 2 })]);

			await service.createGroup(1, "Turtle Squad", [2, 2, 1]);

			// Only one real member (id 2) should have been looked up / required.
			expect(userRepo.find).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ id: expect.anything() }),
				}),
			);
		});

		it("should throw NotFoundException when a member id does not exist", async () => {
			userRepo.find.mockResolvedValueOnce([makeUser({ id: 2 })]); // only 1 of 2 found

			await expect(
				service.createGroup(1, "Turtle Squad", [2, 3]),
			).rejects.toThrow(NotFoundException);
		});

		it("should throw ForbiddenException when the owner is not friends with a member being added", async () => {
			userRepo.find.mockResolvedValueOnce([
				makeUser({ id: 2 }),
				makeUser({ id: 3 }),
			]);
			friendsService.areFriends.mockImplementation(
				async (_ownerId: number, memberId: number) => memberId !== 3,
			);

			await expect(
				service.createGroup(1, "Turtle Squad", [2, 3]),
			).rejects.toThrow(ForbiddenException);
			expect(conversationRepo.manager.transaction).not.toHaveBeenCalled();
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			userRepo.find.mockRejectedValueOnce(new Error("DB down"));

			await expect(
				service.createGroup(1, "Turtle Squad", [2]),
			).rejects.toThrow(InternalServerErrorException);
		});

		it("should join already-connected members' sockets to the new group room", async () => {
			userRepo.find.mockResolvedValueOnce([makeUser({ id: 2 })]);
			const server = mockServer();
			const joinMock = jest.fn();
			server.sockets.sockets.set("socket-2", { join: joinMock });
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 2 ? ["socket-2"] : [],
			);
			service.setServer(server as unknown as Server);

			const result = await service.createGroup(1, "Turtle Squad", [2]);

			expect(joinMock).toHaveBeenCalledWith(chatRoomName(result.id));
		});
	});

	// ── addGroupMember ───────────────────────────────────────────────────────

	describe("addGroupMember", () => {
		it("should add a friend as a new participant on the happy path", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne
				.mockResolvedValueOnce(makeParticipant({ userId: 1 })) // actor's membership
				.mockResolvedValueOnce(null); // new member not already present
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 3 }));

			await service.addGroupMember(10, 1, 3);

			expect(participantRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ conversationId: 10, userId: 3 }),
			);
		});

		it("should throw NotFoundException when the conversation does not exist", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.addGroupMember(10, 1, 3)).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw BadRequestException when the conversation is a dm, not a group", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "dm" }),
			);

			await expect(service.addGroupMember(10, 1, 3)).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should throw ForbiddenException when the actor is not a participant", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.addGroupMember(10, 1, 3)).rejects.toThrow(
				ForbiddenException,
			);
		});

		it("should throw ConflictException when the user is already a member", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne
				.mockResolvedValueOnce(makeParticipant({ userId: 1 }))
				.mockResolvedValueOnce(makeParticipant({ userId: 3 }));

			await expect(service.addGroupMember(10, 1, 3)).rejects.toThrow(
				ConflictException,
			);
		});

		it("should throw NotFoundException when the new member does not exist", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne
				.mockResolvedValueOnce(makeParticipant({ userId: 1 }))
				.mockResolvedValueOnce(null);
			userRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.addGroupMember(10, 1, 999)).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw ForbiddenException when the actor is not friends with the new member", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne
				.mockResolvedValueOnce(makeParticipant({ userId: 1 }))
				.mockResolvedValueOnce(null);
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 3 }));
			friendsService.areFriends.mockResolvedValueOnce(false);

			await expect(service.addGroupMember(10, 1, 3)).rejects.toThrow(
				ForbiddenException,
			);
			expect(participantRepo.save).not.toHaveBeenCalled();
		});

		it("should join the new member's already-connected sockets to the room", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne
				.mockResolvedValueOnce(makeParticipant({ userId: 1 }))
				.mockResolvedValueOnce(null);
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 3 }));
			const server = mockServer();
			const joinMock = jest.fn();
			server.sockets.sockets.set("socket-3", { join: joinMock });
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 3 ? ["socket-3"] : [],
			);
			service.setServer(server as unknown as Server);

			await service.addGroupMember(10, 1, 3);

			expect(joinMock).toHaveBeenCalledWith(chatRoomName(10));
		});

		it("should post a system message, denormalise it, and broadcast to the room (Bug B4)", async () => {
			const conversation = makeConversation({ type: "group" });
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne
				.mockResolvedValueOnce(makeParticipant({ userId: 1 })) // actor
				.mockResolvedValueOnce(null); // new member not present
			userRepo.findOne
				.mockResolvedValueOnce(makeUser({ id: 3, username: "newbie" })) // new member
				.mockResolvedValueOnce(makeUser({ id: 1, username: "actor" })); // actor lookup
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			service.setServer(server as unknown as Server);

			await service.addGroupMember(10, 1, 3);

			expect(messageRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					conversationId: 10,
					senderId: 1,
					type: "system",
					body: "actor added newbie",
				}),
			);
			// Denormalised onto the conversation for list sorting / unread derivation.
			expect(conversation.lastMessageAt).toBeInstanceOf(Date);
			expect(conversation.lastMessagePreview).toBe("actor added newbie");
			expect(conversationRepo.save).toHaveBeenCalledWith(conversation);
			// Broadcast to the room so existing members and the new member's
			// just-joined sockets both receive it.
			expect(server.to).toHaveBeenCalledWith(chatRoomName(10));
			expect(roomEmit).toHaveBeenCalledWith(
				"chat:message",
				expect.objectContaining({ type: "system", body: "actor added newbie" }),
			);
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			conversationRepo.findOne.mockRejectedValueOnce(new Error("DB down"));

			await expect(service.addGroupMember(10, 1, 3)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── leaveGroup ───────────────────────────────────────────────────────────

	describe("leaveGroup", () => {
		it("should remove the participant and post a system message on the happy path", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 1, username: "kame" }));

			await service.leaveGroup(10, 1);

			expect(participantRepo.delete).toHaveBeenCalledWith({
				conversationId: 10,
				userId: 1,
			});
			expect(messageRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					body: "kame left the group",
				}),
			);
			expect(conversationRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ lastMessagePreview: "kame left the group" }),
			);
		});

		it("should broadcast the system message to the room when a server is wired up", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 1, username: "kame" }));
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			service.setServer(server as unknown as Server);

			await service.leaveGroup(10, 1);

			expect(server.to).toHaveBeenCalledWith(chatRoomName(10));
			expect(roomEmit).toHaveBeenCalledWith(
				"chat:message",
				expect.objectContaining({ body: "kame left the group" }),
			);
		});

		it("should remove the leaving user's connected sockets from the room", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 1, username: "kame" }));
			const server = {
				...mockServer(),
				to: jest.fn().mockReturnValue({ emit: jest.fn() }),
			};
			const leaveMock = jest.fn();
			server.sockets.sockets.set("socket-1", { join: jest.fn(), leave: leaveMock });
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 1 ? ["socket-1"] : [],
			);
			service.setServer(server as unknown as Server);

			await service.leaveGroup(10, 1);

			expect(leaveMock).toHaveBeenCalledWith(chatRoomName(10));
		});

		it("should not throw when no server has been wired up yet", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 1, username: "kame" }));

			await expect(service.leaveGroup(10, 1)).resolves.toBeUndefined();
		});

		it("should delete the conversation and its messages when the last member leaves (Bug Audit M10)", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 1, username: "kame" }));
			// No participants remain after this leave.
			participantRepo.count.mockResolvedValueOnce(0);

			await service.leaveGroup(10, 1);

			expect(messageRepo.delete).toHaveBeenCalledWith({ conversationId: 10 });
			expect(conversationRepo.delete).toHaveBeenCalledWith({ id: 10 });
			// No farewell system message when nobody is left to see it.
			expect(messageRepo.save).not.toHaveBeenCalled();
		});

		it("should throw NotFoundException when the conversation does not exist", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.leaveGroup(10, 1)).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw BadRequestException when the conversation is a dm, not a group", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "dm" }),
			);

			await expect(service.leaveGroup(10, 1)).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should throw ForbiddenException when the user is not a participant", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group" }),
			);
			participantRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.leaveGroup(10, 1)).rejects.toThrow(
				ForbiddenException,
			);
			expect(participantRepo.delete).not.toHaveBeenCalled();
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			conversationRepo.findOne.mockRejectedValueOnce(new Error("DB down"));

			await expect(service.leaveGroup(10, 1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── leaveGroup ownership transfer (Decision 1) ─────────────────────────────

	describe("leaveGroup — ownership transfer", () => {
		it("should transfer ownership to the most senior remaining member when the owner leaves", async () => {
			const conversation = makeConversation({ type: "group", ownerId: 1 });
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne
				.mockResolvedValueOnce(makeParticipant({ userId: 1 })) // leaver's membership
				.mockResolvedValueOnce(makeParticipant({ id: 2, userId: 2 })); // successor
			userRepo.findOne
				.mockResolvedValueOnce(makeUser({ id: 1, username: "owner" })) // leaver
				.mockResolvedValueOnce(makeUser({ id: 2, username: "successor" })); // new owner
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			service.setServer(server as unknown as Server);

			await service.leaveGroup(10, 1);

			expect(conversation.ownerId).toBe(2);
			// Successor is chosen by seniority (joinedAt ASC, id ASC).
			expect(participantRepo.findOne).toHaveBeenLastCalledWith({
				where: { conversationId: 10 },
				order: { joinedAt: "ASC", id: "ASC" },
			});
			expect(messageRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					body: "successor is now the group owner",
				}),
			);
			// The successor's clients get the new ownerId live (Decision 1).
			expect(roomEmit).toHaveBeenCalledWith("chat:conversation-updated", {
				conversationId: 10,
				ownerId: 2,
			});
		});

		it("should NOT transfer ownership when a non-owner leaves", async () => {
			const conversation = makeConversation({ type: "group", ownerId: 99 });
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 1, username: "member" }));

			await service.leaveGroup(10, 1);

			expect(conversation.ownerId).toBe(99);
			// Only the leaver-membership lookup ran — no successor query.
			expect(participantRepo.findOne).toHaveBeenCalledTimes(1);
		});
	});

	// ── kickMember (Decision 1) ────────────────────────────────────────────────

	describe("kickMember", () => {
		it("should remove the member, post a system message, and push chat:removed on the happy path", async () => {
			const conversation = makeConversation({ type: "group", ownerId: 1 });
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(
				makeParticipant({ userId: 2 }),
			);
			userRepo.findOne
				.mockResolvedValueOnce(makeUser({ id: 1, username: "owner" }))
				.mockResolvedValueOnce(makeUser({ id: 2, username: "kicked" }));
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			presence.getSocketIds.mockReturnValue(["socket-2"]);
			service.setServer(server as unknown as Server);

			await service.kickMember(10, 1, 2);

			expect(participantRepo.delete).toHaveBeenCalledWith({
				conversationId: 10,
				userId: 2,
			});
			expect(messageRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					body: "owner removed kicked",
				}),
			);
			expect(roomEmit).toHaveBeenCalledWith("chat:removed", { conversationId: 10 });
		});

		it("should throw ForbiddenException when the caller is not the owner", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 99 }),
			);

			await expect(service.kickMember(10, 1, 2)).rejects.toThrow(
				ForbiddenException,
			);
			expect(participantRepo.delete).not.toHaveBeenCalled();
		});

		it("should throw NotFoundException when the conversation is not a group", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "dm" }),
			);

			await expect(service.kickMember(10, 1, 2)).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw BadRequestException when the owner tries to kick themselves", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 1 }),
			);

			await expect(service.kickMember(10, 1, 1)).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should throw NotFoundException when the target is not a member", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 1 }),
			);
			participantRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.kickMember(10, 1, 2)).rejects.toThrow(
				NotFoundException,
			);
			expect(participantRepo.delete).not.toHaveBeenCalled();
		});
	});

	// ── renameGroup (Decision 1) ───────────────────────────────────────────────

	describe("renameGroup", () => {
		it("should rename, post a system message, and broadcast conversation-updated", async () => {
			const conversation = makeConversation({ type: "group", ownerId: 1 });
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			userRepo.findOne.mockResolvedValueOnce(makeUser({ id: 1, username: "owner" }));
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			service.setServer(server as unknown as Server);

			await service.renameGroup(10, 1, "  Shell Squad  ");

			expect(conversation.name).toBe("Shell Squad");
			expect(messageRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					body: "owner renamed the group to Shell Squad",
				}),
			);
			expect(roomEmit).toHaveBeenCalledWith("chat:conversation-updated", {
				conversationId: 10,
				name: "Shell Squad",
			});
		});

		it("should throw BadRequestException for a blank name (before touching the repo)", async () => {
			await expect(service.renameGroup(10, 1, "   ")).rejects.toThrow(
				BadRequestException,
			);
			expect(conversationRepo.findOne).not.toHaveBeenCalled();
		});

		it("should throw ForbiddenException when the caller is not the owner", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 99 }),
			);

			await expect(service.renameGroup(10, 1, "New")).rejects.toThrow(
				ForbiddenException,
			);
		});
	});

	// ── deleteGroup (Decision 1) ───────────────────────────────────────────────

	describe("deleteGroup", () => {
		it("should delete messages + conversation and push chat:removed to every member", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 1 }),
			);
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({ userId: 1 }),
				makeParticipant({ id: 2, userId: 2 }),
			]);
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			presence.getSocketIds.mockImplementation((uid: number) => [`socket-${uid}`]);
			service.setServer(server as unknown as Server);

			await service.deleteGroup(10, 1);

			expect(messageRepo.delete).toHaveBeenCalledWith({ conversationId: 10 });
			expect(conversationRepo.delete).toHaveBeenCalledWith({ id: 10 });
			expect(roomEmit).toHaveBeenCalledWith("chat:removed", { conversationId: 10 });
			// One chat:removed per member.
			expect(
				roomEmit.mock.calls.filter((c) => c[0] === "chat:removed"),
			).toHaveLength(2);
		});

		it("should throw ForbiddenException when the caller is not the owner", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 99 }),
			);

			await expect(service.deleteGroup(10, 1)).rejects.toThrow(
				ForbiddenException,
			);
			expect(conversationRepo.delete).not.toHaveBeenCalled();
		});
	});

	// ── listGroupMembers (Decision 2) ──────────────────────────────────────────

	describe("listGroupMembers", () => {
		it("should return members ordered by seniority with an isOwner flag", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 1 }),
			);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({
					userId: 1,
					joinedAt: new Date("2026-07-01T00:00:00Z"),
					user: makeUser({ id: 1, username: "owner", level: 9 }),
				}),
				makeParticipant({
					id: 2,
					userId: 2,
					joinedAt: new Date("2026-07-02T00:00:00Z"),
					user: makeUser({ id: 2, username: "member" }),
				}),
			]);
			presence.isOnline.mockImplementation((uid: number) => uid === 2);

			const result = await service.listGroupMembers(10, 1);

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				userId: 1,
				username: "owner",
				isOwner: true,
				isOnline: false,
				joinedAt: "2026-07-01T00:00:00.000Z",
			});
			expect(result[1]).toMatchObject({
				userId: 2,
				isOwner: false,
				isOnline: true,
			});
		});

		it("should throw ForbiddenException when the caller is not a participant", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "group", ownerId: 1 }),
			);
			participantRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.listGroupMembers(10, 3)).rejects.toThrow(
				ForbiddenException,
			);
		});

		it("should throw NotFoundException when the conversation is not a group", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(
				makeConversation({ type: "dm" }),
			);

			await expect(service.listGroupMembers(10, 1)).rejects.toThrow(
				NotFoundException,
			);
		});
	});

	// ── sendMessage ──────────────────────────────────────────────────────────

	describe("sendMessage", () => {
		it("should persist a message and update the conversation preview on the happy path", async () => {
			const conversation = makeConversation();
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "text",
					body: "hey",
					metadata: null,
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);

			const result = await service.sendMessage(10, 1, "hey");

			expect(result.body).toBe("hey");
			expect(result.senderUsername).toBe("kame");
			// Denormalise now goes through a conditional UPDATE (Bug B9), not a
			// full entity save, so an out-of-order concurrent write can't regress
			// the preview/timestamp.
			expect(conversationRepo.save).not.toHaveBeenCalled();
			expect(conversationRepo.__updateBuilder?.set).toHaveBeenCalledWith(
				expect.objectContaining({ lastMessagePreview: "hey" }),
			);
			expect(conversationRepo.__updateBuilder?.andWhere).toHaveBeenCalledWith(
				expect.stringContaining("lastMessageAt"),
				expect.objectContaining({ ts: expect.any(Date) }),
			);
		});

		it("should guard the denormalise UPDATE on the message timestamp so an older write can't regress a newer one (Bug B9)", async () => {
			const conversation = makeConversation();
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.findOne.mockResolvedValueOnce(null); // sender reload (falls back)
			const savedAt = new Date("2026-07-04T00:00:00Z");
			// messageRepo.save stamps createdAt = 2026-07-04 (see mock default).

			await service.sendMessage(10, 1, "hey");

			// The WHERE clause only lets the row advance (lastMessageAt <= :ts),
			// keyed on THIS message's timestamp, so a concurrent send that already
			// wrote a newer timestamp is not clobbered by this out-of-order write.
			expect(conversationRepo.__updateBuilder?.where).toHaveBeenCalledWith(
				"id = :id",
				{ id: 10 },
			);
			expect(conversationRepo.__updateBuilder?.andWhere).toHaveBeenCalledWith(
				expect.stringMatching(/lastMessageAt.*IS NULL.*lastMessageAt.*<=/s),
				{ ts: savedAt },
			);
			expect(conversationRepo.__updateBuilder?.execute).toHaveBeenCalledTimes(1);
		});

		it("should fall back to the un-related message when the sender reload fails", async () => {
			const conversation = makeConversation();
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.findOne.mockRejectedValueOnce(new Error("DB down"));

			const result = await service.sendMessage(10, 1, "hey");

			// No sender relation available — "Someone" fallback rather than a
			// blank username or a thrown error (Bug Audit L8).
			expect(result.body).toBe("hey");
			expect(result.senderUsername).toBe("Someone");
		});

		it("should throw BadRequestException when the body is empty", async () => {
			await expect(service.sendMessage(10, 1, "   ")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should throw BadRequestException when the body exceeds the max length", async () => {
			const tooLong = "a".repeat(MESSAGE_BODY_MAX_LENGTH + 1);
			await expect(service.sendMessage(10, 1, tooLong)).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should throw NotFoundException when the conversation does not exist", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.sendMessage(999, 1, "hey")).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw ForbiddenException when the sender is not a participant", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(makeConversation());
			participantRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.sendMessage(10, 1, "hey")).rejects.toThrow(
				ForbiddenException,
			);
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			conversationRepo.findOne.mockRejectedValueOnce(new Error("DB down"));

			await expect(service.sendMessage(10, 1, "hey")).rejects.toThrow(
				InternalServerErrorException,
			);
		});

		it("should throw ForbiddenException in a dm when sender and recipient are no longer friends", async () => {
			conversationRepo.findOne.mockResolvedValueOnce(makeConversation({ type: "dm" }));
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 })); // sender's own membership
			participantRepo.find.mockResolvedValueOnce([makeParticipant({ userId: 2 })]); // the other participant
			friendsService.areFriends.mockResolvedValueOnce(false);

			await expect(service.sendMessage(10, 1, "hey")).rejects.toThrow(
				ForbiddenException,
			);
			expect(messageRepo.save).not.toHaveBeenCalled();
		});

		it("should allow sending in a group even when sender and another member are not friends", async () => {
			const conversation = makeConversation({ type: "group" });
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			friendsService.areFriends.mockResolvedValueOnce(false);
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "text",
					body: "hey",
					metadata: null,
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);

			const result = await service.sendMessage(10, 1, "hey");

			// Groups are unaffected by blocks/unfriending between two members —
			// the friend re-check should never even run for group sends.
			expect(result.body).toBe("hey");
			expect(friendsService.areFriends).not.toHaveBeenCalled();
			// A group send only does one participant lookup (the sender's own
			// membership) — no "other participant" lookup like dm's need.
			expect(participantRepo.findOne).toHaveBeenCalledTimes(1);
		});

		it("should push chat:unread to a dm recipient who was fully caught up before this message", async () => {
			const conversation = makeConversation({
				type: "dm",
				lastMessageAt: new Date("2026-07-01T00:00:00Z"),
			});
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({
					userId: 2,
					lastReadAt: new Date("2026-07-02T00:00:00Z"), // caught up before this send
				}),
			]);
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "text",
					body: "hey",
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 2 ? ["socket-2"] : [],
			);
			service.setServer(server as unknown as Server);

			await service.sendMessage(10, 1, "hey");

			expect(server.to).toHaveBeenCalledWith("socket-2");
			expect(roomEmit).toHaveBeenCalledWith(
				WS_EVENT_CHAT_UNREAD,
				expect.objectContaining({ conversationId: 10, title: "kame" }),
			);
		});

		it("should not push chat:unread to a recipient who already had unread messages", async () => {
			const conversation = makeConversation({
				type: "dm",
				lastMessageAt: new Date("2026-07-01T00:00:00Z"),
			});
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({
					userId: 2,
					lastReadAt: new Date("2026-06-01T00:00:00Z"), // already behind before this send
				}),
			]);
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "text",
					body: "hey",
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 2 ? ["socket-2"] : [],
			);
			service.setServer(server as unknown as Server);

			await service.sendMessage(10, 1, "hey");

			expect(roomEmit).not.toHaveBeenCalled();
		});

		it("should push chat:unread to every caught-up group member, titled with the group's name", async () => {
			const conversation = makeConversation({
				type: "group",
				name: "Turtle Squad",
				lastMessageAt: new Date("2026-07-01T00:00:00Z"),
			});
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({ userId: 2, lastReadAt: new Date("2026-07-02T00:00:00Z") }), // caught up
				makeParticipant({ userId: 3, lastReadAt: new Date("2026-06-01T00:00:00Z") }), // already behind
			]);
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "text",
					body: "hey",
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 2 ? ["socket-2"] : userId === 3 ? ["socket-3"] : [],
			);
			service.setServer(server as unknown as Server);

			await service.sendMessage(10, 1, "hey");

			expect(server.to).toHaveBeenCalledWith("socket-2");
			expect(server.to).not.toHaveBeenCalledWith("socket-3");
			expect(roomEmit).toHaveBeenCalledWith(
				WS_EVENT_CHAT_UNREAD,
				expect.objectContaining({ title: "Turtle Squad" }),
			);
		});

		it("should not throw when sending with no server wired up yet", async () => {
			const conversation = makeConversation();
			conversationRepo.findOne.mockResolvedValueOnce(conversation);
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "text",
					body: "hey",
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);

			await expect(service.sendMessage(10, 1, "hey")).resolves.toBeDefined();
		});
	});

	// ── sendGifMessage ───────────────────────────────────────────────────────

	describe("sendGifMessage", () => {
		const gif = {
			slug: "hello-hi-662",
			title: "Hello",
			url: "https://static.klipy.com/ii/abc/def/md.gif",
			previewUrl: "https://static.klipy.com/ii/abc/def/xs.gif",
			width: 498,
			height: 498,
		};

		it("should resolve the slug via GifService and persist it as a trusted gif message", async () => {
			gifService.getBySlug.mockResolvedValueOnce(gif);
			conversationRepo.findOne.mockResolvedValueOnce(makeConversation());
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "gif",
					body: "Hello",
					metadata: {
						provider: "klipy",
						slug: gif.slug,
						url: gif.url,
						previewUrl: gif.previewUrl,
						width: gif.width,
						height: gif.height,
					},
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);

			const result = await service.sendGifMessage(10, 1, gif.slug);

			expect(gifService.getBySlug).toHaveBeenCalledWith(gif.slug);
			expect(result.type).toBe("gif");
			expect(result.body).toBe("Hello");
			expect(result.metadata).toEqual({
				provider: "klipy",
				slug: gif.slug,
				url: gif.url,
				previewUrl: gif.previewUrl,
				width: gif.width,
				height: gif.height,
			});
			expect(messageRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({ type: "gif", body: "Hello" }),
			);
		});

		it("should fall back to 'GIF' as the body when the title is blank", async () => {
			gifService.getBySlug.mockResolvedValueOnce({ ...gif, title: "   " });
			conversationRepo.findOne.mockResolvedValueOnce(makeConversation());
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.findOne.mockResolvedValueOnce(
				Object.assign(new Message(), {
					id: 1,
					conversationId: 10,
					senderId: 1,
					type: "gif",
					body: "GIF",
					createdAt: new Date("2026-07-04T00:00:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			);

			const result = await service.sendGifMessage(10, 1, gif.slug);

			expect(messageRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({ body: "GIF" }),
			);
			expect(result.body).toBe("GIF");
		});

		it("should propagate NotFoundException when the slug does not resolve", async () => {
			gifService.getBySlug.mockRejectedValueOnce(new NotFoundException("GIF not found"));

			await expect(service.sendGifMessage(10, 1, "missing-slug")).rejects.toThrow(
				NotFoundException,
			);
			expect(messageRepo.save).not.toHaveBeenCalled();
		});

		it("should still enforce dm friend-gating (inherited from sendMessage)", async () => {
			gifService.getBySlug.mockResolvedValueOnce(gif);
			conversationRepo.findOne.mockResolvedValueOnce(makeConversation({ type: "dm" }));
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant({ userId: 1 }));
			participantRepo.find.mockResolvedValueOnce([makeParticipant({ userId: 2 })]);
			friendsService.areFriends.mockResolvedValueOnce(false);

			await expect(service.sendGifMessage(10, 1, gif.slug)).rejects.toThrow(
				ForbiddenException,
			);
			expect(messageRepo.save).not.toHaveBeenCalled();
		});
	});

	// ── listConversations ────────────────────────────────────────────────────

	describe("listConversations", () => {
		it("should return an empty array when the user has no conversations", async () => {
			participantRepo.find.mockResolvedValueOnce([]);

			const result = await service.listConversations(1);

			expect(result).toEqual([]);
		});

		it("should return dm conversations with the other participant's identity, most recent first", async () => {
			const older = makeConversation({
				id: 1,
				lastMessageAt: new Date("2026-07-01T00:00:00Z"),
				lastMessagePreview: "old",
			});
			const newer = makeConversation({
				id: 2,
				lastMessageAt: new Date("2026-07-03T00:00:00Z"),
				lastMessagePreview: "new",
			});

			participantRepo.find
				.mockResolvedValueOnce([
					makeParticipant({ conversationId: 1, userId: 1, conversation: older }),
					makeParticipant({ conversationId: 2, userId: 1, conversation: newer }),
				])
				.mockResolvedValueOnce([
					makeParticipant({ conversationId: 1, userId: 1, conversation: older }),
					makeParticipant({
						conversationId: 1,
						userId: 2,
						conversation: older,
						user: makeUser({ id: 2, username: "old-friend" }),
					}),
					makeParticipant({ conversationId: 2, userId: 1, conversation: newer }),
					makeParticipant({
						conversationId: 2,
						userId: 3,
						conversation: newer,
						user: makeUser({ id: 3, username: "new-friend" }),
					}),
				]);

			const result = await service.listConversations(1);

			expect(result.map((c) => c.id)).toEqual([2, 1]);
			expect(result[0].name).toBe("new-friend");
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			participantRepo.find.mockRejectedValueOnce(new Error("DB down"));

			await expect(service.listConversations(1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── listUnreadConversations ──────────────────────────────────────────────

	describe("listUnreadConversations", () => {
		it("should include a conversation that has never been read but has a message", async () => {
			const conversation = makeConversation({
				id: 1,
				lastMessageAt: new Date("2026-07-04T00:00:00Z"),
				lastMessagePreview: "hey",
			});
			participantRepo.find
				.mockResolvedValueOnce([
					makeParticipant({ conversationId: 1, userId: 1, conversation, lastReadAt: null }),
				])
				.mockResolvedValueOnce([
					makeParticipant({ conversationId: 1, userId: 1, conversation }),
					makeParticipant({
						conversationId: 1,
						userId: 2,
						conversation,
						user: makeUser({ id: 2, username: "kame" }),
					}),
				]);

			const result = await service.listUnreadConversations(1);

			expect(result).toHaveLength(1);
			expect(result[0].title).toBe("kame");
		});

		it("should include a conversation whose last message arrived after it was last read", async () => {
			const conversation = makeConversation({
				id: 1,
				lastMessageAt: new Date("2026-07-04T00:00:00Z"),
			});
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({
					conversationId: 1,
					userId: 1,
					conversation,
					lastReadAt: new Date("2026-07-01T00:00:00Z"),
				}),
			]);
			participantRepo.find.mockResolvedValueOnce([]);

			const result = await service.listUnreadConversations(1);

			expect(result).toHaveLength(1);
		});

		it("should exclude a conversation with no messages yet", async () => {
			const conversation = makeConversation({ id: 1, lastMessageAt: null });
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({ conversationId: 1, userId: 1, conversation }),
			]);

			const result = await service.listUnreadConversations(1);

			expect(result).toEqual([]);
		});

		it("should exclude a conversation that has already been fully read", async () => {
			const conversation = makeConversation({
				id: 1,
				lastMessageAt: new Date("2026-07-01T00:00:00Z"),
			});
			participantRepo.find.mockResolvedValueOnce([
				makeParticipant({
					conversationId: 1,
					userId: 1,
					conversation,
					lastReadAt: new Date("2026-07-02T00:00:00Z"),
				}),
			]);

			const result = await service.listUnreadConversations(1);

			expect(result).toEqual([]);
		});

		it("should return an empty array when the user has no participations", async () => {
			participantRepo.find.mockResolvedValueOnce([]);

			const result = await service.listUnreadConversations(1);

			expect(result).toEqual([]);
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			participantRepo.find.mockRejectedValueOnce(new Error("DB down"));

			await expect(service.listUnreadConversations(1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── pushUnreadInboxToSocket ───────────────────────────────────────────────

	describe("pushUnreadInboxToSocket", () => {
		it("should emit the unread digest to the given socket", async () => {
			const conversation = makeConversation({
				id: 1,
				lastMessageAt: new Date("2026-07-04T00:00:00Z"),
			});
			participantRepo.find
				.mockResolvedValueOnce([
					makeParticipant({ conversationId: 1, userId: 1, conversation }),
				])
				.mockResolvedValueOnce([]);
			const roomEmit = jest.fn();
			const server = {
				...mockServer(),
				to: jest.fn().mockReturnValue({ emit: roomEmit }),
			};
			service.setServer(server as unknown as Server);

			await service.pushUnreadInboxToSocket("socket-1", 1);

			expect(server.to).toHaveBeenCalledWith("socket-1");
			expect(roomEmit).toHaveBeenCalledWith(
				WS_EVENT_CHAT_UNREAD_INBOX,
				expect.arrayContaining([expect.objectContaining({ conversationId: 1 })]),
			);
		});

		it("should do nothing when no server has been wired up yet", async () => {
			await expect(
				service.pushUnreadInboxToSocket("socket-1", 1),
			).resolves.toBeUndefined();
			expect(participantRepo.find).not.toHaveBeenCalled();
		});

		it("should not throw when listUnreadConversations fails (non-fatal)", async () => {
			participantRepo.find.mockRejectedValueOnce(new Error("DB down"));
			service.setServer(mockServer() as unknown as Server);

			await expect(
				service.pushUnreadInboxToSocket("socket-1", 1),
			).resolves.toBeUndefined();
		});
	});

	// ── listMessages ─────────────────────────────────────────────────────────

	describe("listMessages", () => {
		it("should return messages for a participant, newest first", async () => {
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.find.mockResolvedValueOnce([
				Object.assign(new Message(), {
					id: 2,
					conversationId: 10,
					senderId: 1,
					type: "text",
					body: "second",
					metadata: null,
					createdAt: new Date("2026-07-04T00:01:00Z"),
					sender: makeUser({ id: 1, username: "kame" }),
				}),
			]);

			const result = await service.listMessages(10, 1);

			expect(result).toHaveLength(1);
			expect(result[0].body).toBe("second");
		});

		it("should throw ForbiddenException when the requester is not a participant", async () => {
			participantRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.listMessages(10, 1)).rejects.toThrow(
				ForbiddenException,
			);
		});

		it("should filter by the 'beforeId' cursor and order by id when paginating older messages (Bug B6)", async () => {
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			messageRepo.find.mockResolvedValueOnce([]);

			await service.listMessages(10, 1, { beforeId: 42, limit: 10 });

			expect(messageRepo.find).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ conversationId: 10 }),
					// Ordered by the monotonic serial id, not createdAt, so ties can't
					// make paging nondeterministic.
					order: { id: "DESC" },
					take: 10,
				}),
			);
			const callArg = messageRepo.find.mock.calls[0][0] as {
				where: { id: { value: number } };
			};
			// LessThan() returns a FindOperator — assert it carries the id cursor.
			expect(callArg.where.id.value).toBe(42);
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			participantRepo.findOne.mockRejectedValueOnce(new Error("DB down"));

			await expect(service.listMessages(10, 1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});
	});

	// ── markRead ─────────────────────────────────────────────────────────────

	describe("markRead", () => {
		it("should set lastReadAt to now on the happy path", async () => {
			const participant = makeParticipant({ lastReadAt: null });
			participantRepo.findOne.mockResolvedValueOnce(participant);

			await service.markRead(10, 1);

			expect(participantRepo.save).toHaveBeenCalledWith(
				expect.objectContaining({ lastReadAt: expect.any(Date) }),
			);
		});

		it("should throw ForbiddenException when the user is not a participant", async () => {
			participantRepo.findOne.mockResolvedValueOnce(null);

			await expect(service.markRead(10, 1)).rejects.toThrow(
				ForbiddenException,
			);
		});

		it("should throw InternalServerErrorException when the repository fails", async () => {
			participantRepo.findOne.mockRejectedValueOnce(new Error("DB down"));

			await expect(service.markRead(10, 1)).rejects.toThrow(
				InternalServerErrorException,
			);
		});

		it("should push chat:read-sync to every one of the user's connected sockets", async () => {
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());
			const roomEmit = jest.fn();
			const server = { ...mockServer(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
			presence.getSocketIds.mockImplementation((userId: number) =>
				userId === 1 ? ["socket-1", "socket-1b"] : [],
			);
			service.setServer(server as unknown as Server);

			await service.markRead(10, 1);

			expect(server.to).toHaveBeenCalledWith("socket-1");
			expect(server.to).toHaveBeenCalledWith("socket-1b");
			expect(roomEmit).toHaveBeenCalledWith(
				WS_EVENT_CHAT_READ_SYNC,
				{ conversationId: 10 },
			);
		});

		it("should not throw when no server has been wired up yet", async () => {
			participantRepo.findOne.mockResolvedValueOnce(makeParticipant());

			await expect(service.markRead(10, 1)).resolves.toBeUndefined();
		});
	});
});
