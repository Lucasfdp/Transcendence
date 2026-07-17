/**
 * Tournament entry & lobby constants (SPEC-038, Phase 0).
 *
 * COMPATIBILITY LAYER: since Phase 1 these values are DERIVED from the
 * SPEC-024 declarative settings catalog (`config/settings.catalog.ts`) and
 * re-exported here under their Phase-0 names so existing consumers keep
 * compiling. New code should read the validated settings resolved by
 * `configId` through the Registry framework instead of importing this file.
 */

import { TOURNAMENT_SETTINGS_V1 } from "./config/settings.catalog";

/** Lobby expiry without completing (SPEC-038 v1): 10 minutes. */
export const TOURNAMENT_LOBBY_EXPIRY_MS =
	TOURNAMENT_SETTINGS_V1.timeouts.lobbyExpiryMinutes * 60 * 1_000;

/** Fixed tournament size (SPEC-024 / SPEC-038 v1): exactly 4 players. */
export const TOURNAMENT_PLAYERS = TOURNAMENT_SETTINGS_V1.playersPerTournament;

/** Default configuration catalog id stamped on new tournaments (SPEC-024). */
export const TOURNAMENT_DEFAULT_CONFIG_ID = TOURNAMENT_SETTINGS_V1.id;

/**
 * Persistent champion prize (SPEC-037 "Rewards" / D10): the ONLY bridge from
 * tournament points (ephemeral) to platform coins (persistent) — 500 coins to
 * the winner, granted once per tournament with `lockUserForUpdate`.
 */
export const TOURNAMENT_CHAMPION_COINS = 500;

/**
 * CPU participants (user-approved CPU v2): bot accounts are pooled users
 * identified by this reserved email domain — unreachable through registration
 * or OAuth, so a real account can never be mistaken for a bot. Display names
 * come from the pool below (collision-suffixed on creation).
 */
export const TOURNAMENT_BOT_EMAIL_DOMAIN = "bots.tournament.local";
export const TOURNAMENT_BOT_NAMES = [
	"CPU Kame",
	"CPU Shellby",
	"CPU Snapper",
	"CPU Bowser",
] as const;
