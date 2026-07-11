import {
	buildLocalReplayPlayers,
	type LocalReplayUser,
} from "../../shared/localReplay";
import type { SnapshotPlayer } from "../../../services/network/gameSocket";

export interface LocalReplayRegistry {
	get(key: string): unknown;
}

export function buildCommonLocalReplayPlayers(
	registry: LocalReplayRegistry,
	playerCount: number,
): SnapshotPlayer[] {
	const user = registry.get("user") as LocalReplayUser | undefined;
	return buildLocalReplayPlayers(user, playerCount, {
		shellSkins: registry.get("shellSkins") as Record<string, string>,
		trailEffects: registry.get("trailEffects") as Record<string, string>,
	});
}

export interface LocalReplayParticipantContext {
	readonly user: LocalReplayUser | undefined;
	readonly players: SnapshotPlayer[];
	readonly playerNames: string[];
}

export function buildCommonLocalReplayParticipantContext(
	registry: LocalReplayRegistry,
	playerCount: number,
): LocalReplayParticipantContext {
	const user = registry.get("user") as LocalReplayUser | undefined;
	const players = buildLocalReplayPlayers(user, playerCount, {
		shellSkins: registry.get("shellSkins") as Record<string, string>,
		trailEffects: registry.get("trailEffects") as Record<string, string>,
	});
	return {
		user,
		players,
		playerNames: players.map((player) => player.username),
	};
}
