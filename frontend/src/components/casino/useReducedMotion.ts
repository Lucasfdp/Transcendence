/**
 * Shared `prefers-reduced-motion` hook for the casino games.
 *
 * Every cosmetic drop/spin/shuffle/reel/roll animation in the casino must
 * check this before starting and, if it's `true`, skip straight to showing
 * the already-resolved result instead of animating — the same contract
 * Shell Drop's canvas board follows. Reactive: flips live if the player
 * toggles the OS/browser setting while a modal is open, which a one-off
 * `matchMedia(...).matches` read (evaluated once at animation start) would
 * miss.
 */
import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the user has requested reduced motion at the OS/browser level. */
export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() => globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
	);

	useEffect(() => {
		const query = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
		if (!query) return;
		const onChange = (): void => setReduced(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return reduced;
}
