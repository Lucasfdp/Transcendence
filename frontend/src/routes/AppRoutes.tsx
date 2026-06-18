import React, { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RouteLoading } from "../components/common/RouteLoading";
import { AuthPage } from "../pages/AuthPage";
import { HomePage } from "../pages/HomePage";
import { ProtectedRoute } from "./ProtectedRoute";

const GamePage = React.lazy(() => import("./GamePage"));

export function AppRoutes(): JSX.Element {
	return (
		<Suspense fallback={<RouteLoading />}>
			<Routes>
				<Route path="/auth" element={<AuthPage />} />
				<Route path="/" element={<HomePage />} />
				<Route
					path="/game"
					element={
						<ProtectedRoute>
							<GamePage />
						</ProtectedRoute>
					}
				/>
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</Suspense>
	);
}
