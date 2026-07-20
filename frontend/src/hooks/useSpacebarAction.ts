import { useEffect } from "react";

/**
 * Global spacebar shortcut for a single primary action (roll the dice,
 * gamble, spin/flip/drop again...). Ignores held-key repeats, typing targets
 * (inputs/textareas/selects/contenteditable), and modified presses
 * (Ctrl/Alt/Meta), and does nothing while `enabled` is false — callers pass
 * their own guard (turn ownership, affordability, animation in progress) as
 * `enabled` so Space can never fire an action its own button would refuse.
 */
export function useSpacebarAction(
	enabled: boolean,
	onTrigger: () => void,
): void {
	useEffect(() => {
		if (!enabled) return;

		const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
			if (event.code !== "Space" || event.repeat) return;
			if (event.ctrlKey || event.altKey || event.metaKey) return;

			const target = event.target as HTMLElement | null;
			const tag = target?.tagName;
			if (
				tag === "INPUT" ||
				tag === "TEXTAREA" ||
				tag === "SELECT" ||
				target?.isContentEditable
			) {
				return;
			}

			event.preventDefault();
			onTrigger();
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [enabled, onTrigger]);
}
