import type {
	BallSnapshotData,
	ReplayFrameSnapshotEntity,
} from "../../../services/network/gameSocket";
import {
	replayBallToEntity,
	replayCurlingBallToEntity,
} from "../localReplay";

export type ReplayCurlingBallSnapshot = Parameters<typeof replayCurlingBallToEntity>[0];

export function buildReplayProjectileEntities(
	projectiles: readonly BallSnapshotData[],
	fallbackSpriteKey: string,
): ReplayFrameSnapshotEntity[] {
	return projectiles.map((projectile) =>
		replayBallToEntity(projectile, fallbackSpriteKey),
	);
}

export function buildReplayBallEntities(
	balls: readonly ReplayCurlingBallSnapshot[],
): ReplayFrameSnapshotEntity[] {
	return balls.map((ball) => replayCurlingBallToEntity(ball));
}
