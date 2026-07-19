export interface PlayerEntityConfig {
	readonly side: number;
	readonly shellSkin?: string | null;
	readonly renderMode?: "fullPlayer" | "shellOnly";
	readonly scale?: number;
	readonly alpha?: number;
	readonly spriteKey?: string;
	readonly trailColor?: number | null;
	readonly stateFlags?: readonly string[];
}

export interface PlayerCosmeticSnapshot {
	readonly side: number;
	readonly shellSkin?: string | null;
	readonly trailEffect?: string | null;
}

export interface PlayerCosmeticMaps {
	readonly shellSkins: Record<string, string>;
	readonly trailEffects: Record<string, string>;
}

interface PlayerCosmeticRegistry {
	set(key: string, value: unknown): unknown;
}

export const DEFAULT_PLAYER_SHELL_SKINS = [
	"base",
	"dragon",
	"bamboo",
	"purple",
	"base",
] as const;

export function resolvePlayerShellSkins(
	shellSkins: Record<string, string | undefined> | undefined,
	fallback: readonly string[] = DEFAULT_PLAYER_SHELL_SKINS,
	playerCount = fallback.length,
): string[] {
	return Array.from({ length: playerCount }, (_value, index) => {
		const key = `player${index}`;
		return shellSkins?.[key] ?? fallback[index] ?? "base";
	});
}

export function resolveSnapshotPlayerCosmetics(
	players: readonly PlayerCosmeticSnapshot[],
): PlayerCosmeticMaps {
	const shellSkins: Record<string, string> = {};
	const trailEffects: Record<string, string> = {};
	for (const player of players) {
		if (!Number.isInteger(player.side) || player.side < 0) continue;
		const key = `player${player.side}`;
		shellSkins[key] = player.shellSkin ?? "base";
		trailEffects[key] = player.trailEffect ?? "trail_classic";
	}
	return { shellSkins, trailEffects };
}

export function applySnapshotPlayerCosmetics(
	registry: PlayerCosmeticRegistry,
	players: readonly PlayerCosmeticSnapshot[],
): PlayerCosmeticMaps {
	const cosmetics = resolveSnapshotPlayerCosmetics(players);
	registry.set("shellSkins", cosmetics.shellSkins);
	registry.set("trailEffects", cosmetics.trailEffects);
	return cosmetics;
}
