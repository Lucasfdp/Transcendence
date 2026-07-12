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
	advanceSimulation?(room: MatchRoom, deltaMs: number): boolean;
	abandon(room: MatchRoom, abandonedPlayer: RoomPlayer): number | null;
	onRoomClosed?(room: MatchRoom): void;
}
