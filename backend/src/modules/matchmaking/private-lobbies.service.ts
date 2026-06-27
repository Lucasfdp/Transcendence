import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { MatchPlayer } from "./entities/match-player.entity";
import { Match } from "./entities/match.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { RoomService } from "./room.service";
import { MatchRoom, SocketUser } from "./matchmaking.types";

export interface PrivateLobby {
	lobbyId: string;
	hostSocketId: string;
	host: SocketUser;
	gameId: string;
	shellSelection: string[];
	createdAt: number;
	/** Set when an invite is pending — cleared on accept/decline/cancel. */
	pendingInviteeId: number | null;
	expiryTimer: ReturnType<typeof setTimeout>;
}

export interface LobbyJoinResult {
	matchId: string;
	room: MatchRoom;
}

const LOBBY_EXPIRY_MS = 2 * 60 * 1_000; // 2 minutes

@Injectable()
export class PrivateLobbiesService {
	private readonly lobbies = new Map<string, PrivateLobby>();

	constructor(
		@InjectRepository(Match)
		private readonly matchRepo: Repository<Match>,
		@InjectRepository(MatchPlayer)
		private readonly matchPlayerRepo: Repository<MatchPlayer>,
		private readonly roomService: RoomService,
		private readonly engines: GameEngineRegistry,
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
			hostSocketId,
			host,
			gameId,
			shellSelection,
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

	getLobbyForUser(userId: number): PrivateLobby | null {
		for (const lobby of this.lobbies.values()) {
			if (lobby.host.id === userId) return lobby;
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

		// Prevent double-join
		if (this.roomService.hasActiveRoom(joiner.id)) {
			throw new BadRequestException("You are already in an active match");
		}

		this.cancelLobby(lobbyId); // clears timer + removes from map

		const match = await this.matchRepo.save(
			this.matchRepo.create({
				gameId: lobby.gameId,
				mode: "casual", // private lobbies are always casual
				status: "pending",
			}),
		);

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

		const room = this.roomService.createRoom(
			match.id,
			lobby.gameId,
			"casual",
			players,
		);

		await this.matchPlayerRepo.save(
			room.players.map((p) =>
				this.matchPlayerRepo.create({
					matchId: match.id,
					userId: p.user.id,
					side: p.side,
					outcome: null,
					shellSelection: p.shellSelection,
				}),
			),
		);

		return { matchId: match.id, room };
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
}
