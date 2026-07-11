import { Injectable } from "@nestjs/common";

export interface SocketUser {
	id: number;
	username: string;
	turtleName?: string | null;
	shellSkin?: string;
	trailEffect?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
	isGuest: boolean;
}

/**
 * Coarse activity state for a user:
 *   'offline' — no active socket connections
 *   'online'  — connected, but not currently in a match
 *   'in-game' — connected and playing the game returned by getGameId()
 */
export type PresenceStatus = "offline" | "online" | "in-game";

/**
 * Tracks which users currently have at least one active WebSocket connection.
 *
 * A user is considered online as long as any of their socket IDs remain in the
 * map — a single user can have multiple concurrent connections (e.g. two open
 * browser tabs).
 */
@Injectable()
export class PresenceService {
	private readonly sockets = new Map<string, SocketUser>();
	private readonly userSockets = new Map<number, Set<string>>();
	/** userId → gameId for users currently in an active match. */
	private readonly inGame = new Map<number, string>();

	connect(socketId: string, user: SocketUser): void {
		this.sockets.set(socketId, user);
		const set = this.userSockets.get(user.id) ?? new Set<string>();
		set.add(socketId);
		this.userSockets.set(user.id, set);
	}

	disconnect(socketId: string): SocketUser | null {
		const user = this.sockets.get(socketId) ?? null;
		this.sockets.delete(socketId);
		if (user) {
			const set = this.userSockets.get(user.id);
			set?.delete(socketId);
			if (!set?.size) {
				this.userSockets.delete(user.id);
				// Fully offline now — drop any stale in-game marker.
				this.inGame.delete(user.id);
			}
		}
		return user;
	}

	/** Mark a connected user as actively playing `gameId`. */
	setInGame(userId: number, gameId: string): void {
		this.inGame.set(userId, gameId);
	}

	/** Clear a user's in-game marker (match ended / left). */
	clearInGame(userId: number): void {
		this.inGame.delete(userId);
	}

	/** Resolve the coarse presence status for a user. */
	getStatus(userId: number): PresenceStatus {
		if (!this.userSockets.has(userId)) return "offline";
		return this.inGame.has(userId) ? "in-game" : "online";
	}

	/** The game a user is currently in, or null if not in a match. */
	getGameId(userId: number): string | null {
		return this.inGame.get(userId) ?? null;
	}

	getUser(socketId: string): SocketUser | null {
		return this.sockets.get(socketId) ?? null;
	}

	isOnline(userId: number): boolean {
		return this.userSockets.has(userId);
	}

	/** Returns all active socket IDs for a user (empty array if offline). */
	getSocketIds(userId: number): string[] {
		return [...(this.userSockets.get(userId) ?? [])];
	}
}
