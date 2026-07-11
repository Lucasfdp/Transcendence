import { BadRequestException } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService, UnreadConversationView } from "./chat.service";
import { GifService } from "./gif.service";
import { RateLimiterService } from "../auth/rate-limiter.service";

describe("ChatController — GET /chat/unread (Bug B1)", () => {
	let controller: ChatController;
	let chatService: jest.Mocked<ChatService>;
	let gifService: jest.Mocked<GifService>;
	let rateLimiter: jest.Mocked<RateLimiterService>;

	const entries: UnreadConversationView[] = [
		{
			conversationId: 42,
			type: "dm",
			title: "someone",
			preview: "hi",
			lastMessageAt: "2026-07-11T00:00:00.000Z",
		},
	];

	beforeEach(() => {
		chatService = {
			listUnreadConversations: jest.fn().mockResolvedValue(entries),
		} as unknown as jest.Mocked<ChatService>;
		gifService = {} as unknown as jest.Mocked<GifService>;
		rateLimiter = {} as unknown as jest.Mocked<RateLimiterService>;

		controller = new ChatController(chatService, gifService, rateLimiter);
	});

	it("returns the caller's unread digest, scoped to their own id", async () => {
		const result = await controller.listUnread({ user: { id: 7 } });

		expect(chatService.listUnreadConversations).toHaveBeenCalledTimes(1);
		expect(chatService.listUnreadConversations).toHaveBeenCalledWith(7);
		expect(result).toBe(entries);
	});

	it("propagates the service result verbatim (empty digest)", async () => {
		chatService.listUnreadConversations.mockResolvedValueOnce([]);

		const result = await controller.listUnread({ user: { id: 9 } });

		expect(chatService.listUnreadConversations).toHaveBeenCalledWith(9);
		expect(result).toEqual([]);
	});
});

describe("ChatController — GET messages beforeId cursor (Bug B6)", () => {
	let controller: ChatController;
	let chatService: jest.Mocked<ChatService>;

	beforeEach(() => {
		chatService = {
			listMessages: jest.fn().mockResolvedValue([]),
		} as unknown as jest.Mocked<ChatService>;
		controller = new ChatController(
			chatService,
			{} as unknown as jest.Mocked<GifService>,
			{} as unknown as jest.Mocked<RateLimiterService>,
		);
	});

	it("parses a valid beforeId and forwards it to the service", () => {
		controller.listMessages({ user: { id: 3 } }, 10, "42", "20");

		expect(chatService.listMessages).toHaveBeenCalledWith(10, 3, {
			beforeId: 42,
			limit: 20,
		});
	});

	it("forwards an undefined beforeId when the param is omitted", () => {
		controller.listMessages({ user: { id: 3 } }, 10, undefined, undefined);

		expect(chatService.listMessages).toHaveBeenCalledWith(10, 3, {
			beforeId: undefined,
			limit: undefined,
		});
	});

	it.each(["0", "-1", "abc", "1.5"])(
		"rejects an invalid beforeId (%s) with 400",
		(bad) => {
			expect(() =>
				controller.listMessages({ user: { id: 3 } }, 10, bad, undefined),
			).toThrow(BadRequestException);
		},
	);
});

describe("ChatController — group owner routes (Decision 1/2)", () => {
	let controller: ChatController;
	let chatService: jest.Mocked<ChatService>;

	beforeEach(() => {
		chatService = {
			listGroupMembers: jest.fn().mockResolvedValue([]),
			kickMember: jest.fn().mockResolvedValue(undefined),
			renameGroup: jest.fn().mockResolvedValue(undefined),
			deleteGroup: jest.fn().mockResolvedValue(undefined),
		} as unknown as jest.Mocked<ChatService>;
		controller = new ChatController(
			chatService,
			{} as unknown as jest.Mocked<GifService>,
			{} as unknown as jest.Mocked<RateLimiterService>,
		);
	});

	it("listGroupMembers delegates with the caller id", () => {
		controller.listGroupMembers({ user: { id: 7 } }, 10);
		expect(chatService.listGroupMembers).toHaveBeenCalledWith(10, 7);
	});

	it("kickGroupMember delegates actor + target", async () => {
		await controller.kickGroupMember({ user: { id: 7 } }, 10, 3);
		expect(chatService.kickMember).toHaveBeenCalledWith(10, 7, 3);
	});

	it("renameGroup delegates the trimmed-by-service name", async () => {
		await controller.renameGroup({ user: { id: 7 } }, 10, { name: "New Name" });
		expect(chatService.renameGroup).toHaveBeenCalledWith(10, 7, "New Name");
	});

	it("deleteGroup delegates with the caller id", async () => {
		await controller.deleteGroup({ user: { id: 7 } }, 10);
		expect(chatService.deleteGroup).toHaveBeenCalledWith(10, 7);
	});
});
