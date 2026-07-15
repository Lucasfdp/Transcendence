/**
 * Single source of truth for the four minigame ids, used to validate
 * `gameId` at every API boundary that accepts one from a client
 * (Rankings Bug Audit M1, H2).
 *
 * Before this constant existed, `gameId` validation was duplicated (or
 * missing) independently in the leaderboard controller and the game-results
 * DTO, and the only other list of the same four ids lived in the frontend
 * (`RANKED_GAMES`, `frontend/src/features/hub/api.ts`). Keep all three in
 * sync by hand — this file, `GameEngineRegistry`
 * (`matchmaking/engines/game-engine.registry.ts`, which derives its ids from
 * the engine instances rather than a constant) and the frontend list are
 * intentionally not wired together to avoid a circular module dependency
 * (`GameResultsModule` is imported by `MatchmakingModule`, not the other way
 * around).
 */
export const KNOWN_GAME_IDS = [
	"temple-curling",
	"bamboo-bash",
	"kame-knock",
	"bell-clash",
] as const;

export type KnownGameId = (typeof KNOWN_GAME_IDS)[number];
