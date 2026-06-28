/**
 * Browser-side provably-fair verification.
 *
 * Re-derives a spin's outcome from the revealed seeds using the Web Crypto API
 * and checks it against what the server returned. Mirrors the backend
 * (casino.fair.ts) byte-for-byte: SHA-256 for the seed commitment and
 * HMAC-SHA256 → top 32 bits → /2^32 for the roll.
 */
import type { SpinResult, WheelSegmentView } from "../../features/hub/api";
import { selectSegmentFrom } from "./wheel";

/** 2^32 — divisor mapping a 32-bit integer into [0, 1). */
const UINT32_RANGE = 0x1_0000_0000;

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

/** Recompute a roll in [0, 1) from the revealed seeds (matches the server). */
export async function computeRollBrowser(
	serverSeed: string,
	clientSeed: string,
	nonce: number,
): Promise<number> {
	const key = await globalThis.crypto.subtle.importKey(
		"raw",
		encoder.encode(serverSeed),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await globalThis.crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`${clientSeed}:${nonce}`),
	);
	const hex = toHex(signature).slice(0, 8);
	return parseInt(hex, 16) / UINT32_RANGE;
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
	const rollOk = Math.abs(computedRoll - roll) < 1e-9;
	const segmentOk = computedSegment.id === result.segment.id;

	return { hashOk, rollOk, segmentOk, ok: hashOk && rollOk && segmentOk };
}
