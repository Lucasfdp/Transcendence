/**
 * api.ts — typed REST client for the Tournament entry & lobby flow (SPEC-038).
 *
 * Thin wrappers over the shared `apiFetch` (credentials + CSRF + transient
 * retry) using the wire shapes from `contracts.ts`. Only the pre-start lobby
 * flow is exposed here — the active-game surface (snapshot/networking) is a
 * later phase (Vertical Slice).
 */

import { apiFetch } from "../hub/api";
import type {
	AddTournamentCpuResponse,
	CreateTournamentResponse,
	GetTournamentResponse,
	JoinTournamentByPinResponse,
	LeaveTournamentResponse,
	RemoveTournamentCpuResponse,
	StartTournamentResponse,
} from "./contracts";

export const tournamentApi = {
	/** POST /tournaments — create a lobby; the creator auto-joins. */
	create: (): Promise<CreateTournamentResponse> =>
		apiFetch<CreateTournamentResponse>("/tournaments", { method: "POST" }),

	/** GET /tournaments/:id — hydrate lobby state. */
	getLobby: (id: string): Promise<GetTournamentResponse> =>
		apiFetch<GetTournamentResponse>(`/tournaments/${id}`),

	/** GET /tournaments/mine — the caller's current lobby, or null. */
	getMine: (): Promise<GetTournamentResponse | null> =>
		apiFetch<GetTournamentResponse | null>("/tournaments/mine"),

	/** POST /tournaments/join-pin — join a pending lobby by PIN. */
	joinByPin: (pin: string): Promise<JoinTournamentByPinResponse> =>
		apiFetch<JoinTournamentByPinResponse>("/tournaments/join-pin", {
			method: "POST",
			body: JSON.stringify({ pin }),
		}),

	/** POST /tournaments/:id/leave — leave pre-start (creator cancels). */
	leave: (id: string): Promise<LeaveTournamentResponse> =>
		apiFetch<LeaveTournamentResponse>(`/tournaments/${id}/leave`, {
			method: "POST",
		}),

	/** POST /tournaments/:id/start — creator only; needs a full lobby. */
	start: (id: string): Promise<StartTournamentResponse> =>
		apiFetch<StartTournamentResponse>(`/tournaments/${id}/start`, {
			method: "POST",
		}),

	/** POST /tournaments/:id/add-cpu — creator seats a CPU participant. */
	addCpu: (id: string): Promise<AddTournamentCpuResponse> =>
		apiFetch<AddTournamentCpuResponse>(`/tournaments/${id}/add-cpu`, {
			method: "POST",
		}),

	/** POST /tournaments/:id/remove-cpu — creator unseats a CPU participant. */
	removeCpu: (
		id: string,
		botUserId: number,
	): Promise<RemoveTournamentCpuResponse> =>
		apiFetch<RemoveTournamentCpuResponse>(`/tournaments/${id}/remove-cpu`, {
			method: "POST",
			body: JSON.stringify({ botUserId }),
		}),
};
