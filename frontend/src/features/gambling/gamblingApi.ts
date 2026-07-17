/**
 * features/gambling/gamblingApi.ts — Gambling feature client.
 *
 * Uses the shared HTTP transport (services/api/apiClient) rather than
 * implementing its own fetch/CSRF/retry variant. None of these operations
 * pass `idempotent: true` — a lost response for a wagered spin can't be
 * distinguished from "already processed", so retrying risks double-spending
 * coins (mirrors the same rule previously documented in features/hub/api.ts).
 */

import { apiFetch } from "../../services/api/apiClient";
import type {
	DiceConfig,
	DiceDirection,
	FlipConfig,
	FlipSide,
	MonteConfig,
	MonteRoundResolution,
	MonteRoundStart,
	MonteRoundSteps,
	PlinkoView,
	SlotsView,
	SpinResolution,
	SpinResult,
	WheelView,
} from "./contracts";

export const gamblingApi = {
	/** Fetch the Fortune Wheel layout, odds, bounds, balance and free-spin state. */
	getWheel: (): Promise<WheelView> => apiFetch<WheelView>("/casino/wheel"),

	/** Take the daily free spin. Optional client seed feeds the provable roll. */
	spinFreeWheel: (clientSeed?: string): Promise<SpinResult> =>
		apiFetch<SpinResult>("/casino/wheel/free", {
			method: "POST",
			body: JSON.stringify({ clientSeed }),
		}),

	/** Stake coins on a wagered spin. Returns the outcome and new balance. */
	spinWheel: (stake: number, clientSeed?: string): Promise<SpinResult> =>
		apiFetch<SpinResult>("/casino/wheel/spin", {
			method: "POST",
			body: JSON.stringify({ stake, clientSeed }),
		}),

	/** Fetch the Shell Flip layout, multiplier, bounds and balance. */
	getFlip: (): Promise<FlipConfig> => apiFetch<FlipConfig>("/casino/flip"),

	/** Call a shell side and stake coins. Returns the outcome and new balance. */
	flip: (
		stake: number,
		pick: FlipSide,
		clientSeed?: string,
	): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/flip", {
			method: "POST",
			body: JSON.stringify({ stake, pick, clientSeed }),
		}),

	/** Fetch the Three-Shell Monte layout: risk tiers, RTP, bounds and balance. */
	getMonte: (): Promise<MonteConfig> => apiFetch<MonteConfig>("/casino/monte"),

	/** Start a committed Three-Shell Monte round. */
	startMonteRound: (
		stake: number,
		clientSeed?: string,
	): Promise<MonteRoundStart> =>
		apiFetch<MonteRoundStart>("/casino/monte/rounds", {
			method: "POST",
			body: JSON.stringify({ stake, clientSeed }),
		}),

	/** Poll the just-in-time swaps for an in-flight round. */
	getMonteSteps: (roundId: string): Promise<MonteRoundSteps> =>
		apiFetch<MonteRoundSteps>(
			`/casino/monte/rounds/${encodeURIComponent(roundId)}/steps`,
		),

	/** Resolve a committed Three-Shell Monte round with the chosen slot. */
	resolveMonteRound: (
		roundId: string,
		selectedSlot: number,
	): Promise<MonteRoundResolution> =>
		apiFetch<MonteRoundResolution>(
			`/casino/monte/rounds/${encodeURIComponent(roundId)}/resolve`,
			{
				method: "POST",
				body: JSON.stringify({ selectedSlot }),
			},
		),

	/** Fetch the Shrine Slots reel, paytable, RTP, bounds and balance. */
	getSlots: (): Promise<SlotsView> => apiFetch<SlotsView>("/casino/slots"),

	/** Stake coins and spin the reels. Returns the outcome and new balance. */
	spinSlots: (stake: number, clientSeed?: string): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/slots", {
			method: "POST",
			body: JSON.stringify({ stake, clientSeed }),
		}),

	/** Fetch the Koi Dice layout: range, target bounds, wager bounds and balance. */
	getDice: (): Promise<DiceConfig> => apiFetch<DiceConfig>("/casino/dice"),

	/** Bet a direction/target and stake coins. Returns the outcome and new balance. */
	dice: (
		stake: number,
		direction: DiceDirection,
		target: number,
		clientSeed?: string,
	): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/dice", {
			method: "POST",
			body: JSON.stringify({ stake, direction, target, clientSeed }),
		}),

	/** Fetch the Shell Drop layout: row tiers, paytables, bounds and balance. */
	getPlinko: (): Promise<PlinkoView> => apiFetch<PlinkoView>("/casino/plinko"),

	/** Pick a risk tier and stake coins. Returns the outcome and new balance. */
	dropPlinko: (
		stake: number,
		rows?: number,
		clientSeed?: string,
	): Promise<SpinResolution> =>
		apiFetch<SpinResolution>("/casino/plinko", {
			method: "POST",
			body: JSON.stringify({ stake, rows, clientSeed }),
		}),
};
