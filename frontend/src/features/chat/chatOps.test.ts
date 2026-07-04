import { describe, expect, it } from "vitest";
import type { ConversationSummaryView } from "../hub/api";
import {
	addUnread,
	conversationTitle,
	parseGifMetadata,
	removeUnread,
	sortConversationsByRecency,
	unreadIdsFromInbox,
	upsertConversationPreview,
} from "./chatOps";

const makeConversation = (
	overrides: Partial<ConversationSummaryView> = {},
): ConversationSummaryView => ({
	id: 1,
	type: "dm",
	name: "kame",
	otherUserId: 2,
	avatar: null,
	lastMessageAt: null,
	lastMessagePreview: null,
	...overrides,
});

describe("sortConversationsByRecency", () => {
	it("should order conversations most-recent-first", () => {
		const older = makeConversation({ id: 1, lastMessageAt: "2026-07-01T00:00:00Z" });
		const newer = makeConversation({ id: 2, lastMessageAt: "2026-07-03T00:00:00Z" });

		expect(sortConversationsByRecency([older, newer]).map((c) => c.id)).toEqual([
			2, 1,
		]);
	});

	it("should sort conversations with no messages yet to the end", () => {
		const withMessage = makeConversation({ id: 1, lastMessageAt: "2026-07-01T00:00:00Z" });
		const never = makeConversation({ id: 2, lastMessageAt: null });

		expect(
			sortConversationsByRecency([never, withMessage]).map((c) => c.id),
		).toEqual([1, 2]);
	});

	it("should not mutate the input array", () => {
		const list = [makeConversation({ id: 1 }), makeConversation({ id: 2 })];
		sortConversationsByRecency(list);
		expect(list.map((c) => c.id)).toEqual([1, 2]);
	});
});

describe("upsertConversationPreview", () => {
	it("should update the matching conversation's preview and timestamp", () => {
		const list = [makeConversation({ id: 1, lastMessagePreview: "old" })];

		const result = upsertConversationPreview(list, {
			conversationId: 1,
			lastMessageAt: "2026-07-04T00:00:00Z",
			lastMessagePreview: "new",
		});

		expect(result[0].lastMessagePreview).toBe("new");
		expect(result[0].lastMessageAt).toBe("2026-07-04T00:00:00Z");
	});

	it("should leave the list unchanged when no conversation matches", () => {
		const list = [makeConversation({ id: 1 })];

		const result = upsertConversationPreview(list, {
			conversationId: 999,
			lastMessageAt: "2026-07-04T00:00:00Z",
			lastMessagePreview: "new",
		});

		expect(result).toEqual(list);
	});

	it("should not mutate the original array", () => {
		const list = [makeConversation({ id: 1, lastMessagePreview: "old" })];
		upsertConversationPreview(list, {
			conversationId: 1,
			lastMessageAt: "2026-07-04T00:00:00Z",
			lastMessagePreview: "new",
		});
		expect(list[0].lastMessagePreview).toBe("old");
	});
});

describe("conversationTitle", () => {
	it("should return the conversation's name when present", () => {
		expect(conversationTitle({ name: "Turtle Squad", type: "group" })).toBe(
			"Turtle Squad",
		);
	});

	it("should fall back to 'Group' for a nameless group", () => {
		expect(conversationTitle({ name: null, type: "group" })).toBe("Group");
	});

	it("should fall back to 'Unknown' for a nameless dm", () => {
		expect(conversationTitle({ name: null, type: "dm" })).toBe("Unknown");
	});
});

describe("unreadIdsFromInbox", () => {
	it("should build a set of conversation ids from the inbox entries", () => {
		const result = unreadIdsFromInbox([{ conversationId: 1 }, { conversationId: 2 }]);
		expect(result).toEqual(new Set([1, 2]));
	});

	it("should return an empty set for an empty inbox", () => {
		expect(unreadIdsFromInbox([])).toEqual(new Set());
	});
});

describe("addUnread", () => {
	it("should add a new id", () => {
		expect(addUnread(new Set([1]), 2)).toEqual(new Set([1, 2]));
	});

	it("should return an equivalent set when the id is already present", () => {
		const ids = new Set([1]);
		expect(addUnread(ids, 1)).toEqual(new Set([1]));
	});

	it("should not mutate the original set", () => {
		const ids = new Set([1]);
		addUnread(ids, 2);
		expect(ids).toEqual(new Set([1]));
	});
});

describe("removeUnread", () => {
	it("should remove a present id", () => {
		expect(removeUnread(new Set([1, 2]), 1)).toEqual(new Set([2]));
	});

	it("should return an equivalent set when the id is absent", () => {
		const ids = new Set([1]);
		expect(removeUnread(ids, 99)).toEqual(new Set([1]));
	});

	it("should not mutate the original set", () => {
		const ids = new Set([1, 2]);
		removeUnread(ids, 1);
		expect(ids).toEqual(new Set([1, 2]));
	});
});

describe("parseGifMetadata", () => {
	const validMetadata = {
		provider: "klipy",
		slug: "hello-hi-662",
		url: "https://static.klipy.com/ii/abc/def/md.gif",
		previewUrl: "https://static.klipy.com/ii/abc/def/xs.gif",
		width: 498,
		height: 498,
	};

	it("should return the parsed metadata when every field has the expected shape", () => {
		expect(parseGifMetadata(validMetadata)).toEqual(validMetadata);
	});

	it("should return null for null metadata", () => {
		expect(parseGifMetadata(null)).toBeNull();
	});

	it("should return null when provider is not 'klipy'", () => {
		expect(parseGifMetadata({ ...validMetadata, provider: "tenor" })).toBeNull();
	});

	it("should return null when slug is missing", () => {
		const { slug: _slug, ...rest } = validMetadata;
		expect(parseGifMetadata(rest)).toBeNull();
	});

	it("should return null when url is not a string", () => {
		expect(parseGifMetadata({ ...validMetadata, url: 123 })).toBeNull();
	});

	it("should return null when width is not a number", () => {
		expect(parseGifMetadata({ ...validMetadata, width: "498" })).toBeNull();
	});

	it("should return null for an empty metadata object", () => {
		expect(parseGifMetadata({})).toBeNull();
	});
});
