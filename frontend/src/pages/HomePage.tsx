import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RouteLoading } from "../components/common/RouteLoading";
import { NineSliceButton } from "../components/common/NineSliceButton";
import { WorkInProgressModal } from "../components/common/WorkInProgressModal";
import { WorkInProgressNotice } from "../components/common/WorkInProgressNotice";
import { ProtectedRoute } from "../routes/ProtectedRoute";
import {
	hubBackgroundClass,
	resolveHubBackgroundId,
} from "../shared/backgrounds";
import {
	Achievement,
	api,
	Cosmetic,
	FriendView,
	LeaderboardEntry,
	MiniGameDefinition,
	PendingView,
	type User,
} from "../features/hub/api";

type HubView = "choose" | "normal";
type InfoModal = { title: string; description: string } | null;

type CosmeticCategoryType = Extract<
	Cosmetic["type"],
	"shell_skin" | "hub_background"
>;

const COSMETIC_CATEGORIES: { type: CosmeticCategoryType; title: string }[] = [
	{ type: "shell_skin", title: "Shells" },
	{ type: "hub_background", title: "Backgrounds" },
];

const COSMETIC_PREVIEWS: Partial<Record<Cosmetic["id"], string>> = {
	kanagawa: "/assets/character/shells/base.png",
	night_bg: "/assets/backgrounds/night_bg.png",
	sunset_bg: "/assets/backgrounds/sunset_bg.png",
	sunrise_bg: "/assets/backgrounds/sunrise_bg.png",
	night_cycle_bg: "/assets/backgrounds/night_cycle_part2.png",
	sunset_cycle_bg: "/assets/backgrounds/sunset_bg.png",
	sunrise_cycle_bg: "/assets/backgrounds/sunrise_bg.png",
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
type CycleStar = {
	left: string;
	top: string;
	size: string;
	color: string;
	opacity: number;
	blur: string;
	twinkleDuration: string;
	twinkleDelay: string;
};

const CYCLE_STAR_COLORS = [
	"rgba(255, 255, 255, 0.98)",
	"rgba(241, 247, 255, 0.96)",
	"rgba(226, 239, 255, 0.94)",
	"rgba(210, 232, 255, 0.92)",
	"rgba(194, 223, 255, 0.9)",
];
const CYCLE_STAR_COUNT = 420;

function createCycleStars(count: number): CycleStar[] {
	return Array.from({ length: count }, (_, index) => {
		const left = `${(Math.random() * 100).toFixed(2)}%`;
		const top = `${(Math.random() * 64 + 2).toFixed(2)}%`;
		const tier = Math.random();
		const size =
			tier < 0.76
				? `${(Math.random() * 1.4 + 0.9).toFixed(2)}px`
				: tier < 0.96
					? `${(Math.random() * 1.1 + 1.15).toFixed(2)}px`
					: `${(Math.random() * 1.6 + 2.2).toFixed(2)}px`;
		const opacity = Number(
			(
				tier < 0.76
					? Math.random() * 0.28 + 0.28
					: tier < 0.96
						? Math.random() * 0.26 + 0.52
						: Math.random() * 0.18 + 0.74
			).toFixed(2),
		);
		const blur =
			tier < 0.76
				? `${(Math.random() * 5 + 2).toFixed(2)}px`
				: tier < 0.96
					? `${(Math.random() * 8 + 6).toFixed(2)}px`
					: `${(Math.random() * 12 + 11).toFixed(2)}px`;
		const twinkleDuration = `${(Math.random() * 4.5 + 3.5).toFixed(2)}s`;
		const twinkleDelay = `${(-Math.random() * 6).toFixed(2)}s`;

		return {
			left,
			top,
			size,
			color: CYCLE_STAR_COLORS[index % CYCLE_STAR_COLORS.length],
			opacity,
			blur,
			twinkleDuration,
			twinkleDelay,
		};
	});
}

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

function getDayProgress(now: Date): number {
	const seconds =
		now.getHours() * 3600 +
		now.getMinutes() * 60 +
		now.getSeconds() +
		now.getMilliseconds() / 1000;
	return seconds / 86400;
}

function formatClockTime(now: Date): string {
	return now.toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		hour12: true,
	});
}

function createManualTime(base: Date, totalMinutes: number): Date {
	const next = new Date(base);
	next.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
	return next;
}

function getTotalMinutes(now: Date): number {
	return now.getHours() * 60 + now.getMinutes();
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

function CycleBackdrop({ now }: { now: Date }): JSX.Element {
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const stars = useMemo(() => createCycleStars(CYCLE_STAR_COUNT), []);

	useEffect(() => {
		const node = backdropRef.current;
		if (!node) return;
		applyCycleVisuals(node, getDayProgress(now));
	}, [now]);

	return (
		<div className="hub-cycle" ref={backdropRef} aria-hidden="true">
			<div className="hub-cycle__sky" />
			<div className="hub-cycle__stars">
				{stars.map((star, index) => (
					<span
						key={index}
						className="hub-cycle__star"
						style={
							{
								"--star-left": star.left,
								"--star-top": star.top,
								"--star-size": star.size,
								"--star-color": star.color,
								"--star-opacity": star.opacity.toString(),
								"--star-blur": star.blur,
								"--star-twinkle-duration": star.twinkleDuration,
								"--star-twinkle-delay": star.twinkleDelay,
							} as CSSProperties
						}
					/>
				))}
			</div>
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
	const [now, setNow] = useState(() => new Date());
	const [isClockDebugOpen, setIsClockDebugOpen] = useState(false);
	const [manualMinutes, setManualMinutes] = useState<number | null>(null);
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
		"achievements" | "customization" | "profile" | "social" | null
	>(null);
	const [profileSaving, setProfileSaving] = useState(false);
	const [profileSuccess, setProfileSuccess] = useState("");
	const [profileTurtleName, setProfileTurtleName] = useState("");
	const [profileBio, setProfileBio] = useState("");
	const [friends, setFriends] = useState<FriendView[] | null>(null);
	const [pendingRequests, setPendingRequests] = useState<PendingView[] | null>(null);
	const [socialLoading, setSocialLoading] = useState(false);
	const [friendUsername, setFriendUsername] = useState("");
	const [friendActionLoading, setFriendActionLoading] = useState(false);
	const appliedBackgroundId = resolveHubBackgroundId(
		player?.hubBackground,
		player?.hubBackgroundAlter,
	);
	const backgroundClass = hubBackgroundClass(
		"hub-page",
		player?.hubBackground,
		player?.hubBackgroundAlter,
	);
	const showCycleBackdrop = appliedBackgroundId === "night_cycle_bg";

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

	useEffect(() => {
		let timerId = 0;

		const scheduleTick = () => {
			const current = new Date();
			setNow(current);
			timerId = window.setTimeout(scheduleTick, 1000 - current.getMilliseconds());
		};

		scheduleTick();
		return () => window.clearTimeout(timerId);
	}, []);

	useEffect(() => {
		if (!showCycleBackdrop) {
			setIsClockDebugOpen(false);
			setManualMinutes(null);
		}
	}, [showCycleBackdrop]);

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
		const groups = new Map<CosmeticCategoryType, Cosmetic[]>();
		for (const category of COSMETIC_CATEGORIES) groups.set(category.type, []);
		for (const cosmetic of cosmetics ?? []) {
			if (cosmetic.type === "hub_background_alter") continue;
			groups.set(cosmetic.type, [...(groups.get(cosmetic.type) ?? []), cosmetic]);
		}
		return groups;
	}, [cosmetics]);

	const backgroundAlters = useMemo(() => {
		const alters = new Map<string, Cosmetic[]>();
		for (const cosmetic of cosmetics ?? []) {
			if (
				cosmetic.type !== "hub_background_alter" ||
				!cosmetic.parentCosmeticId
			)
				continue;
			alters.set(cosmetic.parentCosmeticId, [
				...(alters.get(cosmetic.parentCosmeticId) ?? []),
				cosmetic,
			]);
		}
		return alters;
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
			const equippedBackground = nextCosmetics.find(
				(item) => item.equipped && item.type === "hub_background",
			);
			const equippedBackgroundAlter = nextCosmetics.find(
				(item) => item.equipped && item.type === "hub_background_alter",
			);
			const equippedShell = nextCosmetics.find(
				(item) => item.equipped && item.type === "shell_skin",
			);
			if (player) {
				setPlayer({
					...player,
					hubBackground: equippedBackground?.id ?? player.hubBackground,
					hubBackgroundAlter: equippedBackgroundAlter?.id ?? null,
					shellSkin: equippedShell?.id ?? player.shellSkin,
				});
			}
		} catch {
			setModalError("Could not update customization.");
		}
	};

	const handleProfileSave = async () => {
		if (profileSaving) return;
		setProfileSaving(true);
		setModalError("");
		setProfileSuccess("");
		try {
			await api.getCsrfToken();
			const updates: { turtleName?: string; bio?: string } = {};
			if (profileTurtleName.trim()) updates.turtleName = profileTurtleName.trim();
			updates.bio = profileBio.trim();
			const updated = await api.updateProfile(updates);
			setPlayer(updated);
			setProfileSuccess("Profile updated.");
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Update failed.";
			setModalError(message);
		} finally {
			setProfileSaving(false);
		}
	};

	const handleBackgroundAlterAction = async (
		background: Cosmetic,
		alter: Cosmetic,
	) => {
		if (alter.equipped) {
			await handleCosmeticAction(background);
			return;
		}
		await handleCosmeticAction(alter);
	};

	const openSocial = async () => {
		setActiveModal("social");
		setModalError("");
		setFriends(null);
		setPendingRequests(null);
		setSocialLoading(true);
		try {
			const [nextFriends, nextPending] = await Promise.all([
				api.getFriends(),
				api.getPendingRequests(),
			]);
			setFriends(nextFriends);
			setPendingRequests(nextPending);
		} catch {
			setModalError("Could not load social data. Try again later.");
		} finally {
			setSocialLoading(false);
		}
	};

	const handleSendFriendRequest = async () => {
		const trimmed = friendUsername.trim();
		if (!trimmed || friendActionLoading) return;
		setFriendActionLoading(true);
		setModalError("");
		try {
			await api.getCsrfToken();
			await api.sendFriendRequest(trimmed);
			setFriendUsername("");
		} catch (err: unknown) {
			setModalError(err instanceof Error ? err.message : "Could not send request.");
		} finally {
			setFriendActionLoading(false);
		}
	};

	const handleAcceptRequest = async (userId: number) => {
		setModalError("");
		try {
			await api.getCsrfToken();
			await api.acceptFriendRequest(userId);
			const [nextFriends, nextPending] = await Promise.all([
				api.getFriends(),
				api.getPendingRequests(),
			]);
			setFriends(nextFriends);
			setPendingRequests(nextPending);
		} catch (err: unknown) {
			setModalError(err instanceof Error ? err.message : "Could not accept request.");
		}
	};

	const handleRemoveFriend = async (userId: number) => {
		setModalError("");
		try {
			await api.getCsrfToken();
			await api.removeFriend(userId);
			setFriends((prev) => prev?.filter((f) => f.userId !== userId) ?? null);
			setPendingRequests((prev) => prev?.filter((p) => p.userId !== userId) ?? null);
		} catch (err: unknown) {
			setModalError(err instanceof Error ? err.message : "Could not remove.");
		}
	};

	if (isLoading) return <RouteLoading />;

	const playerName = player?.turtleName ?? player?.username ?? "Player";
	const displayedNow =
		manualMinutes === null ? now : createManualTime(now, manualMinutes);
	const currentTimeLabel = formatClockTime(displayedNow);
	const manualTimeLabel = formatClockTime(createManualTime(now, manualMinutes ?? getTotalMinutes(now)));

	return (
		<main className={`menu-page hub-page ${backgroundClass}`}>
			{showCycleBackdrop ? <CycleBackdrop now={displayedNow} /> : null}
			<div className="menu-page__shell hub-page__shell">
				<header className="menu-page__topbar hub-page__topbar">
					<button
						className="hub-page__player-card"
						type="button"
						onClick={() => {
							setProfileTurtleName(player?.turtleName ?? "");
							setProfileBio(player?.profile?.bio ?? "");
							setProfileSuccess("");
							setModalError("");
							setActiveModal("profile");
						}}
					>
						<span className="menu-page__player-label">Player</span>
						<strong className="menu-page__player-name">{playerName}</strong>
						<span className="hub-page__player-meta">
							Lvl {player?.level ?? 1} · Shell {player?.shellSkin ?? "kanagawa"} · ⬡ {player?.coins ?? 0}
						</span>
					</button>

					<div className="hub-page__clock-wrap">
						<button
							className={`hub-page__clock${isClockDebugOpen ? " hub-page__clock--active" : ""}`}
							type="button"
							aria-label={`Current time ${currentTimeLabel}`}
							aria-expanded={isClockDebugOpen}
							onClick={() => setIsClockDebugOpen((open) => !open)}
						>
							{currentTimeLabel}
						</button>
						{showCycleBackdrop && isClockDebugOpen ? (
							<div className="hub-page__clock-debug">
								<label className="hub-page__clock-debug-label" htmlFor="hub-clock-debug-slider">
									Debug time
								</label>
								<input
									id="hub-clock-debug-slider"
									className="hub-page__clock-debug-slider"
									type="range"
									min="0"
									max="1439"
									step="1"
									value={manualMinutes ?? getTotalMinutes(now)}
									onChange={(event) => {
										setManualMinutes(Number(event.target.value));
									}}
								/>
								<div className="hub-page__clock-debug-meta">
									<span>{manualTimeLabel}</span>
									<button
										className="hub-page__clock-debug-reset"
										type="button"
										onClick={() => setManualMinutes(null)}
									>
										Real time
									</button>
								</div>
							</div>
						) : null}
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
						<NineSliceButton type="button" className="hub-panel__button" onClick={() => void openSocial()}>
							Social
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
									<img
										className="menu-page__mode-art"
										src="/assets/ui/soloMode.png"
										alt=""
										aria-hidden="true"
									/>
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
									<img
										className="menu-page__mode-art"
										src="/assets/ui/onlineMode.png"
										alt=""
										aria-hidden="true"
									/>
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

			{activeModal === "profile" ? (
				<HubModal
					title="Edit Profile"
					onClose={() => {
						setActiveModal(null);
					}}
				>
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}
					{profileSuccess ? <p className="hub-modal__success">{profileSuccess}</p> : null}
					<div className="hub-modal__profile">
						<WorkInProgressNotice
							featureName="Avatar"
							title="Customisable turtle coming soon"
							description="Your teammate is building turtle avatar customisation. Check back once it's ready."
						/>
						<label className="hub-modal__field-label" htmlFor="turtle-name-input">
							Turtle name
						</label>
						<input
							id="turtle-name-input"
							className="hub-modal__field-input"
							type="text"
							maxLength={32}
							value={profileTurtleName}
							placeholder={player?.username ?? ""}
							onChange={(e) => setProfileTurtleName(e.target.value)}
						/>
						<label className="hub-modal__field-label" htmlFor="bio-input">
							Bio
						</label>
						<textarea
							id="bio-input"
							className="hub-modal__field-input hub-modal__field-input--textarea"
							maxLength={200}
							rows={3}
							value={profileBio}
							placeholder="Tell the dojo about yourself…"
							onChange={(e) => setProfileBio(e.target.value)}
						/>
						<button
							className="hub-modal__save-button"
							type="button"
							disabled={profileSaving}
							onClick={() => void handleProfileSave()}
						>
							{profileSaving ? "Saving…" : "Save changes"}
						</button>
					</div>
				</HubModal>
			) : null}

			{activeModal === "social" ? (
				<HubModal title="Social" onClose={() => { setActiveModal(null); setFriendUsername(""); }}>
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}

					<div className="hub-modal__social-add">
						<input
							className="hub-modal__field-input"
							type="text"
							placeholder="Username"
							maxLength={32}
							value={friendUsername}
							onChange={(e) => setFriendUsername(e.target.value)}
							onKeyDown={(e) => { if (e.key === "Enter") void handleSendFriendRequest(); }}
						/>
						<button
							className="hub-modal__save-button"
							type="button"
							disabled={friendActionLoading || !friendUsername.trim()}
							onClick={() => void handleSendFriendRequest()}
						>
							{friendActionLoading ? "Sending…" : "Add friend"}
						</button>
					</div>

					{socialLoading ? <p>Loading…</p> : (
						<>
							{pendingRequests && pendingRequests.length > 0 ? (
								<section className="hub-modal__social-section">
									<h3>Pending requests</h3>
									<ul className="hub-modal__social-list">
										{pendingRequests.map((req) => (
											<li key={req.userId} className="hub-modal__social-row">
												<span className="hub-modal__social-name">
													{req.turtleName ?? req.username}
													<small> @{req.username}</small>
												</span>
												<div className="hub-modal__social-actions">
													<button type="button" onClick={() => void handleAcceptRequest(req.userId)}>Accept</button>
													<button type="button" onClick={() => void handleRemoveFriend(req.userId)}>Decline</button>
												</div>
											</li>
										))}
									</ul>
								</section>
							) : null}

							<section className="hub-modal__social-section">
								<h3>Friends</h3>
								{friends && friends.length > 0 ? (
									<ul className="hub-modal__social-list">
										{friends.map((friend) => (
											<li key={friend.userId} className="hub-modal__social-row">
												<span className="hub-modal__social-name">
													{friend.turtleName ?? friend.username}
													<small> @{friend.username}</small>
													{friend.isOnline ? <span className="hub-modal__social-online" aria-label="Online" /> : null}
												</span>
												<button type="button" onClick={() => void handleRemoveFriend(friend.userId)}>Remove</button>
											</li>
										))}
									</ul>
								) : (
									<p className="hub-panel__muted">No friends yet. Add someone above.</p>
								)}
							</section>
						</>
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
												const alters =
													cosmetic.type === "hub_background"
														? backgroundAlters.get(cosmetic.id) ?? []
														: [];
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
														{alters.length > 0 ? (
															<div className="hub-modal__cosmetic-alters">
																<span className="hub-modal__cosmetic-alters-label">
																	Alter art
																</span>
																{alters.map((alter) => (
																	<div
																		key={alter.id}
																		className={`hub-modal__cosmetic-alter${
																			alter.equipped
																				? " hub-modal__cosmetic-alter--active"
																				: ""
																		}${
																			!alter.owned
																				? " hub-modal__cosmetic-alter--locked"
																				: ""
																		}`}
																	>
																		<div className="hub-modal__cosmetic-alter-main">
																			<span className="hub-modal__cosmetic-alter-copy">
																				<strong>{alter.name}</strong>
																			</span>
																			<button
																				type="button"
																				role="switch"
																				aria-checked={alter.equipped}
																				aria-label={`Toggle ${alter.name}`}
																				className={`hub-modal__cosmetic-toggle${
																					alter.equipped
																						? " hub-modal__cosmetic-toggle--on"
																						: ""
																				}`}
																				disabled={!alter.owned}
																				onClick={() =>
																					void handleBackgroundAlterAction(
																						cosmetic,
																						alter,
																					)
																				}
																			>
																				<span className="hub-modal__cosmetic-toggle-thumb" />
																			</button>
																		</div>
																		<button
																			type="button"
																			className="hub-modal__cosmetic-alter-buy"
																			disabled={
																				alter.owned ||
																				alter.lockedReason ===
																					"achievement-locked"
																			}
																			onClick={() =>
																				void handleCosmeticAction(alter)
																			}
																		>
																			{alter.owned
																				? "PURCHASED"
																				: `Buy alter · ${alter.price} coins`}
																		</button>
																	</div>
																))}
															</div>
														) : null}
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
