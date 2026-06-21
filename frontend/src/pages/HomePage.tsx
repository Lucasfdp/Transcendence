import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RouteLoading } from "../components/common/RouteLoading";
import { NineSliceButton } from "../components/common/NineSliceButton";
import { WorkInProgressModal } from "../components/common/WorkInProgressModal";
import { ProtectedRoute } from "../routes/ProtectedRoute";
import {
	Achievement,
	api,
	Cosmetic,
	LeaderboardEntry,
	MiniGameDefinition,
	type User,
} from "../features/hub/api";

type HubView = "choose" | "normal";
type InfoModal = { title: string; description: string } | null;

const GAME_ROUTES: Record<
	string,
	{ label: string; description: string; available?: boolean }
> = {
	"kame-knock": {
		label: "Kame Knock",
		description: "Precision shell shots in the dojo arena.",
		available: true,
	},
	"bamboo-bash": {
		label: "Bamboo Bash",
		description: "Two turtles, one bamboo ring, maximum chaos.",
		available: true,
	},
	"temple-curling": {
		label: "Temple Curling",
		description: "Slide stones across the temple sheet.",
		available: true,
	},
	"bell-clash": {
		label: "Bell Clash",
		description: "Strike the shrine bells before time runs out.",
		available: true,
	},
};

function HomeMenu(): JSX.Element {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const [view, setView] = useState<HubView>(() =>
		searchParams.get("view") === "normal" ? "normal" : "choose",
	);
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [player, setPlayer] = useState<User | null>(null);
	const [minigames, setMinigames] = useState<MiniGameDefinition[]>([]);
	const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isTournamentModalOpen, setIsTournamentModalOpen] = useState(false);
	const [infoModal, setInfoModal] = useState<InfoModal>(null);
	const [achievements, setAchievements] = useState<Achievement[] | null>(null);
	const [cosmetics, setCosmetics] = useState<Cosmetic[] | null>(null);
	const [modalError, setModalError] = useState("");
	const [activeModal, setActiveModal] = useState<
		"achievements" | "customization" | null
	>(null);

	useEffect(() => {
		let cancelled = false;

		async function loadHub(): Promise<void> {
			try {
				const [nextPlayer, nextMinigames, nextLeaderboard] =
					await Promise.all([
						api.getMe(),
						api.getMiniGames().catch(() => []),
						api.getLeaderboard().catch(() => []),
					]);

				if (!cancelled) {
					setPlayer(nextPlayer);
					setMinigames(nextMinigames);
					setLeaderboard(nextLeaderboard.slice(0, 5));
				}
			} catch (err: unknown) {
				console.warn("[HomeMenu] Failed to load hub:", err);
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		}

		void loadHub();
		return () => {
			cancelled = true;
		};
	}, []);

	const gameCards = useMemo(() => {
		const apiGames = new Map(minigames.map((game) => [game.id, game]));
		const knownGames = Object.entries(GAME_ROUTES).map(([id, meta]) => {
			const apiGame = apiGames.get(id);
			return {
				id,
				name: apiGame?.name ?? meta.label,
				description: apiGame?.description ?? meta.description,
				available:
					meta.available === true || apiGame?.status === "available",
			};
		});

		const extraGames = minigames
			.filter((game) => !GAME_ROUTES[game.id])
			.map((game) => ({
				id: game.id,
				name: game.name,
				description: game.description,
				available: game.status === "available",
			}));

		return [...knownGames, ...extraGames];
	}, [minigames]);

	const handleLogout = async () => {
		if (isLoggingOut) return;

		setIsLoggingOut(true);
		try {
			await api.getCsrfToken();
			await api.logout();
		} catch (err: unknown) {
			console.warn("[HomeMenu] Logout failed, redirecting anyway:", err);
		} finally {
			navigate("/auth", { replace: true });
		}
	};

	const openAchievements = async () => {
		setActiveModal("achievements");
		setModalError("");
		setAchievements(null);
		try {
			setAchievements(await api.getAchievements());
		} catch {
			setModalError("Could not load achievements. Try again later.");
		}
	};

	const openCustomization = async () => {
		setActiveModal("customization");
		setModalError("");
		setCosmetics(null);
		try {
			setCosmetics(await api.getCustomization());
		} catch {
			setModalError("Could not load customization. Try again later.");
		}
	};

	const handleCosmeticAction = async (cosmetic: Cosmetic) => {
		setModalError("");
		try {
			await api.getCsrfToken();
			const nextCosmetics = cosmetic.owned
				? await api.equipCosmetic(cosmetic.id)
				: await api.buyCosmetic(cosmetic.id);
			setCosmetics(nextCosmetics);
			const equipped = nextCosmetics.find(
				(item) => item.equipped && item.type === cosmetic.type,
			);
			if (equipped && player) {
				setPlayer({
					...player,
					...(equipped.type === "hub_background"
						? { hubBackground: equipped.id }
						: { shellSkin: equipped.id }),
				});
			}
		} catch {
			setModalError("Could not update customization.");
		}
	};

	if (isLoading) return <RouteLoading />;

	const playerName = player?.turtleName ?? player?.username ?? "Player";
	const backgroundClass =
		player?.hubBackground === "sunset_bg"
			? "hub-page--sunset"
			: "hub-page--night";

	return (
		<main className={`menu-page hub-page ${backgroundClass}`}>
			<div className="menu-page__shell hub-page__shell">
				<header className="menu-page__topbar hub-page__topbar">
					<button
						className="hub-page__player-card"
						type="button"
						onClick={() =>
							setInfoModal({
								title: playerName,
								description: `Level ${player?.level ?? 1} turtle with ${player?.coins ?? 0} coins and ${player?.xp ?? 0} XP.`,
							})
						}
					>
						<span className="menu-page__player-label">Player</span>
						<strong className="menu-page__player-name">{playerName}</strong>
						<span className="hub-page__player-meta">
							Lvl {player?.level ?? 1} · Shell {player?.shellSkin ?? "kanagawa"} · ⬡ {player?.coins ?? 0}
						</span>
					</button>

					<NineSliceButton
						className="menu-page__logout-button"
						type="button"
						onClick={handleLogout}
						disabled={isLoggingOut}
					>
						{isLoggingOut ? "Closing session..." : "Logout"}
					</NineSliceButton>
				</header>

				<section className="hub-page__content">
					<aside className="hub-panel hub-page__extras">
						<h2>Dojo Extras</h2>
						<button
							type="button"
							className="hub-panel__button"
							onClick={() =>
								setInfoModal({
									title: "Shell Cards",
									description:
										"A new card challenge is being prepared for the dojo.",
								})
							}
						>
							Shell Cards
						</button>
						<button
							type="button"
							className="hub-panel__button"
							onClick={openAchievements}
						>
							Achievements
						</button>
						<button
							type="button"
							className="hub-panel__button"
							onClick={openCustomization}
						>
							Customization
						</button>
					</aside>

					<section className="hub-page__stage">
						<div className="menu-page__heading">
							<span className="menu-page__heading-line" />
							<h1 className="menu-page__choose-label">
								{view === "choose" ? "Choose Mode" : "Normal"}
							</h1>
							<span className="menu-page__heading-line" />
						</div>

						{view === "choose" ? (
							<div className="menu-page__mode-grid hub-page__mode-grid">
								<button
									className="menu-page__mode-card menu-page__mode-card--normal"
									type="button"
									onClick={() => setView("normal")}
								>
									<span className="menu-page__mode-corners" aria-hidden="true" />
									<span className="menu-page__mode-art menu-page__mode-art--normal" aria-hidden="true" />
									<span className="menu-page__mode-title">Normal</span>
									<span className="menu-page__mode-divider" aria-hidden="true" />
									<span className="menu-page__mode-description">Play a standard match.</span>
								</button>

								<button
									className="menu-page__mode-card menu-page__mode-card--tournament"
									type="button"
									onClick={() => setIsTournamentModalOpen(true)}
								>
									<span className="menu-page__mode-corners" aria-hidden="true" />
									<span className="menu-page__mode-art menu-page__mode-art--tournament" aria-hidden="true" />
									<span className="menu-page__mode-title">Tournament</span>
									<span className="menu-page__mode-divider" aria-hidden="true" />
									<span className="menu-page__mode-description">Compete for the top.</span>
								</button>
							</div>
						) : (
							<div className="hub-page__game-grid">
								{gameCards.map((game) =>
									game.available ? (
										<Link
											key={game.id}
											className="hub-game-card"
											to={`/play/${game.id}`}
										>
											<span>{game.name}</span>
											<small>{game.description}</small>
										</Link>
									) : (
										<button
											key={game.id}
											className="hub-game-card hub-game-card--locked"
											type="button"
											onClick={() =>
												setInfoModal({
													title: game.name,
													description: `${game.description}\n\nArena is being built. Check back soon!`,
												})
											}
										>
											<span>{game.name}</span>
											<small>Coming soon</small>
										</button>
									),
								)}
							</div>
						)}
					</section>

					<aside className="hub-panel hub-page__leaderboard">
						<h2>Rankings</h2>
						{leaderboard.length > 0 ? (
							<ol className="hub-ranking-list">
								{leaderboard.map((entry) => (
									<li key={entry.userId}>
										<span>#{entry.rank}</span>
										<strong>{entry.turtleName ?? entry.username}</strong>
										<small>{entry.wins} wins</small>
									</li>
								))}
							</ol>
						) : (
							<p className="hub-panel__muted">No rankings yet.</p>
						)}
					</aside>
				</section>
			</div>

			<WorkInProgressModal
				isOpen={isTournamentModalOpen}
				onClose={() => setIsTournamentModalOpen(false)}
				closeLabel="Return to Hub"
			/>

			{infoModal ? (
				<HubModal title={infoModal.title} onClose={() => setInfoModal(null)}>
					<p>{infoModal.description}</p>
				</HubModal>
			) : null}

			{activeModal === "achievements" ? (
				<HubModal title="Achievements" onClose={() => setActiveModal(null)}>
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}
					{achievements ? (
						<div className="hub-modal__list">
							{achievements.map((achievement) => (
								<article
									key={achievement.id}
									className={achievement.unlocked ? "is-unlocked" : ""}
								>
									<strong>{achievement.title}</strong>
									<p>{achievement.description}</p>
									<small>
										{achievement.progressCurrent}/{achievement.progressTarget} · {achievement.unlocked ? "Unlocked" : "Locked"}
									</small>
								</article>
							))}
						</div>
					) : (
						<p>Loading achievements...</p>
					)}
				</HubModal>
			) : null}

			{activeModal === "customization" ? (
				<HubModal title="Customization" onClose={() => setActiveModal(null)}>
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}
					{cosmetics ? (
						<div className="hub-modal__list hub-modal__cosmetics">
							{cosmetics.map((cosmetic) => (
								<article key={cosmetic.id}>
									<strong>{cosmetic.name}</strong>
									<p>{cosmetic.description}</p>
									<button
										type="button"
										disabled={cosmetic.equipped || cosmetic.lockedReason === "achievement-locked"}
										onClick={() => void handleCosmeticAction(cosmetic)}
									>
										{cosmetic.equipped
											? "Equipped"
											: cosmetic.owned
												? "Equip"
												: `Buy · ${cosmetic.price} coins`}
									</button>
								</article>
							))}
						</div>
					) : (
						<p>Loading customization...</p>
					)}
				</HubModal>
			) : null}
		</main>
	);
}

function HubModal({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="hub-modal" role="dialog" aria-modal="true">
			<button
				className="hub-modal__backdrop"
				type="button"
				aria-label="Close modal"
				onClick={onClose}
			/>
			<section className="hub-modal__panel">
				<header>
					<h2>{title}</h2>
					<button type="button" onClick={onClose}>
						Close
					</button>
				</header>
				<div className="hub-modal__body">{children}</div>
			</section>
		</div>
	);
}

export function HomePage(): JSX.Element {
	return (
		<ProtectedRoute>
			<HomeMenu />
		</ProtectedRoute>
	);
}
