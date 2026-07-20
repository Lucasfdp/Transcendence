/**
 * REST request DTOs for the Tournament entry & lobby flow (SPEC-038).
 *
 * class-validator classes consumed by the global ValidationPipe
 * ({ whitelist: true, transform: true } in main.ts). Each class implements
 * its request shape from tournaments.contracts.ts — the contracts file is
 * the single source of truth for the wire shapes.
 *
 * Endpoints without a body (create, join, leave, start) have no DTO.
 */

import { IsInt, IsPositive, IsString, Length, Matches } from "class-validator";
import {
	InviteTournamentRequest,
	JoinTournamentByPinRequest,
	RemoveTournamentCpuRequest,
	TOURNAMENT_PIN_LENGTH,
} from "../tournaments.contracts";

/** Body of POST /tournaments/:id/invite. */
export class InviteTournamentDto implements InviteTournamentRequest {
	@IsInt()
	@IsPositive()
	userId: number;
}

/** Body of POST /tournaments/:id/remove-cpu. */
export class RemoveTournamentCpuDto implements RemoveTournamentCpuRequest {
	@IsInt()
	@IsPositive()
	botUserId: number;
}

/** Body of POST /tournaments/join-pin. */
export class JoinTournamentByPinDto implements JoinTournamentByPinRequest {
	@IsString()
	@Length(TOURNAMENT_PIN_LENGTH, TOURNAMENT_PIN_LENGTH)
	@Matches(/^[a-zA-Z0-9]+$/)
	pin: string;
}
