/**
 * Connected toast container — reads the live toast stack from context and
 * renders it. Mount once near the app root, inside <ToastProvider>.
 */
import { useToast } from "./ToastContext";
import { ToastList } from "./ToastList";

export function Toaster(): JSX.Element | null {
	const { toasts, dismissToast } = useToast();
	return <ToastList toasts={toasts} onDismiss={dismissToast} />;
}
