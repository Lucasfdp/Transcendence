import { BadRequestException, Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { MatchFactoryService } from "./match-factory.service";
import { RoomService } from "./room.service";
import { MatchRoom, SocketUser } from "./matchmaking.types";

interface PrivateLobbyParticipant {
	socketId: string;
	user: SocketUser;
	shellSelection: string[];
}

export interface PrivateLobby {
	lobbyId: string;
	kind: "invite" | "pin";
	pin: string | null;
	hostSocketId: string;
	host: SocketUser;
	gameId: string;
	playerCount: number;
	powerupsEnabled: boolean;
	shellSelection: string[];
	participants: PrivateLobbyParticipant[];
	createdAt: number;
	/** Set when an invite is pending — cleared on accept/decline/cancel. */
	pendingInviteeId: number | null;
	expiryTimer: ReturnType<typeof setTimeout>;
}

export interface LobbyJoinResult {
	matchId: string;
	room: MatchRoom;
}

export interface StartedPinMatch {
	matchId: string;
	gameId: string;
	startedAt: number;
}

const LOBBY_EXPIRY_MS = 2 * 60 * 1_000; // 2 minutes
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const PIN_LENGTH = 6;
const PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PIN_GAME_PREFIXES: Record<string, string> = {
	"kame-knock": "0",
	"bamboo-bash": "1",
	"temple-curling": "2",
	"bell-clash": "3",
};
export const PRIVATE_LOBBY_NOT_FOUND_MESSAGE = "No match found for this room code";

@Injectable()
export class PrivateLobbiesService {
	private readonly lobbies = new Map<string, PrivateLobby>();
	private readonly startedPinMatches = new Map<string, StartedPinMatch>();

	constructor(
		private readonly roomService: RoomService,
		private readonly matchFactory: MatchFactoryService,
	) {}

	/**
	 * Create a new private lobby for the host.
	 * Returns the lobby ID immediately — the host then sends invites.
	 */
	createLobby(
		hostSocketId: string,
		host: SocketUser,
		gameId: string,
		shellSelection: string[],
		onExpiry: (lobby: PrivateLobby) => void,
	): PrivateLobby {
		if (this.roomService.hasActiveRoom(host.id)) {
			throw new BadRequestException("You are already in an active match");
		}
		if (this.getLobbyForUser(host.id)) {
			throw new BadRequestException("You already have an open lobby");
		}

		const lobbyId = uuidv4();
		const expiryTimer = setTimeout(() => {
			this.lobbies.delete(lobbyId);
			onExpiry(lobby);
		}, LOBBY_EXPIRY_MS);

		const lobby: PrivateLobby = {
			lobbyId,
			kind: "invite",
			pin: null,
			hostSocketId,
			host,
			gameId,
			playerCount: 2,
			powerupsEnabled: false,
			shellSelection,
			participants: [{ socketId: hostSocketId, user: host, shellSelection }],
			createdAt: Date.now(),
			pendingInviteeId: null,
			expiryTimer,
		};

		this.lobbies.set(lobbyId, lobby);
		return lobby;
	}

	createPinLobby(
		hostSocketId: string,
		host: SocketUser,
		gameId: string,
		playerCount: number,
		powerupsEnabled: boolean,
		shellSelection: string[],
		onExpiry: (lobby: PrivateLobby) => void,
	): PrivateLobby {
		if (this.roomService.hasActiveRoom(host.id)) {
			throw new BadRequestException("You are already in an active match");
		}
		if (this.getLobbyForUser(host.id)) {
			throw new BadRequestException("You already have an open lobby");
		}

		const lobbyId = uuidv4();
		const pin = this.generateUniquePin(gameId);
		const normalizedPlayerCount = this.normalizePlayerCount(playerCount);
		const expiryTimer = setTimeout(() => {
			this.lobbies.delete(lobbyId);
			onExpiry(lobby);
		}, LOBBY_EXPIRY_MS);

		const lobby: PrivateLobby = {
			lobbyId,
			kind: "pin",
			pin,
			hostSocketId,
			host,
			gameId,
			playerCount: normalizedPlayerCount,
			powerupsEnabled,
			shellSelection,
			participants: [{ socketId: hostSocketId, user: host, shellSelection }],
			createdAt: Date.now(),
			pendingInviteeId: null,
			expiryTimer,
		};

		this.lobbies.set(lobbyId, lobby);
		return lobby;
	}

	getLobby(lobbyId: string): PrivateLobby | null {
		return this.lobbies.get(lobbyId) ?? null;
	}

	getLobbyByPin(pin: string): PrivateLobby | null {
		const normalizedPin = this.normalizePin(pin);
		for (const lobby of this.lobbies.values()) {
			if (lobby.pin === normalizedPin) return lobby;
		}
		return null;
	}

	getStartedMatchByPin(pin: string): StartedPinMatch | null {
		return this.startedPinMatches.get(this.normalizePin(pin)) ?? null;
	}

	getLobbyForUser(userId: number): PrivateLobby | null {
		for (const lobby of this.lobbies.values()) {
			if (
				lobby.host.id === userId ||
				lobby.participants.some((participant) => participant.user.id === userId)
			)
				return lobby;
		}
		return null;
	}

	setInvitee(lobbyId: string, inviteeId: number): void {
		const lobby = this.lobbies.get(lobbyId);
		if (lobby) lobby.pendingInviteeId = inviteeId;
	}

	/**
	 * Accept an invite: create a match + room for both players, remove the lobby.
	 * Returns null if the lobby no longer exists (expired or cancelled).
	 */
	async joinLobby(
		lobbyId: string,
		joinerSocketId: string,
		joiner: SocketUser,
		joinerShellSelection: string[],
	): Promise<LobbyJoinResult | null> {
		const lobby = this.lobbies.get(lobbyId);
		if (!lobby) return null;
		if (lobby.kind !== "invite") {
			throw new BadRequestException("Use the room PIN to join this lobby");
		}

		// Prevent double-join
		if (this.roomService.hasActiveRoom(joiner.id)) {
			throw new BadRequestException("You are already in an active match");
		}

		const players = [
			{
				socketId: lobby.hostSocketId,
				user: lobby.host,
				shellSelection: lobby.shellSelection,
			},
			{
				socketId: joinerSocketId,
				user: joiner,
				shellSelection: joinerShellSelection,
			},
		];

		this.cancelLobby(lobbyId); // clears timer + removes from map
		return this.createMatchRoom(lobby.gameId, players, lobby.powerupsEnabled);
	}

	async joinPinLobby(
		pin: string,
		gameId: string,
		joinerSocketId: string,
		joiner: SocketUser,
		joinerShellSelection: string[],
	): Promise<
		| { matched: false; lobby: PrivateLobby }
		| { matched: true; matchId: string; room: MatchRoom; pin: string }
		| null
	> {
		this.validatePinGame(pin, gameId);
		const lobby = this.getLobbyByPin(pin);
		if (!lobby || lobby.kind !== "pin" || !lobby.pin) return null;
		if (lobby.gameId !== gameId) {
			throw new BadRequestException(PRIVATE_LOBBY_NOT_FOUND_MESSAGE);
		}

		if (this.roomService.hasActiveRoom(joiner.id)) {
			throw new BadRequestException("You are already in an active match");
		}
		if (lobby.participants.some((participant) => participant.user.id === joiner.id)) {
			throw new BadRequestException("You are already in this lobby");
		}
		if (lobby.participants.length >= lobby.playerCount) {
			throw new BadRequestException("Private room is full");
		}

		lobby.participants.push({
			socketId: joinerSocketId,
			user: joiner,
			shellSelection: joinerShellSelection,
		});

		if (lobby.participants.length < lobby.playerCount) {
			return { matched: false, lobby };
		}

		const players = [...lobby.participants];
		const completedPin = lobby.pin;
		this.cancelLobby(lobby.lobbyId);
		const result = await this.createMatchRoom(
			lobby.gameId,
			players,
			lobby.powerupsEnabled,
		);
		this.startedPinMatches.set(completedPin, {
			matchId: result.matchId,
			gameId: lobby.gameId,
			startedAt: Date.now(),
		});
		return { matched: true, ...result, pin: completedPin };
	}

	private async createMatchRoom(
		gameId: string,
		players: PrivateLobbyParticipant[],
		powerupsEnabled: boolean,
	): Promise<LobbyJoinResult> {
		const room = await this.matchFactory.createMatch({
			gameId,
			mode: "casual", // private lobbies are always casual
			players,
			powerupsEnabled,
		});
		return { matchId: room.matchId, room };
	}

	/**
	 * Cancel a lobby (host cancels or lobby expires).
	 * Clears the expiry timer and removes from store.
	 */
	cancelLobby(lobbyId: string): PrivateLobby | null {
		const lobby = this.lobbies.get(lobbyId);
		if (!lobby) return null;
		clearTimeout(lobby.expiryTimer);
		this.lobbies.delete(lobbyId);
		return lobby;
	}

	/** Remove any lobby owned by this user on disconnect. */
	removeLobbyForUser(userId: number): PrivateLobby | null {
		const lobby = this.getLobbyForUser(userId);
		if (!lobby) return null;
		return this.cancelLobby(lobby.lobbyId);
	}

	private normalizePlayerCount(playerCount: number): number {
		return Math.max(
			MIN_PLAYERS,
			Math.min(MAX_PLAYERS, Math.floor(Number(playerCount || MIN_PLAYERS))),
		);
	}

	private normalizePin(pin: string): string {
		return String(pin ?? "")
			.trim()
			.toUpperCase();
	}

	private generateUniquePin(gameId: string): string {
		const prefix = this.getGamePinPrefix(gameId);
		let pin = "";
		do {
			pin = prefix + Array.from({ length: PIN_LENGTH - 1 }, () =>
				PIN_ALPHABET[Math.floor(Math.random() * PIN_ALPHABET.length)],
			).join("");
		} while (this.getLobbyByPin(pin));
		return pin;
	}

	private validatePinGame(pin: string, gameId: string): void {
		const expectedPrefix = PIN_GAME_PREFIXES[gameId];
		if (
			expectedPrefix === undefined ||
			!this.normalizePin(pin).startsWith(expectedPrefix)
		) {
			throw new BadRequestException(PRIVATE_LOBBY_NOT_FOUND_MESSAGE);
		}
	}

	private getGamePinPrefix(gameId: string): string {
		const prefix = PIN_GAME_PREFIXES[gameId];
		if (prefix === undefined) {
			throw new BadRequestException("Unknown game for private room");
		}
		return prefix;
	}
}
