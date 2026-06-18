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
	players: Array<{
		socketId: string;
		user: SocketUser;
		shellSelection: string[];
	}>;
}

export interface GameEngine {
	readonly gameId: string;
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
	abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null;
}
