import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "../routes/AppRoutes";

export function App(): JSX.Element {
	return (
		<BrowserRouter>
			<AppRoutes />
		</BrowserRouter>
	);
}
