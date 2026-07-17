import React, { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RouteLoading } from "../components/common/RouteLoading";
import { AuthPage } from "../pages/AuthPage";
import { HomePage } from "../pages/HomePage";
import { ProfilePage } from "../pages/ProfilePage";
import { ProtectedRoute } from "./ProtectedRoute";

const GamePage = React.lazy(() => import("./GamePage"));

export function AppRoutes(): JSX.Element {
	return (
		<Suspense fallback={<RouteLoading />}>
			<Routes>
				<Route path="/auth" element={<AuthPage />} />
				<Route
					path="/"
					element={
						<ProtectedRoute>
							<HomePage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="/profile/:username"
					element={
						<ProtectedRoute>
							<ProfilePage />
						</ProtectedRoute>
					}
				/>
				<Route
					path="/play/:gameId"
					element={
						<ProtectedRoute>
							<GamePage />
						</ProtectedRoute>
					}
				/>
				<Route path="/game" element={<Navigate to="/" replace />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</Suspense>
	);
}
