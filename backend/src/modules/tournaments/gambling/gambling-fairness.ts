/**
 * gambling-fairness.ts — the default provably-fair adapter (SPEC-016).
 *
 * This is the ONE place the Tournament reuses the existing casino's fairness
 * layer: it imports the pure `casino.fair` primitives (server seed, committed
 * hash, HMAC roll) and exposes them as the `GamblingFairness` port. It
 * duplicates NO fairness logic — the functions ARE the casino's — so a bet is
 * verifiable with the exact same procedure as a casino spin (SPEC-016
 * "Integración"/"Restricciones": importarla, nunca duplicarla; architect-
 * approved reuse). It never touches `users.coins`, `wagers` or the CasinoEngine.
 *
 * `generateServerSeed` uses `randomBytes` (non-deterministic) — allowed here
 * because the gambling outcome is deliberately outside the tournament's
 * deterministic layer (SPEC-000/016).
 */

import {
	computeRoll,
	generateServerSeed,
	hashSeed,
} from "../../casino/casino.fair";
import { GamblingFairness } from "./gambling.types";

/** The production fairness adapter backed by the existing casino primitives. */
export const CASINO_GAMBLING_FAIRNESS: GamblingFairness = {
	serverSeed: () => generateServerSeed(),
	commit: (serverSeed) => hashSeed(serverSeed),
	roll: (serverSeed, clientSeed, nonce) => computeRoll(serverSeed, clientSeed, nonce),
};
