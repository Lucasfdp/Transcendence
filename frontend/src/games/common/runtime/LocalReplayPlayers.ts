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
	});
}
