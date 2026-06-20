import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RouteLoading } from "../components/common/RouteLoading";
import { NineSliceButton } from "../components/common/NineSliceButton";
import { WorkInProgressModal } from "../components/common/WorkInProgressModal";
import { TempleBackdrop } from "../components/layout/TempleBackdrop";
import { ProtectedRoute } from "../routes/ProtectedRoute";
import { api, type User } from "../features/hub/api";

function HomeMenu(): JSX.Element {
	const navigate = useNavigate();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [player, setPlayer] = useState<User | null>(null);
	const [isLoadingPlayer, setIsLoadingPlayer] = useState(true);
	const [isTournamentModalOpen, setIsTournamentModalOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;

		void api
			.getMe()
			.then((user) => {
				if (!cancelled) {
					setPlayer(user);
				}
			})
			.catch((err: unknown) => {
				console.warn("[HomeMenu] Failed to load active player:", err);
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingPlayer(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const handleLogout = async () => {
		if (isLoggingOut) return;

		setIsLoggingOut(true);
		try {
			await api.logout();
		} catch (err: unknown) {
			console.warn("[HomeMenu] Logout failed, redirecting anyway:", err);
		} finally {
			navigate("/auth", { replace: true });
		}
	};

	if (isLoadingPlayer) {
		return <RouteLoading />;
	}

	const playerName = player?.username ?? "Player";

	return (
		<main className="menu-page">
			<TempleBackdrop pageClassName="menu-page" />

			<div className="menu-page__shell">
				<header className="menu-page__topbar">
					<div className="menu-page__player-chip">
						<span className="menu-page__player-label">Player</span>
						<strong className="menu-page__player-name">
							{playerName}
						</strong>
					</div>
					<NineSliceButton
						className="menu-page__logout-button"
						type="button"
						onClick={handleLogout}
						disabled={isLoggingOut}
					>
						{isLoggingOut ? "Closing session..." : "Logout"}
					</NineSliceButton>
				</header>

				<section className="menu-page__hero">
					<div className="menu-page__heading">
						<span className="menu-page__heading-line" />
						<h1 className="menu-page__choose-label">Choose Mode</h1>
						<span className="menu-page__heading-line" />
					</div>

					<div className="menu-page__mode-grid">
						<Link
							className="menu-page__mode-card menu-page__mode-card--normal"
							to="/game"
						>
							<span
								className="menu-page__mode-corners"
								aria-hidden="true"
							/>
							<span
								className="menu-page__mode-art menu-page__mode-art--normal"
								aria-hidden="true"
							/>
							<span className="menu-page__mode-title">
								Normal
							</span>
							<span
								className="menu-page__mode-divider"
								aria-hidden="true"
							/>
							<span className="menu-page__mode-description">
								Play a standard match.
							</span>
						</Link>

						<button
							className="menu-page__mode-card menu-page__mode-card--tournament"
							type="button"
							onClick={() => setIsTournamentModalOpen(true)}
						>
							<span
								className="menu-page__mode-corners"
								aria-hidden="true"
							/>
							<span
								className="menu-page__mode-art menu-page__mode-art--tournament"
								aria-hidden="true"
							/>
							<span className="menu-page__mode-title">
								Tournament
							</span>
							<span
								className="menu-page__mode-divider"
								aria-hidden="true"
							/>
							<span className="menu-page__mode-description">
								Compete for the top.
							</span>
						</button>
					</div>
				</section>
			</div>

			<WorkInProgressModal
				isOpen={isTournamentModalOpen}
				onClose={() => setIsTournamentModalOpen(false)}
				closeLabel="Return to Menu"
			/>
		</main>
	);
}

export function HomePage(): JSX.Element {
	return (
		<ProtectedRoute>
			<HomeMenu />
		</ProtectedRoute>
	);
}
