/**
 * Browser-side provably-fair verification.
 *
 * Re-derives a spin's outcome from the revealed seeds using the Web Crypto API
 * and checks it against what the server returned. Mirrors the backend
 * (casino.fair.ts) byte-for-byte: SHA-256 for the seed commitment and
 * HMAC-SHA256 → top 32 bits → /2^32 for the roll.
 */
import type {
	DiceDirection,
	MonteRoundResolution,
	SlotSymbolView,
	SpinResolution,
	SpinResult,
	WheelSegmentView,
} from "./contracts";
import { diceOutcomeId, diceValue } from "./dice";
import { flipSide } from "./flip";
import { applyShuffle, monteOutcomeId, winningShell } from "./monte";
import { bucketIndexFromRolls, plinkoOutcomeId } from "./plinko";
import { selectSymbolFrom, slotsOutcomeId } from "./slots";
import { selectSegmentFrom } from "./wheel";

/** 2^32 — divisor mapping a 32-bit integer into [0, 1). */
const UINT32_RANGE = 0x1_0000_0000;

/** Tolerance when comparing a recomputed roll to the server's. */
const ROLL_EPSILON = 1e-9;

const encoder = new TextEncoder();

/** Lowercase hex of an ArrayBuffer. */
function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** SHA-256 hex digest of a string. */
export async function sha256Hex(input: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		encoder.encode(input),
	);
	return toHex(digest);
}

/** Import a server seed as an HMAC-SHA256 signing key. */
async function importHmacKey(serverSeed: string): Promise<CryptoKey> {
	return globalThis.crypto.subtle.importKey(
		"raw",
		encoder.encode(serverSeed),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
}

/** Top 32 bits of an HMAC signature mapped into [0, 1). */
async function rollFromMessage(
	key: CryptoKey,
	message: string,
): Promise<number> {
	const signature = await globalThis.crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(message),
	);
	const hex = toHex(signature).slice(0, 8);
	return parseInt(hex, 16) / UINT32_RANGE;
}

/** Recompute a roll in [0, 1) from the revealed seeds (matches the server). */
export async function computeRollBrowser(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
): Promise<number> {
	const key = await importHmacKey(serverSeed);
	return rollFromMessage(key, `${clientSeed}:${nonce}`);
}

/**
 * Recompute `count` independent rolls for one multi-roll spin — the browser
 * mirror of the backend's `computeRolls`. Each reel appends its index to the
 * HMAC message (`"<clientSeed>:<nonce>:<i>"`).
 */
export async function computeRollsBrowser(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
	count: number,
): Promise<number[]> {
	const key = await importHmacKey(serverSeed);
	const rolls: number[] = [];
	for (let index = 0; index < count; index++) {
		rolls.push(await rollFromMessage(key, `${clientSeed}:${nonce}:${index}`));
	}
	return rolls;
}

/** The result of independently verifying a spin in the browser. */
export interface FairnessCheck {
	/** Revealed server seed hashes to the committed hash. */
	hashOk: boolean;
	/** Recomputed roll matches the server's roll. */
	rollOk: boolean;
	/** Recomputed roll resolves to the same winning segment. */
	segmentOk: boolean;
	/** All checks passed. */
	ok: boolean;
}

/** Verify a resolved spin against the wheel layout the client was shown. */
export async function verifySpin(
	result: SpinResult,
	segments: readonly WheelSegmentView[],
): Promise<FairnessCheck> {
	const { serverSeed, serverSeedHash, clientSeed, nonce, roll } =
		result.fairness;

	const computedHash = await sha256Hex(serverSeed);
	const computedRoll = await computeRollBrowser(serverSeed, clientSeed, nonce);
	const computedSegment = selectSegmentFrom(segments, computedRoll);

	const hashOk = computedHash === serverSeedHash;
	const rollOk = Math.abs(computedRoll - roll) < ROLL_EPSILON;
	const segmentOk = computedSegment.id === result.segment.id;

	return { hashOk, rollOk, segmentOk, ok: hashOk && rollOk && segmentOk };
}

/** Independent verification of any single- or multi-roll game's resolution. */
export interface OutcomeFairnessCheck {
	/** Revealed server seed hashes to the committed hash. */
	hashOk: boolean;
	/** Recomputed roll(s) match the server's. */
	rollOk: boolean;
	/** Recomputed roll(s) resolve to the same outcome id. */
	outcomeOk: boolean;
	/** All checks passed. */
	ok: boolean;
}

/**
 * Verify a generic spin resolution: recompute the hash and the roll(s), then let
 * the caller re-derive the `outcomeId` from those rolls and compare it to the
 * server's. Single-roll games recompute with `computeRollBrowser`; multi-roll
 * games (more than one roll) use `computeRollsBrowser`, mirroring the engine.
 */
export async function verifyResolution(
	result: SpinResolution,
	recomputeOutcome: (rolls: number[]) => string,
): Promise<OutcomeFairnessCheck> {
	const { serverSeed, serverSeedHash, clientSeed, nonce, roll, rolls } =
		result.fairness;

	const computedHash = await sha256Hex(serverSeed);
	const computedRolls =
		rolls.length <= 1
			? [await computeRollBrowser(serverSeed, clientSeed, nonce)]
			: await computeRollsBrowser(serverSeed, clientSeed, nonce, rolls.length);

	const hashOk = computedHash === serverSeedHash;
	const rollOk =
		computedRolls.length === rolls.length &&
		computedRolls.every((r, i) => Math.abs(r - rolls[i]) < ROLL_EPSILON) &&
		Math.abs(computedRolls[0] - roll) < ROLL_EPSILON;
	const outcomeOk = recomputeOutcome(computedRolls) === result.outcomeId;

	return { hashOk, rollOk, outcomeOk, ok: hashOk && rollOk && outcomeOk };
}

/** Verify a Shell Flip resolution by recomputing the landed side. */
export function verifyFlip(
	result: SpinResolution,
): Promise<OutcomeFairnessCheck> {
	return verifyResolution(result, (computedRolls) => flipSide(computedRolls[0]));
}

/**
 * Verify a Three-Shell Monte resolution by recomputing the pearl's shell. The
 * shell count isn't carried on the result, so the caller supplies the count it
 * played with.
 */
export function verifyMonte(
	result: SpinResolution,
	shells: number,
): Promise<OutcomeFairnessCheck> {
	return verifyResolution(result, (computedRolls) =>
		monteOutcomeId(winningShell(computedRolls[0], shells)),
	);
}

/** The three swaps possible with three cups — must match the backend order. */
const MONTE_SWAP_CHOICES: readonly [number, number][] = [
	[0, 1],
	[0, 2],
	[1, 2],
];

/** Recompute the server-authored shuffle from the revealed seed. */
async function computeShuffleBrowser(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
	steps: number,
): Promise<[number, number][]> {
	const key = await importHmacKey(serverSeed);
	const shuffle: [number, number][] = [];
	for (let step = 0; step < steps; step++) {
		const roll = await rollFromMessage(
			key,
			`${clientSeed}:${nonce}:shuffle:${step}`,
		);
		const index = Math.min(
			Math.floor(roll * MONTE_SWAP_CHOICES.length),
			MONTE_SWAP_CHOICES.length - 1,
		);
		shuffle.push([...MONTE_SWAP_CHOICES[index]]);
	}
	return shuffle;
}

/**
 * Verify a Monte round after the server reveals its seed: recompute the start
 * slot, the whole shuffle and the winning slot, then confirm they match what
 * the server returned and that the win/loss call follows from the chosen slot.
 */
export async function verifyMonteRound(
	result: MonteRoundResolution,
): Promise<OutcomeFairnessCheck> {
	const { serverSeed, serverSeedHash, clientSeed, nonce, roll, rolls, commitHash } =
		result.fairness;

	const computedHash = await sha256Hex(serverSeed);
	const computedRoll = await computeRollBrowser(serverSeed, clientSeed, nonce);
	const computedStartSlot = winningShell(computedRoll, result.cupIds.length);
	const computedShuffle = await computeShuffleBrowser(
		serverSeed,
		clientSeed,
		nonce,
		result.shuffle.length,
	);
	const computedWinningSlot = applyShuffle(computedStartSlot, computedShuffle);
	const computedCommit = await sha256Hex(
		`${serverSeed}:${clientSeed}:${nonce}:${computedStartSlot}:${computedWinningSlot}`,
	);

	const shuffleMatches =
		computedShuffle.length === result.shuffle.length &&
		computedShuffle.every(
			(pair, i) =>
				pair[0] === result.shuffle[i][0] && pair[1] === result.shuffle[i][1],
		);

	const hashOk = computedHash === serverSeedHash && computedCommit === commitHash;
	const rollOk =
		rolls.length === 1 &&
		Math.abs(computedRoll - rolls[0]) < ROLL_EPSILON &&
		Math.abs(computedRoll - roll) < ROLL_EPSILON;
	const outcomeOk =
		shuffleMatches &&
		computedStartSlot === result.ballStartSlot &&
		computedWinningSlot === result.winningSlot &&
		(result.selectedSlot === result.winningSlot) === result.won;

	return { hashOk, rollOk, outcomeOk, ok: hashOk && rollOk && outcomeOk };
}

/**
 * Verify a Koi Dice resolution by recomputing the rolled value. `direction`
 * and `target` aren't needed to re-derive the outcome id (only the rolled
 * value is — the server's win/loss decision follows deterministically from
 * it), but are accepted for call-site symmetry with `verifyMonte`/`verifySlots`
 * and so a future panel can also re-verify the win/loss call client-side.
 */
export function verifyDice(
	result: SpinResolution,
	_direction: DiceDirection,
	_target: number,
): Promise<OutcomeFairnessCheck> {
	return verifyResolution(result, (computedRolls) =>
		diceOutcomeId(diceValue(computedRolls[0])),
	);
}

/**
 * Verify a Shell Drop resolution by recomputing the landed bucket from the
 * revealed per-row rolls. `rows` isn't carried on the result, so the caller
 * supplies the row-count it played with (needed so `verifyResolution` draws
 * the right number of rolls via `computeRollsBrowser`).
 */
export function verifyPlinko(
	result: SpinResolution,
): Promise<OutcomeFairnessCheck> {
	return verifyResolution(result, (computedRolls) =>
		plinkoOutcomeId(bucketIndexFromRolls(computedRolls)),
	);
}

/**
 * Verify a Shrine Slots resolution by recomputing all three reels from the
 * revealed rolls and the symbol set the client was shown.
 */
export function verifySlots(
	result: SpinResolution,
	symbols: readonly SlotSymbolView[],
): Promise<OutcomeFairnessCheck> {
	return verifyResolution(result, (computedRolls) =>
		slotsOutcomeId(
			computedRolls.map((roll) => selectSymbolFrom(symbols, roll).id),
		),
	);
}
