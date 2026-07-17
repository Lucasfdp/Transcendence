import {
	Body,
	Controller,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { GuestGuard } from "../auth/guards/guest.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
	InviteTournamentDto,
	JoinTournamentByPinDto,
} from "./dto/tournaments.dto";
import {
	AddTournamentCpuResponse,
	CreateTournamentResponse,
	GetTournamentResponse,
	InviteTournamentResponse,
	JoinTournamentByPinResponse,
	JoinTournamentResponse,
	LeaveTournamentResponse,
	StartTournamentResponse,
} from "./tournaments.contracts";
import { TournamentLobbyService } from "./tournament-lobby.service";

/** Authenticated request: JwtAuthGuard attaches the decoded user. */
type AuthedRequest = { user: { id: number } };

/**
 * Tournament entry & lobby REST surface (SPEC-038, prefix /api/tournaments).
 *
 * Guards mirror the platform pattern (friends/casino controllers): JWT on
 * every route, CSRF on every mutation, and guests excluded from the ENTIRE
 * controller — a tournament is a durable social commitment, same policy as
 * ranked (SPEC-038).
 */
@ApiTags("tournaments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, GuestGuard)
@Controller("tournaments")
export class TournamentsController {
	constructor(private readonly lobbyService: TournamentLobbyService) {}

	/** POST /api/tournaments — create a lobby; the creator auto-joins. */
	@Post()
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	createLobby(
		@Request() req: AuthedRequest,
	): Promise<CreateTournamentResponse> {
		return this.lobbyService.createLobby(req.user.id);
	}

	/**
	 * POST /api/tournaments/join-pin — join a pending lobby by PIN.
	 * Declared before the `:id` routes so "join-pin" never parses as an id.
	 */
	@Post("join-pin")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	joinByPin(
		@Request() req: AuthedRequest,
		@Body() body: JoinTournamentByPinDto,
	): Promise<JoinTournamentByPinResponse> {
		return this.lobbyService.joinByPin(req.user.id, body.pin);
	}

	/**
	 * GET /api/tournaments/mine — the caller's current lobby, or null.
	 * Declared before the `:id` route so "mine" never parses as an id.
	 */
	@Get("mine")
	getMyTournament(
		@Request() req: AuthedRequest,
	): Promise<GetTournamentResponse | null> {
		return this.lobbyService.getMyLobby(req.user.id);
	}

	/** GET /api/tournaments/:id — lobby hydration (members and invitees). */
	@Get(":id")
	getTournament(
		@Request() req: AuthedRequest,
		@Param("id", ParseUUIDPipe) id: string,
	): Promise<GetTournamentResponse> {
		return this.lobbyService.getLobby(id, req.user.id);
	}

	/** POST /api/tournaments/:id/invite — creator invites a friend. */
	@Post(":id/invite")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	invite(
		@Request() req: AuthedRequest,
		@Param("id", ParseUUIDPipe) id: string,
		@Body() body: InviteTournamentDto,
	): Promise<InviteTournamentResponse> {
		return this.lobbyService.invite(id, req.user.id, body.userId);
	}

	/** POST /api/tournaments/:id/join — accept an invitation. */
	@Post(":id/join")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	join(
		@Request() req: AuthedRequest,
		@Param("id", ParseUUIDPipe) id: string,
	): Promise<JoinTournamentResponse> {
		return this.lobbyService.joinByInvite(id, req.user.id);
	}

	/** POST /api/tournaments/:id/add-cpu — creator seats a CPU participant. */
	@Post(":id/add-cpu")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	addCpu(
		@Request() req: AuthedRequest,
		@Param("id", ParseUUIDPipe) id: string,
	): Promise<AddTournamentCpuResponse> {
		return this.lobbyService.addCpu(id, req.user.id);
	}

	/** POST /api/tournaments/:id/leave — leave pre-start (creator cancels). */
	@Post(":id/leave")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	leave(
		@Request() req: AuthedRequest,
		@Param("id", ParseUUIDPipe) id: string,
	): Promise<LeaveTournamentResponse> {
		return this.lobbyService.leave(id, req.user.id);
	}

	/** POST /api/tournaments/:id/start — creator only; needs a full lobby. */
	@Post(":id/start")
	@HttpCode(200)
	@UseGuards(CsrfGuard)
	start(
		@Request() req: AuthedRequest,
		@Param("id", ParseUUIDPipe) id: string,
	): Promise<StartTournamentResponse> {
		return this.lobbyService.start(id, req.user.id);
	}
}
