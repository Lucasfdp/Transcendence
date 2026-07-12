import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Match, MatchMode } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
import { MatchRoom, SocketUser } from "./matchmaking.types";
import { RoomService } from "./room.service";

export interface MatchPlayerInput {
	socketId: string;
	user: SocketUser;
	shellSelection: string[];
}

export interface CreateMatchInput {
	gameId: string;
	mode: MatchMode;
	players: MatchPlayerInput[];
	powerupsEnabled?: boolean;
}

/**
 * Single entry point for turning a set of players into a playable match:
 * persists the `matches` row (status `pending`), builds the in-memory room
 * (which asks the game's engine for its initial snapshot), and persists one
 * `match_players` row per seated player.
 *
 * This sequence used to be duplicated verbatim across the three launch paths
 * (public queue, private lobbies, rematch). Any future system that needs to
 * start a match programmatically (e.g. a bracket orchestrator) should call
 * this instead of re-implementing the sequence.
 *
 * Scope note: this service only *creates* the pending match. Marking players
 * ready / starting the session stays with the caller (public matchmaking
 * waits for each client's `room:ready`, server-initiated launches force-start
 * — see MatchmakingGateway.startServerInitiatedMatch).
 */
@Injectable()
export class MatchFactoryService {
	constructor(
		@InjectRepository(Match) private readonly matchRepo: Repository<Match>,
		@InjectRepository(MatchPlayer)
		private readonly matchPlayerRepo: Repository<MatchPlayer>,
		private readonly roomService: RoomService,
	) {}

	async createMatch(input: CreateMatchInput): Promise<MatchRoom> {
		const { gameId, mode, players } = input;
		const match = await this.matchRepo.save(
			this.matchRepo.create({ gameId, mode, status: "pending" }),
		);
		const room = this.roomService.createRoom(match.id, gameId, mode, players, {
			powerupsEnabled: input.powerupsEnabled,
		});
		await this.matchPlayerRepo.save(
			room.players.map((player) =>
				this.matchPlayerRepo.create({
					matchId: match.id,
					userId: player.user.id,
					side: player.side,
					outcome: null,
					shellSelection: player.shellSelection,
				}),
			),
		);
		return room;
	}
}
