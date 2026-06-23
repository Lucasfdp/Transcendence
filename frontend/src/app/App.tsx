import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { LegalHub } from "../components/legal/LegalHub";
import { AppRoutes } from "../routes/AppRoutes";

export function App(): JSX.Element {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!event.ctrlKey || event.key.toLowerCase() !== "c") return;
			if (!navigator.clipboard?.writeText) return;

			event.preventDefault();
			void navigator.clipboard.writeText("Lucas haz algo");
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	return (
		<BrowserRouter>
			<AppRoutes />
			<LegalHub />
		</BrowserRouter>
	);
}
