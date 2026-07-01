/**
 * Minimal debounce utility: delays invoking `fn` until `delayMs` have
 * elapsed since the last `run()` call. Used to avoid firing a profile fetch
 * on every mouse-over as the pointer passes over the friends list.
 */
export interface Debounced<Args extends unknown[]> {
	run: (...args: Args) => void;
	cancel: () => void;
}

export function debounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	delayMs: number,
): Debounced<Args> {
	let timer: ReturnType<typeof setTimeout> | null = null;

	return {
		run: (...args: Args) => {
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				fn(...args);
			}, delayMs);
		},
		cancel: () => {
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}
