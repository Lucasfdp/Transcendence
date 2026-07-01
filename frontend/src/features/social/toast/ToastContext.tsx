/**
 * Lightweight toast system — context + provider + hook.
 *
 * Toasts auto-dismiss after a duration and support an optional action button
 * (used for "Undo"). The stack is capped so a burst of actions can't flood the
 * screen. Timers are tracked in a ref and cleared on dismissal to avoid leaks.
 */
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

export const DEFAULT_TOAST_DURATION_MS = 4000;
export const MAX_TOASTS = 4;

export type ToastVariant = "success" | "error" | "info";

export interface ToastAction {
	label: string;
	onAction: () => void;
}

export interface ToastOptions {
	message: string;
	variant?: ToastVariant;
	durationMs?: number;
	action?: ToastAction;
}

export interface Toast {
	id: string;
	message: string;
	variant: ToastVariant;
	action?: ToastAction;
}

interface ToastContextValue {
	toasts: Toast[];
	/** Show a toast; returns its generated id so callers can dismiss early. */
	showToast: (options: ToastOptions) => string;
	dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSeq = 0;
function nextToastId(): string {
	toastSeq += 1;
	return `toast-${toastSeq}-${Date.now()}`;
}

export function ToastProvider({
	children,
}: {
	children: ReactNode;
}): JSX.Element {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

	const clearTimer = useCallback((id: string) => {
		const timer = timers.current.get(id);
		if (timer) {
			clearTimeout(timer);
			timers.current.delete(id);
		}
	}, []);

	const dismissToast = useCallback(
		(id: string) => {
			clearTimer(id);
			setToasts((prev) => prev.filter((t) => t.id !== id));
		},
		[clearTimer],
	);

	const showToast = useCallback(
		(options: ToastOptions): string => {
			const id = nextToastId();
			const toast: Toast = {
				id,
				message: options.message,
				variant: options.variant ?? "info",
				action: options.action,
			};

			setToasts((prev) => {
				const next = [...prev, toast];
				// Enforce the cap by dropping the oldest toasts (and their timers).
				while (next.length > MAX_TOASTS) {
					const removed = next.shift();
					if (removed) clearTimer(removed.id);
				}
				return next;
			});

			const duration = options.durationMs ?? DEFAULT_TOAST_DURATION_MS;
			const timer = setTimeout(() => dismissToast(id), duration);
			timers.current.set(id, timer);
			return id;
		},
		[clearTimer, dismissToast],
	);

	const value = useMemo<ToastContextValue>(
		() => ({ toasts, showToast, dismissToast }),
		[toasts, showToast, dismissToast],
	);

	return (
		<ToastContext.Provider value={value}>{children}</ToastContext.Provider>
	);
}

export function useToast(): ToastContextValue {
	const ctx = useContext(ToastContext);
	if (!ctx) {
		throw new Error("useToast must be used within a ToastProvider");
	}
	return ctx;
}
