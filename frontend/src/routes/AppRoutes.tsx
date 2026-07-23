import React, { Suspense, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { InboxProvider } from "../app/inbox/InboxContext";
import { SessionProvider, useSession } from "../app/session/SessionContext";
import { RouteLoading } from "../components/common/RouteLoading";
import { AuthPage } from "../pages/AuthPage";
import { HomePage } from "../pages/HomePage";
import { ProfilePage } from "../pages/ProfilePage";
import { ProtectedRoute } from "./ProtectedRoute";

const GamePage = React.lazy(() => import("./GamePage"));
const TournamentPage = React.lazy(() => import("./TournamentPage"));

function SessionAwareRoutes(): JSX.Element {
	const location = useLocation();
	const previousPath = useRef(location.pathname);
	const { status, refreshSession } = useSession();
	const leavingAuth =
		previousPath.current === "/auth" && location.pathname !== "/auth";

	useEffect(() => {
		previousPath.current = location.pathname;
		if (leavingAuth && status === "unauthenticated") {
			void refreshSession(true).catch(() => undefined);
		}
	}, [leavingAuth, location.pathname, refreshSession, status]);

	if (leavingAuth && status === "unauthenticated") return <RouteLoading />;

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
				<Route
					path="/tournament/:tournamentId"
					element={
						<ProtectedRoute>
							<TournamentPage />
						</ProtectedRoute>
					}
				/>
				<Route path="/game" element={<Navigate to="/" replace />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</Suspense>
	);
}

export function AppRoutes(): JSX.Element {
	return (
		<SessionProvider>
			<InboxProvider>
				<SessionAwareRoutes />
			</InboxProvider>
		</SessionProvider>
	);
}
