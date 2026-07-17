import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FriendsModule } from "../friends/friends.module";
import { MatchmakingModule } from "../matchmaking/matchmaking.module";
import { Match } from "../matchmaking/entities/match.entity";
import { MatchPlayer } from "../matchmaking/entities/match-player.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { PresenceModule } from "../presence/presence.module";
import { Profile } from "../profiles/entities/profile.entity";
import { User } from "../users/entities/user.entity";
import { Tournament } from "./entities/tournament.entity";
import { TournamentMatch } from "./entities/tournament-match.entity";
import { TournamentParticipant } from "./entities/tournament-participant.entity";
import { SystemClock } from "./infra/clock";
import {
	TOURNAMENT_RUNTIME_CLOCK_FACTORY,
	TournamentRuntimeService,
} from "./runtime/tournament-runtime.service";
import { TournamentGateway } from "./tournament.gateway";
import { TournamentLobbyService } from "./tournament-lobby.service";
import { TournamentMinigameAdapter } from "./tournament-minigame.adapter";
import { TournamentSyncService } from "./tournament-sync.service";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsService } from "./tournaments.service";

/**
 * Tournament — The Parrot's Shell board-game mode (SPEC-037).
 *
 * All Tournament code lives in this single module. Minigame matches are
 * linked to `matches` through the `tournament_matches` bridge table — no
 * new MatchMode is ever introduced.
 *
 * Entry & lobby (SPEC-038) reuses the platform rails instead of rebuilding
 * them: FriendsModule validates invitations, NotificationsModule delivers
 * the persisted `tournament_invite` bell entry and the ephemeral lobby
 * pushes, PresenceModule backs the participant `ready` flag. The User
 * repository is imported directly (not UsersModule) — same anti-cycle
 * pattern as FriendsModule.
 *
 * Runtime (SPEC-001/SPEC-023, Phase 1): TournamentRuntimeService is a plain
 * one-directional dependency of TournamentLobbyService (the lobby calls it
 * on `start()`) — it never depends back on the lobby, so no DI cycle. The
 * clock factory defaults to SystemClock in production; tests override the
 * `TOURNAMENT_RUNTIME_CLOCK_FACTORY` token with a ManualClock factory.
 *
 * Networking (SPEC-022, Vertical Slice): TournamentGateway shares the
 * platform's `/ws/` Socket.IO server (auth stays in the matchmaking
 * gateway's connection handler); TournamentSyncService broadcasts the
 * snapshot-first state to `tournament:<id>` rooms. The lobby attaches the
 * sync on `start()` — one-directional again, no cycles.
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([
			Tournament,
			TournamentParticipant,
			TournamentMatch,
			User,
			Profile,
			Match,
			MatchPlayer,
		]),
		FriendsModule,
		MatchmakingModule,
		NotificationsModule,
		PresenceModule,
	],
	controllers: [TournamentsController],
	providers: [
		TournamentsService,
		TournamentLobbyService,
		TournamentRuntimeService,
		TournamentSyncService,
		TournamentGateway,
		TournamentMinigameAdapter,
		{
			provide: TOURNAMENT_RUNTIME_CLOCK_FACTORY,
			useValue: () => new SystemClock(),
		},
	],
	exports: [TournamentsService, TournamentLobbyService, TournamentRuntimeService],
})
export class TournamentsModule {}
