/**
 * Pure, side-effect-free helpers for the chat feature — conversation list
 * ordering, optimistic preview updates, and the unread-conversation id set.
 *
 * Kept separate from the React layer so the logic can be unit tested in
 * isolation. None of these functions mutate their inputs.
 */
import type { ConversationSummaryView, UnreadConversationView } from "../hub/api";

/**
 * Sort conversations by most recent activity first. Conversations with no
 * messages yet (`lastMessageAt` is null) sort last, in their original
 * relative order. Never mutates the input array.
 */
export function sortConversationsByRecency(
	conversations: ConversationSummaryView[],
): ConversationSummaryView[] {
	return [...conversations].sort((a, b) => {
		if (!a.lastMessageAt && !b.lastMessageAt) return 0;
		if (!a.lastMessageAt) return 1;
		if (!b.lastMessageAt) return -1;
		return b.lastMessageAt.localeCompare(a.lastMessageAt);
	});
}

export interface ConversationPreviewUpdate {
	conversationId: number;
	lastMessageAt: string;
	lastMessagePreview: string;
}

/**
 * Return a new array with the matching conversation's preview/timestamp
 * updated — used when a live `chat:message` arrives for a conversation
 * already in the list. Conversations are NOT re-sorted here; call
 * `sortConversationsByRecency` on the result to restore recency order.
 *
 * If no conversation matches (e.g. the very first message in a brand-new
 * conversation the client hasn't fetched yet), the array is returned
 * unchanged — the caller should trigger a refetch in that case.
 */
export function upsertConversationPreview(
	conversations: ConversationSummaryView[],
	update: ConversationPreviewUpdate,
): ConversationSummaryView[] {
	const exists = conversations.some((c) => c.id === update.conversationId);
	if (!exists) return conversations;

	return conversations.map((c) =>
		c.id === update.conversationId
			? {
					...c,
					lastMessageAt: update.lastMessageAt,
					lastMessagePreview: update.lastMessagePreview,
				}
			: c,
	);
}

/** Display title for a conversation — falls back for the rare case a dm's other-user data is missing. */
export function conversationTitle(
	conversation: Pick<ConversationSummaryView, "name" | "type">,
): string {
	return conversation.name ?? (conversation.type === "group" ? "Group" : "Unknown");
}

/** Build the initial unread-conversation id set from the `chat:unread-inbox` push. */
export function unreadIdsFromInbox(
	entries: ReadonlyArray<Pick<UnreadConversationView, "conversationId">>,
): Set<number> {
	return new Set(entries.map((e) => e.conversationId));
}

/** Return a new Set with `conversationId` added. Never mutates the input. */
export function addUnread(ids: Set<number>, conversationId: number): Set<number> {
	if (ids.has(conversationId)) return ids;
	return new Set(ids).add(conversationId);
}

/** Return a new Set with `conversationId` removed. Never mutates the input. */
export function removeUnread(ids: Set<number>, conversationId: number): Set<number> {
	if (!ids.has(conversationId)) return ids;
	const next = new Set(ids);
	next.delete(conversationId);
	return next;
}

/** Trusted, validated shape for a `type: "gif"` message's metadata. */
export interface GifMetadata {
	provider: "klipy";
	slug: string;
	url: string;
	previewUrl: string;
	width: number;
	height: number;
}

/**
 * Defensively parse a message's `metadata` field into GifMetadata. The wire
 * type is a loosely-typed jsonb blob (`Record<string, unknown> | null`) — the
 * backend already validates it before persisting a gif message, but this is
 * defence in depth against a stale client, a future backend change, or a
 * type/metadata mismatch. Returns null for anything that doesn't match
 * exactly, so callers can fall back to a plain-text rendering instead of
 * rendering a broken <img> or crashing.
 */
export function parseGifMetadata(
	metadata: Record<string, unknown> | null,
): GifMetadata | null {
	if (!metadata) return null;
	const { provider, slug, url, previewUrl, width, height } = metadata;
	if (
		provider !== "klipy" ||
		typeof slug !== "string" ||
		typeof url !== "string" ||
		typeof previewUrl !== "string" ||
		typeof width !== "number" ||
		typeof height !== "number"
	) {
		return null;
	}
	return { provider, slug, url, previewUrl, width, height };
}
