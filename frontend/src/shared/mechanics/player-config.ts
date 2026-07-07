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
