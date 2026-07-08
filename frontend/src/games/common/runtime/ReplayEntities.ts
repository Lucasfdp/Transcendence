import type {
	BallSnapshotData,
	ReplayFrameSnapshotEntity,
} from "../../../services/network/gameSocket";
import {
	replayBallToEntity,
	replayStoneToEntity,
} from "../../shared/localReplay";

export type ReplayStoneSnapshot = Parameters<typeof replayStoneToEntity>[0];

export function buildReplayProjectileEntities(
	projectiles: readonly BallSnapshotData[],
	fallbackSpriteKey: string,
): ReplayFrameSnapshotEntity[] {
	return projectiles.map((projectile) =>
		replayBallToEntity(projectile, fallbackSpriteKey),
	);
}

export function buildReplayStoneEntities(
	stones: readonly ReplayStoneSnapshot[],
): ReplayFrameSnapshotEntity[] {
	return stones.map((stone) => replayStoneToEntity(stone));
}
