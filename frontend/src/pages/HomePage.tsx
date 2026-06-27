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
	GameLeaderboardEntry,
	MiniGameDefinition,
	NotificationView,
	OverallLeaderboardEntry,
	PendingView,
	RANKED_GAMES,
	type LeaderboardScope,
	type User,
} from "../features/hub/api";
import { TURTLE_TAGS } from "../shared/turtle-tags";
import { getGameSocket } from "../services/network/gameSocket";

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
	const { time, period } = formatClockParts(now);
	return period ? `${time} ${period}` : time;
}

function formatClockParts(now: Date): { time: string; period: string } {
	const parts = new Intl.DateTimeFormat([], {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).formatToParts(now);
	const period = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
	const time = parts
		.filter((part) => part.type !== "dayPeriod")
		.map((part) => part.value)
		.join("")
		.trim();

	return { time, period };
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

/** Displays a live countdown to a lobby/invite expiry timestamp. */
function LobbyCountdown({ expiresAt }: { expiresAt: number }): JSX.Element {
	const [remaining, setRemaining] = useState(() =>
		Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
	);

	useEffect(() => {
		const id = setInterval(() => {
			const secs = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
			setRemaining(secs);
			if (secs === 0) clearInterval(id);
		}, 1000);
		return () => clearInterval(id);
	}, [expiresAt]);

	const mins = Math.floor(remaining / 60);
	const secs = remaining % 60;
	return (
		<span className="hub-lobby-countdown">
			{mins}:{String(secs).padStart(2, "0")}
		</span>
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
	const [leaderboardGame, setLeaderboardGame] = useState<string>("overall");
	const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("global");
	const [gameLeaderboard, setGameLeaderboard] = useState<GameLeaderboardEntry[]>([]);
	const [overallLeaderboard, setOverallLeaderboard] = useState<OverallLeaderboardEntry[]>([]);
	const [leaderboardLoading, setLeaderboardLoading] = useState(false);
	const [notifications, setNotifications] = useState<NotificationView[]>([]);
	const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
	// Private lobby — host side
	const [activeLobby, setActiveLobby] = useState<{
		lobbyId: string;
		gameId: string;
		expiresAt: number;
	} | null>(null);
	// Inline game picker shown when clicking Invite on a friend
	const [inviteTarget, setInviteTarget] = useState<{
		userId: number;
		name: string;
	} | null>(null);
	const [inviteGameId, setInviteGameId] = useState(RANKED_GAMES[0].id as string);
	// Incoming invite — invitee side
	const [incomingInvite, setIncomingInvite] = useState<{
		lobbyId: string;
		fromUsername: string;
		gameId: string;
		expiresAt: number;
	} | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isTournamentModalOpen, setIsTournamentModalOpen] = useState(false);
	const [isRiverRushWipOpen, setIsRiverRushWipOpen] = useState(false);
	const [infoModal, setInfoModal] = useState<InfoModal>(null);
	const [achievements, setAchievements] = useState<Achievement[] | null>(null);
	const [cosmetics, setCosmetics] = useState<Cosmetic[] | null>(null);
	const [modalError, setModalError] = useState("");
	const [activeModal, setActiveModal] = useState<
		"achievements" | "customization" | "profile" | "social" | "rankings" | null
	>(null);
	const [profileSaving, setProfileSaving] = useState(false);
	const [profileSuccess, setProfileSuccess] = useState("");
	const [profileTurtleName, setProfileTurtleName] = useState("");
	const [profileTag, setProfileTag] = useState<string | null>(null);
	const [profileShowcasedAchievements, setProfileShowcasedAchievements] = useState<(string | null)[]>([null, null, null]);
	const [showcasePickerSlot, setShowcasePickerSlot] = useState<number | null>(null);
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
				const [nextPlayer, nextMinigames, nextAchievements] =
					await Promise.all([
						api.getMe(),
						api.getMiniGames().catch(() => []),
						api.getAchievements().catch(() => []),
					]);

				if (!cancelled) {
					setPlayer(nextPlayer);
					setMinigames(nextMinigames);
					setAchievements(nextAchievements);
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

	// Re-fetch leaderboard whenever the selected game or scope changes
	useEffect(() => {
		let cancelled = false;

		async function loadLeaderboard(): Promise<void> {
			setLeaderboardLoading(true);
			try {
				if (leaderboardGame === "overall") {
					const rows = await api.getOverallLeaderboard(leaderboardScope);
					if (!cancelled) setOverallLeaderboard(rows.slice(0, 10));
				} else {
					const rows = await api.getGameLeaderboard(leaderboardGame, leaderboardScope);
					if (!cancelled) setGameLeaderboard(rows.slice(0, 10));
				}
			} catch (err) {
				console.warn("[HomeMenu] Failed to load leaderboard:", err);
			} finally {
				if (!cancelled) setLeaderboardLoading(false);
			}
		}

		void loadLeaderboard();
		return () => { cancelled = true; };
	}, [leaderboardGame, leaderboardScope]);

	// Subscribe to notification + lobby events on the shared game socket
	useEffect(() => {
		const socket = getGameSocket();

		const onInbox = (items: NotificationView[]) => setNotifications(items);
		const onNew = (item: NotificationView) =>
			setNotifications((prev) => [item, ...prev]);

		const onLobbyCreated = (data: { lobbyId: string; gameId: string; expiresAt: number }) =>
			setActiveLobby(data);

		const onLobbyExpired = () => setActiveLobby(null);
		const onLobbyCancelled = (data: { lobbyId: string }) => {
			setActiveLobby((prev) => (prev?.lobbyId === data.lobbyId ? null : prev));
			setIncomingInvite((prev) => (prev?.lobbyId === data.lobbyId ? null : prev));
		};

		const onLobbyDeclined = () => {
			// Host: invitee declined — clear invite state, lobby stays open so host can re-invite
			setInviteTarget(null);
		};

		const onLobbyInvited = (data: {
			lobbyId: string;
			fromUsername: string;
			gameId: string;
			expiresAt: number;
		}) => setIncomingInvite(data);

		// Both host and joiner receive this — navigate into match via existing match:status flow
		const onLobbyMatched = (data: { matchId: string; side: number; gameId: string }) => {
			setActiveLobby(null);
			setIncomingInvite(null);
			// Emit match:status to sync the hub's in-match state (same path as ranked queue)
			socket.emit("match:status");
		};

		socket.on("notification:inbox", onInbox);
		socket.on("notification:new", onNew);
		socket.on("lobby:created", onLobbyCreated);
		socket.on("lobby:expired", onLobbyExpired);
		socket.on("lobby:cancelled", onLobbyCancelled);
		socket.on("lobby:declined", onLobbyDeclined);
		socket.on("lobby:invited", onLobbyInvited);
		socket.on("lobby:matched", onLobbyMatched);

		return () => {
			socket.off("notification:inbox", onInbox);
			socket.off("notification:new", onNew);
			socket.off("lobby:created", onLobbyCreated);
			socket.off("lobby:expired", onLobbyExpired);
			socket.off("lobby:cancelled", onLobbyCancelled);
			socket.off("lobby:declined", onLobbyDeclined);
			socket.off("lobby:invited", onLobbyInvited);
			socket.off("lobby:matched", onLobbyMatched);
		};
	}, []);

	const unreadCount = notifications.length;

	function handleMarkAllRead(): void {
		getGameSocket().emit("notification:read-all");
		setNotifications([]);
	}

	function handleMarkRead(id: number): void {
		getGameSocket().emit("notification:read", { notificationId: id });
		setNotifications((prev) => prev.filter((n) => n.id !== id));
	}

	function handleCreateLobby(friendUserId: number, gameId: string): void {
		getGameSocket().emit("lobby:create", { gameId, shellSelection: [] });
		// After lobby:created fires, send the invite
		getGameSocket().once("lobby:created", (data: { lobbyId: string }) => {
			getGameSocket().emit("lobby:invite", { lobbyId: data.lobbyId, inviteeUserId: friendUserId });
			setInviteTarget(null);
		});
	}

	function handleCancelLobby(): void {
		if (!activeLobby) return;
		getGameSocket().emit("lobby:cancel", { lobbyId: activeLobby.lobbyId });
		setActiveLobby(null);
	}

	function handleAcceptInvite(): void {
		if (!incomingInvite) return;
		getGameSocket().emit("lobby:join", { lobbyId: incomingInvite.lobbyId, shellSelection: [] });
		setIncomingInvite(null);
	}

	function handleDeclineInvite(): void {
		if (!incomingInvite) return;
		getGameSocket().emit("lobby:decline", { lobbyId: incomingInvite.lobbyId });
		setIncomingInvite(null);
	}

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

	const openProfile = async () => {
		setProfileTurtleName(player?.turtleName ?? "");
		setProfileTag(player?.profile?.tag ?? null);
		setProfileSuccess("");
		setModalError("");
		setShowcasePickerSlot(null);
		setActiveModal("profile");

		// Fetch achievements to power the showcase picker (reuse cached if available).
		let loaded = achievements;
		if (!loaded) {
			try {
				loaded = await api.getAchievements();
				setAchievements(loaded);
			} catch {
				// Non-fatal — showcase picker will show a loading message.
			}
		}

		// Seed showcase: use saved selection if present, else pre-fill with the
		// 3 most recently unlocked achievements.
		const saved = player?.profile?.showcasedAchievements;
		if (saved && saved.length > 0) {
			setProfileShowcasedAchievements([
				saved[0] ?? null,
				saved[1] ?? null,
				saved[2] ?? null,
			]);
		} else if (loaded) {
			const recent = [...loaded]
				.filter((a) => a.unlocked && a.unlockedAt !== null)
				.sort(
					(a, b) =>
						new Date(b.unlockedAt!).getTime() -
						new Date(a.unlockedAt!).getTime(),
				)
				.slice(0, 3)
				.map((a) => a.id);
			setProfileShowcasedAchievements([
				recent[0] ?? null,
				recent[1] ?? null,
				recent[2] ?? null,
			]);
		} else {
			setProfileShowcasedAchievements([null, null, null]);
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
			setShowcasePickerSlot(null);
			const updates: Parameters<typeof api.updateProfile>[0] = {};
			if (profileTurtleName.trim()) updates.turtleName = profileTurtleName.trim();
			updates.tag = profileTag;
			updates.showcasedAchievements = profileShowcasedAchievements.filter(
				(id): id is string => id !== null,
			);
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

	const profileTagId = player?.profile?.tag ?? null;
	const currentTag = profileTagId
		? (TURTLE_TAGS.find((t) => t.id === profileTagId) ?? null)
		: null;

	const showcasedIds = player?.profile?.showcasedAchievements ?? [];
	const showcasedAchievements = showcasedIds
		.map((id) => achievements?.find((a) => a.id === id) ?? null)
		.filter((a): a is Achievement => a !== null);

	const displayedNow =
		manualMinutes === null ? now : createManualTime(now, manualMinutes);
	const currentTimeParts = formatClockParts(displayedNow);
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
						onClick={() => void openProfile()}
					>
						<span className="hub-page__player-name-row">
							<strong className="menu-page__player-name">{playerName}</strong>
							{currentTag ? (
								<span className="hub-page__player-tag">
									{currentTag.emoji} {currentTag.label}
								</span>
							) : null}
						</span>
						<span className="hub-page__player-meta">
							Lvl {player?.level ?? 1} · Shell {player?.shellSkin ?? "kanagawa"} · ⬡ {player?.coins ?? 0}
						</span>
						{player?.mostPlayedGame ? (
							<span className="hub-page__most-played">
								🐢 {player.mostPlayedGame.gameName} · {player.mostPlayedGame.gamesPlayed} {player.mostPlayedGame.gamesPlayed === 1 ? "match" : "matches"} · {player.mostPlayedGame.winRate}% wins
							</span>
						) : null}
						{showcasedAchievements.length > 0 ? (
							<span className="hub-page__player-badges">
								{showcasedAchievements.map((a) => (
									<span key={a.id} className="hub-page__player-badge">
										{a.title}
									</span>
								))}
							</span>
						) : null}
					</button>

					<div className="hub-page__clock-wrap">
						<button
							className={`hub-page__clock${isClockDebugOpen ? " hub-page__clock--active" : ""}`}
							type="button"
							aria-label={`Current time ${currentTimeLabel}`}
							aria-expanded={isClockDebugOpen}
							onClick={() => setIsClockDebugOpen((open) => !open)}
						>
							<img
								className="hub-page__clock-icon"
								src="/assets/ui/counter/icon-time@2x.png"
								alt=""
								aria-hidden="true"
							/>
							<span className="hub-page__clock-time">
								<span>{currentTimeParts.time}</span>
								{currentTimeParts.period ? (
									<span className="hub-page__clock-period">{currentTimeParts.period}</span>
								) : null}
							</span>
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
					{/* Notif bell + logout grouped so the 3-column topbar grid stays intact */}
					<div className="hub-page__topbar-right">
						<button
							className={`hub-notif-bell${isNotifDrawerOpen ? " is-open" : ""}`}
							type="button"
							aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
							onClick={() => setIsNotifDrawerOpen((o) => !o)}
						>
							🔔
							{unreadCount > 0 && (
								<span className="hub-notif-bell__badge">{unreadCount}</span>
							)}
						</button>

						<NineSliceButton
							className="menu-page__logout-button hub-page__logout-button"
							type="button"
							onClick={handleLogout}
							disabled={isLoggingOut}
						>
							<span className="hub-page__logout-label">
								{isLoggingOut ? "Closing session..." : "Logout"}
							</span>
						</NineSliceButton>
					</div>
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
						<NineSliceButton
							type="button"
							className="hub-panel__button"
							onClick={() => setActiveModal("rankings")}
						>
							Rankings
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

			{/* Active lobby waiting room (host side) */}
			{activeLobby && (
				<div className="hub-lobby-waiting" role="status">
					<div className="hub-lobby-waiting__inner">
						<p className="hub-lobby-waiting__label">
							Waiting for friend to accept…
						</p>
						<p className="hub-lobby-waiting__game">
							{RANKED_GAMES.find((g) => g.id === activeLobby.gameId)?.label ?? activeLobby.gameId}
						</p>
						<LobbyCountdown expiresAt={activeLobby.expiresAt} />
						<button
							type="button"
							className="hub-lobby-waiting__cancel"
							onClick={handleCancelLobby}
						>
							Cancel invite
						</button>
					</div>
				</div>
			)}

			{/* Incoming game invite popup (invitee side) */}
			{incomingInvite && (
				<div className="hub-invite-popup" role="dialog" aria-label="Game invite">
					<div className="hub-invite-popup__inner">
						<p className="hub-invite-popup__from">
							<strong>{incomingInvite.fromUsername}</strong> invited you to play
						</p>
						<p className="hub-invite-popup__game">
							{RANKED_GAMES.find((g) => g.id === incomingInvite.gameId)?.label ?? incomingInvite.gameId}
						</p>
						<LobbyCountdown expiresAt={incomingInvite.expiresAt} />
						<div className="hub-invite-popup__actions">
							<button
								type="button"
								className="hub-invite-popup__accept"
								onClick={handleAcceptInvite}
							>
								Accept
							</button>
							<button
								type="button"
								className="hub-invite-popup__decline"
								onClick={handleDeclineInvite}
							>
								Decline
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Notification drawer */}
			{isNotifDrawerOpen && (
				<div className="hub-notif-drawer" role="dialog" aria-label="Notifications">
					<div className="hub-notif-drawer__header">
						<h3>Notifications</h3>
						{unreadCount > 0 && (
							<button
								className="hub-notif-drawer__mark-all"
								type="button"
								onClick={handleMarkAllRead}
							>
								Mark all read
							</button>
						)}
						<button
							className="hub-notif-drawer__close"
							type="button"
							aria-label="Close notifications"
							onClick={() => setIsNotifDrawerOpen(false)}
						>
							✕
						</button>
					</div>

					{notifications.length === 0 ? (
						<p className="hub-notif-drawer__empty">No new notifications.</p>
					) : (
						<ul className="hub-notif-drawer__list">
							{notifications.map((notif) => (
								<li key={notif.id} className="hub-notif-drawer__item">
									<div className="hub-notif-drawer__item-body">
										{notif.type === "friend_request" && (
											<span>
												<strong>{notif.fromUsername}</strong> sent you a friend request.
											</span>
										)}
										{notif.type === "friend_accepted" && (
											<span>
												<strong>{notif.fromUsername}</strong> accepted your friend request.
											</span>
										)}
									</div>
									<div className="hub-notif-drawer__item-actions">
										{notif.type === "friend_request" && (
											<>
												<button
													type="button"
													className="hub-notif-drawer__action hub-notif-drawer__action--accept"
													onClick={async () => {
														try {
															await api.acceptFriendRequest(notif.fromUserId);
															handleMarkRead(notif.id);
														} catch {
															// Non-fatal — button remains active if it fails
														}
													}}
												>
													Accept
												</button>
												<button
													type="button"
													className="hub-notif-drawer__action hub-notif-drawer__action--decline"
													onClick={async () => {
														try {
															await api.removeFriend(notif.fromUserId);
															handleMarkRead(notif.id);
														} catch {
															// Non-fatal
														}
													}}
												>
													Decline
												</button>
											</>
										)}
										<button
											type="button"
											className="hub-notif-drawer__dismiss"
											aria-label="Dismiss notification"
											onClick={() => handleMarkRead(notif.id)}
										>
											✕
										</button>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			{infoModal ? (
				<HubModal title={infoModal.title} onClose={() => setInfoModal(null)}>
					<p>{infoModal.description}</p>
				</HubModal>
			) : null}

			{activeModal === "rankings" ? (
				<HubModal title="Rankings" onClose={() => setActiveModal(null)}>
					<div className="hub-modal__rankings">
						<div className="hub-leaderboard-controls">
							<select
								className="hub-leaderboard-select"
								value={leaderboardGame}
								onChange={(e) => setLeaderboardGame(e.target.value)}
								aria-label="Select game leaderboard"
							>
								<option value="overall">Overall (Total Wins)</option>
								{RANKED_GAMES.map((g) => (
									<option key={g.id} value={g.id}>{g.label}</option>
								))}
							</select>

							<div className="hub-leaderboard-scope" role="group" aria-label="Leaderboard scope">
								<button
									className={`hub-leaderboard-scope__btn${leaderboardScope === "global" ? " is-active" : ""}`}
									onClick={() => setLeaderboardScope("global")}
								>
									Global
								</button>
								<button
									className={`hub-leaderboard-scope__btn${leaderboardScope === "friends" ? " is-active" : ""}`}
									onClick={() => setLeaderboardScope("friends")}
								>
									Friends
								</button>
							</div>
						</div>

						{leaderboardLoading ? (
							<p className="hub-panel__muted">Loading…</p>
						) : leaderboardGame === "overall" ? (
							overallLeaderboard.length > 0 ? (
								<ol className="hub-ranking-list">
									{overallLeaderboard.map((entry) => (
										<li key={entry.userId}>
											<span className="hub-ranking-list__rank">#{entry.rank}</span>
											<strong className="hub-ranking-list__name">
												{entry.turtleName ?? entry.username}
											</strong>
											<small className="hub-ranking-list__stat">
												{entry.totalWins} wins
											</small>
										</li>
									))}
								</ol>
							) : (
								<p className="hub-panel__muted">No rankings yet.</p>
							)
						) : (
							gameLeaderboard.length > 0 ? (
								<ol className="hub-ranking-list">
									{gameLeaderboard.map((entry) => (
										<li key={entry.userId}>
											<span className="hub-ranking-list__rank">#{entry.rank}</span>
											<strong className="hub-ranking-list__name">
												{entry.turtleName ?? entry.username}
											</strong>
											<small className="hub-ranking-list__stat">
												{entry.rating} ELO · {entry.wins}W/{entry.losses}L
											</small>
										</li>
									))}
								</ol>
							) : (
								<p className="hub-panel__muted">No rankings yet.</p>
							)
						)}
					</div>
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
						<span className="hub-modal__field-label">Your dojo tag</span>
						<div className="hub-modal__tag-grid" role="group" aria-label="Dojo tag selection">
							{TURTLE_TAGS.map((tag) => {
								const selected = profileTag === tag.id;
								return (
									<button
										key={tag.id}
										type="button"
										className={`hub-modal__tag-chip${selected ? " hub-modal__tag-chip--selected" : ""}`}
										aria-pressed={selected}
										title={tag.description}
										onClick={() => setProfileTag(selected ? null : tag.id)}
									>
										<span className="hub-modal__tag-chip-emoji">{tag.emoji}</span>
										<span className="hub-modal__tag-chip-label">{tag.label}</span>
									</button>
								);
							})}
						</div>
						<span className="hub-modal__field-label">Achievement showcase</span>
						<div className="hub-modal__showcase-slots">
							{profileShowcasedAchievements.map((achievementId, slotIdx) => {
								const achievement = achievementId
									? achievements?.find((a) => a.id === achievementId)
									: null;
								const isOpen = showcasePickerSlot === slotIdx;
								const unlockedAchievements =
									achievements?.filter((a) => a.unlocked) ?? [];

								return (
									<div
										key={slotIdx}
										className="hub-modal__showcase-slot-wrapper"
									>
										<button
											type="button"
											className={`hub-modal__showcase-slot${achievement ? " hub-modal__showcase-slot--filled" : ""}`}
											aria-expanded={isOpen}
											aria-label={
												achievement
													? `Slot ${slotIdx + 1}: ${achievement.title}. Click to change.`
													: `Slot ${slotIdx + 1}: empty. Click to add.`
											}
											onClick={() =>
												setShowcasePickerSlot(isOpen ? null : slotIdx)
											}
										>
											{achievement ? (
												<span className="hub-modal__showcase-title">
													{achievement.title}
												</span>
											) : (
												<>
													<span className="hub-modal__showcase-lock">🔒</span>
													<span className="hub-modal__showcase-empty-label">
														{achievements ? "Empty" : "Loading…"}
													</span>
												</>
											)}
										</button>

										{isOpen ? (
											<div
												className="hub-modal__showcase-picker"
												role="listbox"
												aria-label={`Choose achievement for slot ${slotIdx + 1}`}
											>
												{unlockedAchievements.length === 0 ? (
													<p className="hub-modal__showcase-picker-empty">
														Earn achievements to showcase them here.
													</p>
												) : (
													unlockedAchievements.map((a) => {
														const isSelected =
															profileShowcasedAchievements[slotIdx] === a.id;
														const usedInOtherSlot =
															profileShowcasedAchievements.some(
																(id, i) => i !== slotIdx && id === a.id,
															);
														return (
															<button
																key={a.id}
																type="button"
																role="option"
																aria-selected={isSelected}
																disabled={usedInOtherSlot}
																className={[
																	"hub-modal__showcase-option",
																	isSelected
																		? "hub-modal__showcase-option--selected"
																		: "",
																	usedInOtherSlot
																		? "hub-modal__showcase-option--used"
																		: "",
																]
																	.filter(Boolean)
																	.join(" ")}
																onClick={() => {
																	const next = [
																		...profileShowcasedAchievements,
																	];
																	next[slotIdx] = isSelected ? null : a.id;
																	setProfileShowcasedAchievements(next);
																	setShowcasePickerSlot(null);
																}}
															>
																{a.title}
															</button>
														);
													})
												)}
											</div>
										) : null}
									</div>
								);
							})}
						</div>

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
												<div className="hub-modal__social-actions">
													{friend.isOnline && !activeLobby && (
														<button
															type="button"
															className="hub-modal__social-invite-btn"
															onClick={() => setInviteTarget({ userId: friend.userId, name: friend.turtleName ?? friend.username })}
														>
															Invite
														</button>
													)}
													<button type="button" onClick={() => void handleRemoveFriend(friend.userId)}>Remove</button>
												</div>
											</li>
										))}
									</ul>
								) : (
									<p className="hub-panel__muted">No friends yet. Add someone above.</p>
								)}

								{/* Inline game picker — shown after clicking Invite on a friend */}
								{inviteTarget && (
									<div className="hub-lobby-picker">
										<p>Invite <strong>{inviteTarget.name}</strong> to play:</p>
										<select
											className="hub-leaderboard-select"
											value={inviteGameId}
											onChange={(e) => setInviteGameId(e.target.value)}
											aria-label="Select game to invite to"
										>
											{RANKED_GAMES.map((g) => (
												<option key={g.id} value={g.id}>{g.label}</option>
											))}
										</select>
										<div className="hub-lobby-picker__actions">
											<button
												type="button"
												className="hub-lobby-picker__confirm"
												onClick={() => handleCreateLobby(inviteTarget.userId, inviteGameId)}
											>
												Send invite
											</button>
											<button
												type="button"
												className="hub-lobby-picker__cancel"
												onClick={() => setInviteTarget(null)}
											>
												Cancel
											</button>
										</div>
									</div>
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
