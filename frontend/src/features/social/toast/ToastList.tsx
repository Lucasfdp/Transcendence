/**
 * Presentational toast stack. Pure — takes the toast array and a dismiss
 * callback as props so it can be tested without the context/provider.
 */
import { type Toast } from "./ToastContext";

const toastVariantClasses: Record<Toast["variant"], string> = {
	success: "border-l-[3px] border-l-[#6fcf97]",
	error: "border-l-[3px] border-l-[var(--accent-strong)]",
	info: "border-l-[3px] border-l-[var(--accent)]",
};

interface ToastListProps {
	toasts: Toast[];
	onDismiss: (id: string) => void;
}

export function ToastList({
	toasts,
	onDismiss,
}: ToastListProps): JSX.Element | null {
	if (toasts.length === 0) return null;

	return (
		<div
			className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex max-w-[min(92vw,360px)] flex-col gap-2"
			role="region"
			aria-label="Notifications"
			aria-live="polite"
		>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`pointer-events-auto flex animate-toast-in items-center gap-[0.6rem] rounded-[10px] border border-[var(--line)] bg-[var(--panel)] px-3 py-[0.6rem] font-body text-[0.85rem] text-[var(--text)] shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-[8px] motion-reduce:animate-none ${toastVariantClasses[toast.variant]}`}
					role="status"
				>
					<span className="flex-auto leading-[1.3]">{toast.message}</span>
					{toast.action ? (
						<button
							type="button"
							className="flex-none cursor-pointer rounded-md border border-[var(--accent)] bg-transparent px-[0.55rem] py-[0.2rem] text-[0.78rem] text-[var(--accent)] hover:bg-[rgba(241,211,145,0.12)]"
							onClick={() => {
								toast.action?.onAction();
								onDismiss(toast.id);
							}}
						>
							{toast.action.label}
						</button>
					) : null}
					<button
						type="button"
						className="flex-none cursor-pointer border-0 bg-transparent px-[0.15rem] py-0 text-[1.1rem] leading-none text-[var(--muted)] hover:text-[var(--text)]"
						aria-label="Dismiss notification"
						onClick={() => onDismiss(toast.id)}
					>
						×
					</button>
				</div>
			))}
		</div>
	);
}
