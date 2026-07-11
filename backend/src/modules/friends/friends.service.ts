import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";
import {
	PresenceService,
	type PresenceStatus,
} from "../presence/presence.service";
import { NotificationsService } from "../notifications/notifications.service";
import { User } from "../users/entities/user.entity";
import { Friendship } from "./entities/friendship.entity";

/** Default cap on "People you may know" suggestions returned per request. */
const SUGGESTIONS_LIMIT = 20;

export interface FriendView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	/** True when status is anything other than "offline". Kept for back-compat. */
	isOnline: boolean;
	/** Coarse presence: "offline" | "online" | "in-game". */
	status: PresenceStatus;
	/** The game the friend is currently playing, or null. */
	gameId: string | null;
	/** ISO timestamp of when the friend was last online, or null if unknown. */
	lastSeenAt: string | null;
	requesterId: number;
}

export interface PendingView {
	userId: number;
	username: string;
	turtleName: string | null;
	shellSkin: string;
	avatar: string | null;
	level: number;
	isOnline: boolean;
}

@Injectable()
export class FriendsService {
	constructor(
		@InjectRepository(Friendship)
		private readonly friendshipRepo: Repository<Friendship>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly presence: PresenceService,
		private readonly notifications: NotificationsService,
	) {}

	/**
	 * Send a friend request from requester → addressee.
	 * Throws ConflictException if a row already exists in either direction.
	 * Throws BadRequestException on self-friending.
	 */
	async sendRequest(
		requesterId: number,
		addresseeUsername: string,
	): Promise<void> {
		try {
			const addressee = await this.userRepo.findOne({
				where: { username: addresseeUsername },
			});
			// Guests are ephemeral and cannot durably receive/read notifications
			// (Bug Audit M4) — treat a guest addressee as not-found rather than
			// leaking that the username belongs to a live guest session.
			if (!addressee || addressee.isGuest) {
				throw new NotFoundException("User not found");
			}

			if (requesterId === addressee.id) {
				throw new BadRequestException(
					"You cannot send a friend request to yourself",
				);
			}

			// Check both directions for any existing rows. Uses find() (not
			// findOne) so a mutual-block pair — both A→B and B→A blocked — is
			// resolved by the explicit priority below rather than by whichever row
			// the DB happens to return first (Bug B7).
			const existing = await this.friendshipRepo.find({
				where: [
					{ requesterId, addresseeId: addressee.id },
					{ requesterId: addressee.id, addresseeId: requesterId },
				],
			});
			if (existing.length > 0) {
				// I previously blocked them → actionable 409 (they must be unblocked
				// first; see unblock()). Checked FIRST so that, in a mutual block,
				// the caller still gets the unblock guidance instead of a silent
				// success (Bug B7).
				const ownBlock = existing.find(
					(r) => r.status === "blocked" && r.requesterId === requesterId,
				);
				if (ownBlock) {
					throw new ConflictException(
						"You have blocked this user. Unblock them before sending a request.",
					);
				}
				// The other user has blocked me → behave like a silent success so the
				// block is not leaked to the sender (Bug Audit M8). Nothing created.
				const theirBlock = existing.find(
					(r) => r.status === "blocked" && r.requesterId === addressee.id,
				);
				if (theirBlock) {
					return;
				}
				// They already sent *me* a pending request → accept it instead of
				// erroring. This is the friendly resolution and it also guarantees a
				// second, opposite-direction pending row can never exist for the
				// pair (Bug Audit M2).
				const theirPending = existing.find(
					(r) => r.status === "pending" && r.requesterId === addressee.id,
				);
				if (theirPending) {
					await this.acceptRequest(requesterId, addressee.id);
					return;
				}
				// My own outstanding request, or we are already friends.
				throw new ConflictException(
					"Friend request already exists or users are already friends",
				);
			}

			const requester = await this.userRepo.findOne({
				where: { id: requesterId },
			});

			await this.friendshipRepo.save(
				this.friendshipRepo.create({
					requesterId,
					addresseeId: addressee.id,
					status: "pending",
				}),
			);

			// Notify the addressee — non-fatal if it fails
			await this.notifications
				.create("friend_request", requesterId, addressee.id, {
					username: requester?.username ?? "",
				})
				.catch(() => undefined);
		} catch (err) {
			if (
				err instanceof NotFoundException ||
				err instanceof BadRequestException ||
				err instanceof ConflictException
			) {
				throw err;
			}
			// Two near-simultaneous sendRequest calls for the same pair can both
			// pass the check-then-insert's `existing` lookup before either write
			// commits; the DB-level unique index on (requesterId, addresseeId)
			// then rejects the loser with a 23505, which — unmapped — used to
			// surface as a generic 500 instead of the intended 409
			// (Bug Audit M5).
			const pg = err as { code?: string };
			if (pg?.code === "23505") {
				throw new ConflictException(
					"Friend request already exists or users are already friends",
				);
			}
			throw new InternalServerErrorException(
				"Failed to send friend request",
			);
		}
	}

	/**
	 * Accept a pending request where the given user is the addressee.
	 */
	async acceptRequest(
		addresseeId: number,
		requesterId: number,
	): Promise<void> {
		try {
			const row = await this.friendshipRepo.findOne({
				where: { requesterId, addresseeId, status: "pending" },
			});
			if (!row)
				throw new NotFoundException("No pending friend request found");

			row.status = "accepted";
			await this.friendshipRepo.save(row);

			// Notify the original requester that their request was accepted — non-fatal
			const accepter = await this.userRepo
				.findOne({ where: { id: addresseeId } })
				.catch(() => null);
			await this.notifications
				.create("friend_accepted", addresseeId, requesterId, {
					username: accepter?.username ?? "",
				})
				.catch(() => undefined);

			// Clear the now-resolved friend_request notification from the
			// accepter's inbox, in both directions (Bug Audit H3). Without this,
			// accepting from the social tab — which doesn't go through the
			// drawer's own resolve-on-accept handler — or the mutual-request
			// auto-accept path in sendRequest() left a dead-end "X sent you a
			// friend request" entry whose Accept button 404s forever. Mirrors
			// the cleanup declineOrCancelRequest/block already do.
			await this.notifications
				.removeWhere("friend_request", requesterId, addresseeId)
				.catch(() => undefined);
			await this.notifications
				.removeWhere("friend_request", addresseeId, requesterId)
				.catch(() => undefined);
		} catch (err) {
			if (err instanceof NotFoundException) throw err;
			throw new InternalServerErrorException(
				"Failed to accept friend request",
			);
		}
	}

	/**
	 * Remove an established (accepted) friendship. Works regardless of which
	 * user originally sent the request.
	 *
	 * Scoped to status="accepted" only — deliberately does NOT touch a
	 * "pending" row. Two UI surfaces can race on the same pair (e.g. the
	 * notification drawer accepts a request while the social tab's stale
	 * pending list still shows a Decline button); scoping by status makes the
	 * loser of that race a no-op instead of destroying the winner's state.
	 * See declineOrCancelRequest for the pending-only counterpart.
	 */
	async removeFriend(actorId: number, otherId: number): Promise<void> {
		try {
			const result = await this.friendshipRepo.delete([
				{ requesterId: actorId, addresseeId: otherId, status: "accepted" },
				{ requesterId: otherId, addresseeId: actorId, status: "accepted" },
			]);
			// "delete" event catalog entry (Bug Audit §3/#10). Deliberately
			// live-only, not a persisted Notification row: a standing "so-and-so
			// removed you as a friend" bell entry is an awkward, arguably
			// hostile UX choice for a social feature. This just lets the
			// removed side's friends list resync instantly if they're online;
			// it carries no lingering notification and is a silent no-op if a
			// row was never actually removed (a friendship didn't exist) or the
			// user is offline.
			if (result.affected && result.affected > 0) {
				this.notifications.pushLiveEvent("friend:removed", otherId, {
					userId: actorId,
				});
			}
		} catch {
			throw new InternalServerErrorException("Failed to remove friend");
		}
	}

	/**
	 * Decline an incoming pending request, or cancel your own outgoing one.
	 * Works regardless of which user originally sent the request.
	 *
	 * Scoped to status="pending" only. Idempotent: if the row was already
	 * accepted (or already gone) by the time this runs — e.g. the requester
	 * was accepted from another tab a moment earlier — this is a silent
	 * no-op rather than an error, and importantly does NOT fall through to
	 * deleting the now-accepted friendship.
	 */
	async declineOrCancelRequest(actorId: number, otherId: number): Promise<void> {
		try {
			await this.friendshipRepo.delete([
				{ requesterId: actorId, addresseeId: otherId, status: "pending" },
				{ requesterId: otherId, addresseeId: actorId, status: "pending" },
			]);

			// Clear any friend_request notification tied to this pair in either
			// direction, so a declined/cancelled request doesn't leave a bell
			// entry that dead-ends on Accept (Bug Audit M9). Non-fatal.
			await this.notifications
				.removeWhere("friend_request", otherId, actorId)
				.catch(() => undefined);
			await this.notifications
				.removeWhere("friend_request", actorId, otherId)
				.catch(() => undefined);
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			throw new InternalServerErrorException(
				"Failed to decline friend request",
			);
		}
	}

	/**
	 * Block a user.  Uses an upsert so blocking works whether or not a row
	 * already exists.  The blocking user always becomes the requester so the
	 * blocked user cannot see the row from their side.
	 *
	 * The delete-then-insert runs atomically inside a transaction (Bug Audit
	 * M5): un-transacted, a concurrent operation on the same pair could
	 * observe the brief window between the delete committing and the insert
	 * committing (e.g. a friend request racing a block).
	 *
	 * Pass `manager` to run inside an existing transaction (e.g. report+block
	 * as one atomic unit) — the delete+insert then joins that transaction
	 * instead of opening a nested one; otherwise a new transaction is opened
	 * on the default repository's manager.
	 */
	async block(
		blockerId: number,
		blockedId: number,
		manager?: EntityManager,
	): Promise<void> {
		try {
			if (blockerId === blockedId) {
				throw new BadRequestException("You cannot block yourself");
			}

			// Target must exist — otherwise the FK violation on insert would
			// surface as a generic 500 instead of a clear 404 (Bug Audit M3).
			const target = await this.userRepo.findOne({ where: { id: blockedId } });
			if (!target) throw new NotFoundException("User not found");

			// Returns whether a *live* relationship (pending/accepted) was removed,
			// so the caller can decide whether the blocked side needs a resync.
			const doBlock = async (em: EntityManager): Promise<boolean> => {
				const repo = em.getRepository(Friendship);
				// Remove any pending/accepted relationship in either direction. Its
				// affected count tells us whether the blocked side had a relationship
				// that just silently vanished and so needs a live resync (Bug B3).
				const removed = await repo.delete([
					{ requesterId: blockerId, addresseeId: blockedId, status: "pending" },
					{ requesterId: blockedId, addresseeId: blockerId, status: "pending" },
					{ requesterId: blockerId, addresseeId: blockedId, status: "accepted" },
					{ requesterId: blockedId, addresseeId: blockerId, status: "accepted" },
				]);
				// Separately clear the caller's OWN prior block row so re-blocking is
				// idempotent. Kept as its own delete (not folded into the one above)
				// so an idempotent re-block — where this is the only pre-existing row
				// — does NOT count as removing a live relationship and stays silent
				// (Bug B3). Deliberately does NOT delete a `blocked` row where
				// blockedId is the requester — that is the *other* user's block of
				// the caller, which must survive so mutual blocks coexist (Bug Audit
				// M1). The per-direction unique index lets both directions exist.
				await repo.delete({
					requesterId: blockerId,
					addresseeId: blockedId,
					status: "blocked",
				});
				await repo.save(
					repo.create({
						requesterId: blockerId,
						addresseeId: blockedId,
						status: "blocked",
					}),
				);
				return (removed.affected ?? 0) > 0;
			};

			const removedRelationship = manager
				? await doBlock(manager)
				: await this.friendshipRepo.manager.transaction(doBlock);

			// Resolve any outstanding friend_request notification between the pair
			// in either direction, so the recipient's bell doesn't dead-end on an
			// Accept that now finds no pending row (Bug Audit M9). Non-fatal.
			await this.notifications
				.removeWhere("friend_request", blockerId, blockedId)
				.catch(() => undefined);
			await this.notifications
				.removeWhere("friend_request", blockedId, blockerId)
				.catch(() => undefined);

			// The blocked user's open client still shows the blocker as a friend
			// (online dot, working-looking Message button) until its next Social
			// open; the block silently removed the friendship, so give the blocked
			// side the same live-only resync removeFriend uses. Reuse
			// `friend:removed` rather than a block-specific event so the block is
			// never leaked to the blocked side (same silent-block principle as Bug
			// Audit M8 / Bug B3). No-op if only an idempotent re-block occurred.
			if (removedRelationship) {
				this.notifications.pushLiveEvent("friend:removed", blockedId, {
					userId: blockerId,
				});
			}
		} catch (err) {
			if (
				err instanceof BadRequestException ||
				err instanceof NotFoundException
			) {
				throw err;
			}
			throw new InternalServerErrorException("Failed to block user");
		}
	}

	/**
	 * List every user the caller has blocked — the rows they own
	 * (requesterId = caller, status = 'blocked'). Backs the "Blocked users"
	 * section of the Social modal and the unblock affordance (Bug Audit H3).
	 */
	async listBlocked(userId: number): Promise<PendingView[]> {
		try {
			const rows = await this.friendshipRepo.find({
				where: { requesterId: userId, status: "blocked" },
				relations: ["addressee"],
			});
			return rows.map((row) => ({
				userId: row.addressee.id,
				username: row.addressee.username,
				turtleName: row.addressee.turtleName ?? null,
				shellSkin: row.addressee.shellSkin,
				avatar: row.addressee.avatar ?? null,
				level: row.addressee.level,
				isOnline: this.presence.isOnline(row.addressee.id),
			}));
		} catch {
			throw new InternalServerErrorException("Failed to list blocked users");
		}
	}

	/**
	 * Unblock a user. Deletes ONLY the caller's own block row
	 * (requesterId = caller). Must never delete a `blocked` row where the
	 * caller is the addressee — that is the other user's block of the caller,
	 * and unblocking one direction must not silently clear the other (Bug Audit
	 * H3/M1). Idempotent: a no-op if no such block row exists.
	 */
	async unblock(blockerId: number, blockedId: number): Promise<void> {
		try {
			await this.friendshipRepo.delete({
				requesterId: blockerId,
				addresseeId: blockedId,
				status: "blocked",
			});
		} catch {
			throw new InternalServerErrorException("Failed to unblock user");
		}
	}

	/** Return all accepted friends for a user, with live online status. */
	async listFriends(userId: number): Promise<FriendView[]> {
		try {
			const rows = await this.friendshipRepo.find({
				where: [
					{ requesterId: userId, status: "accepted" },
					{ addresseeId: userId, status: "accepted" },
				],
				relations: ["requester", "addressee"],
			});

			return rows.map((row) => {
				const other =
					row.requesterId === userId ? row.addressee : row.requester;
				const status = this.presence.getStatus(other.id);
				return {
					userId: other.id,
					username: other.username,
					turtleName: other.turtleName ?? null,
					shellSkin: other.shellSkin,
					avatar: other.avatar ?? null,
					level: other.level,
					isOnline: status !== "offline",
					status,
					gameId: this.presence.getGameId(other.id),
					lastSeenAt: other.lastSeenAt
						? other.lastSeenAt.toISOString()
						: null,
					requesterId: row.requesterId,
				};
			});
		} catch {
			throw new InternalServerErrorException("Failed to list friends");
		}
	}

	/** Return pending requests where userId is the addressee (incoming requests). */
	async listPending(userId: number): Promise<PendingView[]> {
		try {
			const rows = await this.friendshipRepo.find({
				where: { addresseeId: userId, status: "pending" },
				relations: ["requester"],
			});

			return rows.map((row) => ({
				userId: row.requester.id,
				username: row.requester.username,
				turtleName: row.requester.turtleName ?? null,
				shellSkin: row.requester.shellSkin,
				avatar: row.requester.avatar ?? null,
				level: row.requester.level,
				isOnline: this.presence.isOnline(row.requester.id),
			}));
		} catch {
			throw new InternalServerErrorException(
				"Failed to list pending requests",
			);
		}
	}

	/** Return pending requests where userId is the requester (outgoing requests). */
	async listOutgoing(userId: number): Promise<PendingView[]> {
		try {
			const rows = await this.friendshipRepo.find({
				where: { requesterId: userId, status: "pending" },
				relations: ["addressee"],
			});

			return rows.map((row) => ({
				userId: row.addressee.id,
				username: row.addressee.username,
				turtleName: row.addressee.turtleName ?? null,
				shellSkin: row.addressee.shellSkin,
				avatar: row.addressee.avatar ?? null,
				level: row.addressee.level,
				isOnline: this.presence.isOnline(row.addressee.id),
			}));
		} catch {
			throw new InternalServerErrorException(
				"Failed to list outgoing requests",
			);
		}
	}

	/**
	 * "People you may know" — friends-of-friends, excluding: the requester
	 * themselves, existing friends, anyone with a pending request in either
	 * direction, and anyone blocked in either direction.
	 */
	async getSuggestions(
		userId: number,
		limit: number = SUGGESTIONS_LIMIT,
	): Promise<PendingView[]> {
		try {
			const friendIds = await this.getFriendIds(userId);
			if (friendIds.length === 0) return [];
			// O(1) membership tests inside the fof loop below (Bug Audit M5).
			const friendIdSet = new Set(friendIds);

			// Friends of my friends (accepted friendships involving any of them).
			const fofRows = await this.friendshipRepo.find({
				where: [
					{ requesterId: In(friendIds), status: "accepted" },
					{ addresseeId: In(friendIds), status: "accepted" },
				],
			});

			const candidateIds = new Set<number>();
			for (const row of fofRows) {
				const otherId = friendIdSet.has(row.requesterId)
					? row.addresseeId
					: row.requesterId;
				if (otherId !== userId && !friendIdSet.has(otherId)) {
					candidateIds.add(otherId);
				}
			}
			if (candidateIds.size === 0) return [];

			// Exclude anyone who already has ANY row with the requester
			// (pending in either direction, or blocked in either direction —
			// accepted friends are already excluded above).
			const candidateIdList = [...candidateIds];
			const existingRows = await this.friendshipRepo.find({
				where: [
					{ requesterId: userId, addresseeId: In(candidateIdList) },
					{ requesterId: In(candidateIdList), addresseeId: userId },
				],
			});
			const excludeIds = new Set(
				existingRows.map((row) =>
					row.requesterId === userId ? row.addresseeId : row.requesterId,
				),
			);

			const finalIds = candidateIdList.filter((id) => !excludeIds.has(id));
			if (finalIds.length === 0) return [];

			const users = await this.userRepo.find({
				// Guests are ephemeral — never surface them as suggestions.
				where: { id: In(finalIds), isGuest: false },
				// Stable, meaningful ordering so the limit is deterministic:
				// strongest players first, alphabetical as a tiebreaker.
				order: { level: "DESC", username: "ASC" },
				take: limit,
			});

			return users.map((u) => ({
				userId: u.id,
				username: u.username,
				turtleName: u.turtleName ?? null,
				shellSkin: u.shellSkin,
				avatar: u.avatar ?? null,
				level: u.level,
				isOnline: this.presence.isOnline(u.id),
			}));
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			throw new InternalServerErrorException(
				"Failed to get friend suggestions",
			);
		}
	}

	async areFriends(userAId: number, userBId: number): Promise<boolean> {
		try {
			const row = await this.friendshipRepo.findOne({
				where: [
					{
						requesterId: userAId,
						addresseeId: userBId,
						status: "accepted",
					},
					{
						requesterId: userBId,
						addresseeId: userAId,
						status: "accepted",
					},
				],
			});
			return row !== null;
		} catch {
			throw new InternalServerErrorException(
				"Failed to check friendship",
			);
		}
	}

	/** Return all friend user IDs for use in leaderboard filtering. */
	async getFriendIds(userId: number): Promise<number[]> {
		try {
			const rows = await this.friendshipRepo.find({
				where: [
					{ requesterId: userId, status: "accepted" },
					{ addresseeId: userId, status: "accepted" },
				],
				select: { requesterId: true, addresseeId: true },
			});

			return rows.map((row) =>
				row.requesterId === userId ? row.addresseeId : row.requesterId,
			);
		} catch {
			throw new InternalServerErrorException("Failed to get friend IDs");
		}
	}
}
