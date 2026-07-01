/**
 * Presentational toast stack. Pure — takes the toast array and a dismiss
 * callback as props so it can be tested without the context/provider.
 */
import { type Toast } from "./ToastContext";

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
			className="toast-stack"
			role="region"
			aria-label="Notifications"
			aria-live="polite"
		>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`toast toast--${toast.variant}`}
					role="status"
				>
					<span className="toast__message">{toast.message}</span>
					{toast.action ? (
						<button
							type="button"
							className="toast__action"
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
						className="toast__close"
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
