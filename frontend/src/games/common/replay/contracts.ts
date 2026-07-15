export const REPLAY_CONTRACT_VERSION = 2 as const;
export const REPLAY_SAMPLE_MS = 50;
export const REPLAY_KEYFRAME_INTERVAL_MS = 1_000;
export const REPLAY_DISABLED_MESSAGE =
	"Replays are unavailable while power-ups are enabled.";

export type ReplayContractVersion = typeof REPLAY_CONTRACT_VERSION;
export type ReplayDisabledReason = "powerups-enabled" | null;

export interface ReplayParticipantV2 {
	side: number;
	userId: number | null;
	username: string;
	turtleName?: string | null;
	shellSkin?: string;
	trailEffect?: string;
	hubBackground?: string;
	hubBackgroundAlter?: string | null;
}

export interface ReplayMetadataV2 {
	contractVersion: ReplayContractVersion;
	origin: "local" | "online";
	gameId: string;
	mode: string;
	participants: ReplayParticipantV2[];
	durationMs: number;
	sampleHz: 20;
	keyframeIntervalMs: 1000;
	preRollMs: number;
	statistics: Record<string, unknown>;
	powerupsEnabled: false;
}

export interface ReplayEntityV2 {
	id: string;
	generation: number;
	ownerSide: number | null;
	x: number;
	y: number;
	vx: number;
	vy: number;
	rotation: number;
	visualState: Record<string, unknown>;
	motionSegmentId: number;
	interpolation: "linear" | "step";
}

export interface ReplayFrameV2 {
	seq: number;
	tMs: number;
	round: number;
	state: "pending" | "active" | "finished" | "abandoned";
	type: "keyframe" | "delta";
	changes: Record<string, unknown>;
	removals: string[];
}

export interface ReplayEventV2 {
	seq: number;
	tMs: number;
	round: number;
	type: string;
	payload: Record<string, unknown>;
}

export function replayAvailability(powerupsEnabled: boolean): {
	replayEnabled: boolean;
	replayDisabledReason: ReplayDisabledReason;
} {
	return powerupsEnabled
		? { replayEnabled: false, replayDisabledReason: "powerups-enabled" }
		: { replayEnabled: true, replayDisabledReason: null };
}
