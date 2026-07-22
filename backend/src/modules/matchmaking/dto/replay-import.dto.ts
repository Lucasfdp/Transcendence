import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsIn,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	Max,
	Min,
} from "class-validator";
import type {
	MatchReplayEvent,
	MatchReplayFrame,
	ReplayMetadataV2,
} from "../entities/match-replay.entity";
import type { ReplayImportInput } from "../replay.service";

export class ReplayImportDto implements ReplayImportInput {
	@IsString()
	gameId: string;

	@IsString()
	mode: string;

	@IsIn(["finished", "abandoned"])
	status: "finished" | "abandoned";

	@IsOptional()
	@IsString()
	createdAt?: string;

	@IsOptional()
	@IsString()
	finishedAt?: string | null;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(4)
	winnerSide?: number | null;

	@IsObject()
	metadata: ReplayMetadataV2;

	@IsInt()
	@Min(0)
	durationMs: number;

	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(3000)
	frames: MatchReplayFrame[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(7200)
	events?: MatchReplayEvent[];
}
