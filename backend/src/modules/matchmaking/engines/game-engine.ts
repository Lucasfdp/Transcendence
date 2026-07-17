import { MatchMode } from "../entities/match.entity";
import {
	GameInputPayload,
	GameSnapshot,
	MatchRoom,
	RoomPlayer,
	SocketUser,
} from "../matchmaking.types";

export interface GameEngineCreateContext {
	matchId: string;
	gameId: string;
	mode: MatchMode;
	powerupsEnabled?: boolean;
	players: Array<{
		socketId: string;
		user: SocketUser;
		shellSelection: string[];
	}>;
}

export interface GameEngine {
	readonly gameId: string;
	/**
	 * Seatable player-count bounds. Previously implicit (the queue seats 2–5
	 * everywhere); made explicit so programmatic orchestrators (e.g. the
	 * Tournament module) can build their candidate catalog from the registry
	 * instead of duplicating a game list.
	 */
	readonly minPlayers: number;
	readonly maxPlayers: number;
	createInitialState(
		context: GameEngineCreateContext,
		roomPlayers: RoomPlayer[],
	): GameSnapshot;
	start(room: MatchRoom): void;
	handleInput(
		room: MatchRoom,
		userId: number,
		input: GameInputPayload,
	): MatchRoom | null;
	advanceSimulation?(room: MatchRoom, elapsedMs: number): boolean;
	abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null;
	onRoomClosed?(room: MatchRoom): void;
}
