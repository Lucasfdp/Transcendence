import { BrowserRouter } from "react-router-dom";
import { LegalHub } from "../components/legal/LegalHub";
import { AppRoutes } from "../routes/AppRoutes";

export function App(): JSX.Element {
	return (
		<BrowserRouter>
			<AppRoutes />
			<LegalHub />
		</BrowserRouter>
	);
}
