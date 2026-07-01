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
			if (!addressee) throw new NotFoundException("User not found");

			if (requesterId === addressee.id) {
				throw new BadRequestException(
					"You cannot send a friend request to yourself",
				);
			}

			// Check both directions for any existing row
			const existing = await this.friendshipRepo.findOne({
				where: [
					{ requesterId, addresseeId: addressee.id },
					{ requesterId: addressee.id, addresseeId: requesterId },
				],
			});
			if (existing) {
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
		} catch (err) {
			if (err instanceof NotFoundException) throw err;
			throw new InternalServerErrorException(
				"Failed to accept friend request",
			);
		}
	}

	/**
	 * Remove a friendship or decline a pending request.
	 * Works regardless of which user initiated the original request.
	 */
	async removeOrDecline(actorId: number, otherId: number): Promise<void> {
		try {
			await this.friendshipRepo.delete([
				{ requesterId: actorId, addresseeId: otherId },
				{ requesterId: otherId, addresseeId: actorId },
			]);
		} catch {
			throw new InternalServerErrorException("Failed to remove friend");
		}
	}

	/**
	 * Block a user.  Uses an upsert so blocking works whether or not a row
	 * already exists.  The blocking user always becomes the requester so the
	 * blocked user cannot see the row from their side.
	 *
	 * Pass `manager` to run inside an existing transaction (e.g. report+block
	 * as one atomic unit); otherwise the default repository is used.
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

			const repo = manager
				? manager.getRepository(Friendship)
				: this.friendshipRepo;

			// Remove any existing row in either direction first, then insert block
			await repo.delete([
				{ requesterId: blockerId, addresseeId: blockedId },
				{ requesterId: blockedId, addresseeId: blockerId },
			]);
			await repo.save(
				repo.create({
					requesterId: blockerId,
					addresseeId: blockedId,
					status: "blocked",
				}),
			);
		} catch (err) {
			if (err instanceof BadRequestException) throw err;
			throw new InternalServerErrorException("Failed to block user");
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

			// Friends of my friends (accepted friendships involving any of them).
			const fofRows = await this.friendshipRepo.find({
				where: [
					{ requesterId: In(friendIds), status: "accepted" },
					{ addresseeId: In(friendIds), status: "accepted" },
				],
			});

			const candidateIds = new Set<number>();
			for (const row of fofRows) {
				const otherId = friendIds.includes(row.requesterId)
					? row.addresseeId
					: row.requesterId;
				if (otherId !== userId && !friendIds.includes(otherId)) {
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
