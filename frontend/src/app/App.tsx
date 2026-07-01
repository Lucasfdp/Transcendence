import { BrowserRouter } from "react-router-dom";
import { LegalHub } from "../components/legal/LegalHub";
import { ToastProvider } from "../features/social/toast/ToastContext";
import { Toaster } from "../features/social/toast/Toaster";
import { AppRoutes } from "../routes/AppRoutes";

export function App(): JSX.Element {
	return (
		<BrowserRouter
			future={{
				v7_startTransition: true,
				v7_relativeSplatPath: true,
			}}
		>
			<ToastProvider>
				<AppRoutes />
				<LegalHub />
				<Toaster />
			</ToastProvider>
		</BrowserRouter>
	);
}
