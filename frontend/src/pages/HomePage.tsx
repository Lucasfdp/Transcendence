import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RouteLoading } from "../components/common/RouteLoading";
import { NineSliceButton } from "../components/common/NineSliceButton";
import { WorkInProgressModal } from "../components/common/WorkInProgressModal";
import { ProtectedRoute } from "../routes/ProtectedRoute";
import { hubBackgroundClass } from "../shared/backgrounds";
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

const CYCLE_BASE_DURATION_SECONDS = 120;
const CYCLE_SPEED_STEP = 0.25;
const CYCLE_MIN_SPEED = 0.25;
const CYCLE_MAX_SPEED = 8;

const COSMETIC_CATEGORIES: { type: Cosmetic["type"]; title: string }[] = [
	{ type: "shell_skin", title: "Shells" },
	{ type: "hub_background", title: "Backgrounds" },
];

const COSMETIC_PREVIEWS: Partial<Record<Cosmetic["id"], string>> = {
	kanagawa: "/assets/character/shells/base.png",
	night_bg: "/assets/backgrounds/night_bg.png",
	sunset_bg: "/assets/backgrounds/sunset_bg.png",
	sunrise_bg: "/assets/backgrounds/sunrise_bg.png",
	cycle_bg: "/assets/backgrounds/cycle-part2.png",
};

function cosmeticColor(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`;
}

function getCosmeticPreviewStyle(cosmetic: Cosmetic): CSSProperties {
	const previewSource = COSMETIC_PREVIEWS[cosmetic.id];
	const accentColor = cosmeticColor(cosmetic.accentColor);
	const previewColor = cosmeticColor(cosmetic.previewColor ?? cosmetic.accentColor);

	return {
		"--cosmetic-accent": accentColor,
		"--cosmetic-preview": previewColor,
		...(previewSource ? { "--cosmetic-image": `url("${previewSource}")` } : {}),
	} as CSSProperties;
}

function getAchievementProgress(achievement: Achievement): {
	ratio: number;
	label: string;
	current: number;
	target: number;
} {
	const target = Math.max(achievement.progressTarget, 1);

	if (achievement.unlocked) {
		return {
			ratio: 1,
			label: "Complete",
			current: target,
			target,
		};
	}

	const current = Math.max(
		0,
		Math.min(achievement.progressCurrent, target),
	);

	return {
		ratio: current / target,
		label: `${current}/${target}`,
		current,
		target,
	};
}

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

type RgbColor = { r: number; g: number; b: number };

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}

function blendColor(a: RgbColor, b: RgbColor, amount: number): RgbColor {
	return {
		r: Math.round(lerp(a.r, b.r, amount)),
		g: Math.round(lerp(a.g, b.g, amount)),
		b: Math.round(lerp(a.b, b.b, amount)),
	};
}

function rgbToCss({ r, g, b }: RgbColor): string {
	return `rgb(${r}, ${g}, ${b})`;
}

function getCurrentDayProgress(): number {
	const now = new Date();
	const seconds =
		now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
	return seconds / 86400;
}

function getNightPhase(progress: number): number {
	return progress >= 0.75 ? (progress - 0.75) / 0.5 : (progress + 0.25) / 0.5;
}

function interpolatePalette(
	progress: number,
	stops: Array<{ at: number; color: RgbColor }>,
): string {
	for (let index = 0; index < stops.length - 1; index += 1) {
		const current = stops[index];
		const next = stops[index + 1];
		if (progress <= next.at) {
			const range = next.at - current.at || 1;
			const amount = clamp((progress - current.at) / range, 0, 1);
			return rgbToCss(blendColor(current.color, next.color, amount));
		}
	}
	return rgbToCss(stops[stops.length - 1].color);
}

function applyCycleVisuals(node: HTMLDivElement, progress: number): void {
	const normalized = ((progress % 1) + 1) % 1;
	const isDay = normalized >= 0.25 && normalized < 0.75;
	const dayPhase = clamp((normalized - 0.25) / 0.5, 0, 1);
	const nightPhase = clamp(getNightPhase(normalized), 0, 1);
	const dayArc = Math.sin(dayPhase * Math.PI);
	const nightArc = Math.sin(nightPhase * Math.PI);
	const sunX = -12 + dayPhase * 124;
	const sunY = 72 - dayArc * 62;
	const moonX = -12 + nightPhase * 124;
	const moonY = 74 - nightArc * 58;
	const dawnBlend = clamp(1 - Math.abs(normalized - 0.25) / 0.08, 0, 1);
	const duskBlend = clamp(1 - Math.abs(normalized - 0.75) / 0.08, 0, 1);
	const twilight = Math.max(dawnBlend, duskBlend);
	const nightStrength = isDay ? 0 : 0.55 + nightArc * 0.45;
	const starsOpacity = clamp(nightStrength - twilight * 0.6, 0, 1);

	const topColor = interpolatePalette(normalized, [
		{ at: 0, color: { r: 7, g: 13, b: 28 } },
		{ at: 0.2, color: { r: 24, g: 49, b: 88 } },
		{ at: 0.28, color: { r: 123, g: 154, b: 212 } },
		{ at: 0.5, color: { r: 103, g: 196, b: 255 } },
		{ at: 0.72, color: { r: 241, g: 150, b: 92 } },
		{ at: 0.82, color: { r: 35, g: 45, b: 87 } },
		{ at: 1, color: { r: 7, g: 13, b: 28 } },
	]);
	const horizonColor = interpolatePalette(normalized, [
		{ at: 0, color: { r: 18, g: 25, b: 51 } },
		{ at: 0.2, color: { r: 93, g: 73, b: 111 } },
		{ at: 0.28, color: { r: 255, g: 202, b: 150 } },
		{ at: 0.5, color: { r: 178, g: 225, b: 255 } },
		{ at: 0.72, color: { r: 255, g: 177, b: 122 } },
		{ at: 0.82, color: { r: 64, g: 47, b: 80 } },
		{ at: 1, color: { r: 18, g: 25, b: 51 } },
	]);

	node.style.setProperty("--cycle-top", topColor);
	node.style.setProperty("--cycle-horizon", horizonColor);
	node.style.setProperty("--cycle-sun-x", `${sunX}%`);
	node.style.setProperty("--cycle-sun-y", `${sunY}%`);
	node.style.setProperty("--cycle-moon-x", `${moonX}%`);
	node.style.setProperty("--cycle-moon-y", `${moonY}%`);
	node.style.setProperty("--cycle-sun-opacity", isDay ? "1" : "0");
	node.style.setProperty("--cycle-moon-opacity", isDay ? "0" : "1");
	node.style.setProperty("--cycle-stars-opacity", starsOpacity.toFixed(3));
	node.style.setProperty("--cycle-twilight-opacity", twilight.toFixed(3));
}

function CycleBackdrop(): JSX.Element {
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const speedRef = useRef(1);
	const progressRef = useRef(getCurrentDayProgress());
	const lastFrameRef = useRef<number | null>(null);

	useEffect(() => {
		let frameId = 0;

		const logSpeed = () => {
			const duration = CYCLE_BASE_DURATION_SECONDS / speedRef.current;
			console.info(
				`[cycle] speed ${speedRef.current.toFixed(2)}x (${duration.toFixed(1)}s por ciclo completo)`,
			);
		};

		const updateFrame = () => {
			const node = backdropRef.current;
			if (!node) return;
			const now = performance.now();
			const lastFrame = lastFrameRef.current ?? now;
			const deltaSeconds = (now - lastFrame) / 1000;
			lastFrameRef.current = now;
			progressRef.current +=
				(deltaSeconds * speedRef.current) / CYCLE_BASE_DURATION_SECONDS;
			applyCycleVisuals(node, progressRef.current);
			frameId = window.requestAnimationFrame(updateFrame);
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}

			if (event.code === "NumpadAdd") {
				speedRef.current = clamp(
					Number((speedRef.current + CYCLE_SPEED_STEP).toFixed(2)),
					CYCLE_MIN_SPEED,
					CYCLE_MAX_SPEED,
				);
				logSpeed();
			} else if (event.code === "NumpadSubtract") {
				speedRef.current = clamp(
					Number((speedRef.current - CYCLE_SPEED_STEP).toFixed(2)),
					CYCLE_MIN_SPEED,
					CYCLE_MAX_SPEED,
				);
				logSpeed();
			}
		};

		logSpeed();
		updateFrame();
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.cancelAnimationFrame(frameId);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

		return (
		<div className="hub-cycle" ref={backdropRef} aria-hidden="true">
			<div className="hub-cycle__sky" />
			<div className="hub-cycle__stars" />
			<div className="hub-cycle__sun" />
			<div className="hub-cycle__moon" />
			<div className="hub-cycle__glow" />
			<div className="hub-cycle__clouds" />
			<div className="hub-cycle__foreground" />
		</div>
	);
}

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
	const [isRiverRushWipOpen, setIsRiverRushWipOpen] = useState(false);
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

	const cosmeticGroups = useMemo(() => {
		const groups = new Map<Cosmetic["type"], Cosmetic[]>();
		for (const category of COSMETIC_CATEGORIES) groups.set(category.type, []);
		for (const cosmetic of cosmetics ?? []) {
			groups.set(cosmetic.type, [...(groups.get(cosmetic.type) ?? []), cosmetic]);
		}
		return groups;
	}, [cosmetics]);

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

	const handleReturnToModeSelector = () => {
		setView("choose");
		navigate("/", { replace: true });
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
	const backgroundClass = hubBackgroundClass("hub-page", player?.hubBackground);
	const showCycleBackdrop = player?.hubBackground === "cycle_bg";

	return (
		<main className={`menu-page hub-page ${backgroundClass}`}>
			{showCycleBackdrop ? <CycleBackdrop /> : null}
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
						<NineSliceButton
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
						</NineSliceButton>
						<NineSliceButton
							type="button"
							className="hub-panel__button"
							onClick={openAchievements}
						>
							Achievements
						</NineSliceButton>
						<NineSliceButton
							type="button"
							className="hub-panel__button"
							onClick={openCustomization}
						>
							Customization
						</NineSliceButton>
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
							<div className="hub-page__normal-view">
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
													game.id === "river-rush"
														? setIsRiverRushWipOpen(true)
														: setInfoModal({
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

								<button
									className="hub-page__mode-back-button"
									type="button"
									onClick={handleReturnToModeSelector}
								>
									Back to mode selector
								</button>
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

			<WorkInProgressModal
				isOpen={isRiverRushWipOpen}
				onClose={() => setIsRiverRushWipOpen(false)}
				featureName="River Rush"
				title="Work In Progress"
				description="River Rush is not designed yet. This shrine will open when the mode is ready."
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
							{achievements.map((achievement) => {
								const progress = getAchievementProgress(achievement);

								return (
									<article
										key={achievement.id}
										className={achievement.unlocked ? "is-unlocked" : ""}
									>
										<strong>{achievement.title}</strong>
										<p>{achievement.description}</p>
										<div className="hub-modal__achievement-status">
											<small>{achievement.unlocked ? "Unlocked" : "Locked"}</small>
											<small>{progress.label}</small>
										</div>
										<div
											className="hub-modal__achievement-progress"
											role="progressbar"
											aria-label={`${achievement.title} progress`}
											aria-valuemin={0}
											aria-valuemax={progress.target}
											aria-valuenow={progress.current}
										>
											<span style={{ width: `${progress.ratio * 100}%` }} />
										</div>
									</article>
								);
							})}
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
						<div className="hub-modal__cosmetics">
							{COSMETIC_CATEGORIES.map((category) => {
								const categoryCosmetics = cosmeticGroups.get(category.type) ?? [];

								return (
									<section className="hub-modal__cosmetic-category" key={category.type}>
										<h3>{category.title}</h3>
										<div className="hub-modal__list hub-modal__cosmetic-grid">
											{categoryCosmetics.map((cosmetic) => {
												const hasImage = COSMETIC_PREVIEWS[cosmetic.id] !== undefined;
												const previewClassName = [
													"hub-modal__cosmetic-preview",
													`hub-modal__cosmetic-preview--${cosmetic.type}`,
													hasImage ? "has-image" : "",
												]
													.filter(Boolean)
													.join(" ");

												return (
													<article key={cosmetic.id}>
														<div
															className={previewClassName}
															style={getCosmeticPreviewStyle(cosmetic)}
															aria-hidden="true"
														/>
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
												);
											})}
										</div>
									</section>
								);
							})}
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
