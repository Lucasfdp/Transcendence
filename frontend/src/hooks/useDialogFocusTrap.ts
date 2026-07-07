import { useEffect, type RefObject } from "react";

/** Selector for elements that can receive keyboard focus, used to build the Tab trap's cycle. */
export const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for a modal `role="dialog"`: moves focus onto
 * `initialFocusRef` (or the dialog container itself as a fallback) on mount,
 * traps Tab/Shift+Tab within `containerRef`, calls `onDismiss` on Escape, and
 * restores focus to whatever was focused before the dialog opened, on
 * unmount.
 *
 * Bug Audit M3: `RevealOverlay` used to declare `role="dialog" aria-modal`
 * with none of this — a keyboard user's focus stayed on the button behind
 * the overlay, Tab wandered the obscured binder, and Escape did nothing.
 * `CardLightbox` had the only working copy of this logic; this hook lifts it
 * out so both dialogs (and any future one) share a single implementation
 * instead of a third hand-rolled copy (HomePage.tsx's HubModal has its own
 * equivalent focus trap for the same reason).
 *
 * @param containerRef the dialog's root element — Tab is trapped inside it.
 * @param onDismiss called when Escape is pressed.
 * @param initialFocusRef element to focus on mount; falls back to the
 * container itself when omitted.
 */
export function useDialogFocusTrap(
	containerRef: RefObject<HTMLElement>,
	onDismiss: () => void,
	initialFocusRef?: RefObject<HTMLElement>,
): void {
	useEffect(() => {
		const previouslyFocused = document.activeElement as HTMLElement | null;
		(initialFocusRef?.current ?? containerRef.current)?.focus();

		const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
			if (event.key === "Escape") {
				onDismiss();
				return;
			}
			const container = containerRef.current;
			if (event.key !== "Tab" || !container) return;

			const focusable = Array.from(
				container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			);
			if (focusable.length === 0) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			previouslyFocused?.focus();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on mount/unmount, mirrors the original CardLightbox effect
	}, []);
}
