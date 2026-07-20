import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import { KNOWN_GAME_IDS } from "../game-ids.constants";

/**
 * Body shape accepted from the public `POST /game-results` endpoint
 * (Rankings Bug Audit H2).
 *
 * The previous `SubmitResultDto` accepted any `gameId` string and any of
 * win/loss/draw/completed as `outcome` straight from an authenticated
 * client. `GameResultsService.updateGameStats` increments `totalWins` on
 * `outcome === "win"`, and the overall leaderboard ranks by
 * `SUM(totalWins)` — so any logged-in user could loop this endpoint with
 * `{ gameId: "kame-knock", outcome: "win" }` to top the global board and
 * farm XP/coins in the process. There was no server-side verification that
 * a match had even happened.
 *
 * Server-authoritative online matches never call this HTTP endpoint —
 * `GameSessionService.persistFinishedRoom` calls
 * `GameResultsService.submitResult()` directly, in-process, with the real
 * win/loss/draw outcome it computed from match state. Every legitimate
 * *client* call (all four game scenes, e.g. `KameKnockScene.ts`) only ever
 * submits `outcome: "completed"` for locally-scored practice play. So the
 * only outcome a client can legitimately report over HTTP is "completed" —
 * win/loss/draw counters (and the `totalWins` they feed into the
 * leaderboard) must only ever come from the trusted server path. `gameId`
 * is restricted to the known minigame ids for the same reason validated at
 * `GET /leaderboard` (Bug Audit M1) — an arbitrary string is otherwise free
 * per-game stats-farming surface.
 */
export class SubmitLocalResultDto {
	@IsIn(KNOWN_GAME_IDS)
	gameId: (typeof KNOWN_GAME_IDS)[number];

	@IsIn(["completed"])
	outcome: "completed";

	/**
	 * PERFECT rounds achieved this match (Kame Knock). Same trust class as the
	 * `completed` participation claim itself: it feeds the achievement ladder
	 * only, never win/loss counters or the leaderboard, and is bounded per
	 * submission (a match has a handful of rounds at most).
	 */
	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(20)
	perfectRounds?: number;
}
