import {
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RouteLoading } from "../components/common/RouteLoading";
import { NineSliceButton } from "../components/common/NineSliceButton";
import { WorkInProgressModal } from "../components/common/WorkInProgressModal";
import { WorkInProgressNotice } from "../components/common/WorkInProgressNotice";
import { ShellCardsModal } from "../components/cards/ShellCardsModal";
import { FortuneWheelModal } from "../components/casino/FortuneWheelModal";
import { KoiDiceModal } from "../components/casino/KoiDiceModal";
import { ShellDropModal } from "../components/casino/ShellDropModal";
import { ShellFlipModal } from "../components/casino/ShellFlipModal";
import { ThreeShellMonteModal } from "../components/casino/ThreeShellMonteModal";
import { ShrineSlotsModal } from "../components/casino/ShrineSlotsModal";
import { ProtectedRoute } from "../routes/ProtectedRoute";
import { ReplayViewer } from "../games/common/replay/ReplayViewer";
import {
	hubBackgroundClass,
	resolveHubBackgroundId,
} from "../shared/backgrounds";
import {
	Achievement,
	api,
	AuthError,
	type ChatMessageView,
	type ConversationSummaryView,
	Cosmetic,
	FriendView,
	GameLeaderboardEntry,
	type GifSearchResult,
	type GroupMemberView,
	MiniGameDefinition,
	NotificationView,
	OverallLeaderboardEntry,
	PendingView,
	RANKED_GAMES,
	REPORT_CATEGORIES,
	type ReportCategory,
	ReplayDetail,
	ReplaySummary,
	type LeaderboardScope,
	type UnreadConversationView,
	type User,
} from "../features/hub/api";
import { TURTLE_TAGS } from "../shared/turtle-tags";
import {
	disconnectGameSocket,
	getGameSocket,
	type BellClashSnapshot,
	type BambooBashSnapshot,
	type CurlingSnapshot,
	type KameKnockSnapshot,
} from "../services/network/gameSocket";
import {
	friendCounts,
	removeById,
	upsertById,
} from "../features/social/friendsOps";
import { buildFriendCode, parseFriendCode } from "../features/social/friendCode";
import {
	addUnread,
	conversationTitle,
	isNearBottom,
	parseGifMetadata,
	removeUnread,
	sortConversationsByRecency,
	unreadIdsFromInbox,
	upsertConversationPreview,
} from "../features/chat/chatOps";
import { filterFriends } from "../features/social/friendFilter";
import { createProfileCardCache } from "../features/social/profileCard/cache";
import { debounce } from "../features/social/profileCard/debounce";
import { ProfileCard } from "../features/social/profileCard/ProfileCard";
import {
	notificationIdsFrom,
	prependNotificationDeduped,
	removeNotificationsFrom,
} from "../features/social/notificationDedup";
import {
	formatRelativeTime,
	groupFriendsByPresence,
	patchFriendPresence,
	type PresenceChange,
} from "../features/social/presence";
import { useToast } from "../features/social/toast/ToastContext";

type AchievementFilter = "all" | "unlocked" | "locked";

const ACHIEVEMENT_FILTER_OPTIONS: { value: AchievementFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "unlocked", label: "Unlocked" },
	{ value: "locked", label: "Locked" },
];

/** How long a removed friend can be restored via the Undo toast before the
 *  deletion is committed to the server. */
const FRIEND_REMOVAL_UNDO_MS = 5000;

/** Delay before a hover/focus on a friend's name triggers a profile fetch. */
const PROFILE_HOVER_DEBOUNCE_MS = 300;

/** Delay before a gif picker search query triggers a fetch, and its minimum length. */
const GIF_SEARCH_DEBOUNCE_MS = 350;
const GIF_SEARCH_MIN_LENGTH = 2;

/**
 * Server-side default message page size (ChatService.DEFAULT_MESSAGE_PAGE_SIZE).
 * A full page back implies there may be older messages to load (Bug Audit L6).
 */
const CHAT_MESSAGE_PAGE_SIZE = 50;

/**
 * How close (px) to the bottom of the thread counts as "pinned" — a live
 * message auto-scrolls into view only when the reader is within this distance,
 * so it never yanks someone who has scrolled up to read history (Bug B2).
 */
const CHAT_SCROLL_STICK_THRESHOLD_PX = 80;

/** Above this many unread notifications, the bell badge shows "99+" instead
 *  of the exact count (Notification Audit L6). */
const NOTIF_BADGE_CAP = 99;

type HubView = "choose" | "normal" | "gambit";
type InfoModal = { title: string; description: string } | null;

type CosmeticCategoryType = Extract<
	Cosmetic["type"],
	"shell_skin" | "hub_background" | "trail_effect" | "dojo_tag"
>;

type CosmeticTabType = "all" | CosmeticCategoryType | "soon-1" | "soon-2";

const COSMETIC_TABS: { id: CosmeticTabType; title: string; disabled?: boolean }[] = [
	{ id: "all", title: "All" },
	{ id: "shell_skin", title: "Shells" },
	{ id: "hub_background", title: "Backgrounds" },
	{ id: "trail_effect", title: "Trails" },
	{ id: "dojo_tag", title: "Dojo Tags" },
	{ id: "soon-2", title: "Soon", disabled: true },
];

const COSMETIC_PREVIEWS: Partial<Record<Cosmetic["id"], string>> = {
	base: "/assets/character/shells/baseShell.png",
	dragon: "/assets/character/shells/dragonShell.png",
	bamboo: "/assets/character/shells/bambooShell.png",
	purple: "/assets/character/shells/purpleShell.png",
	pink: "/assets/character/shells/pinkShell.png",
	stone: "/assets/character/shells/stoneShell.png",
	flame: "/assets/character/shells/flameShell.png",
	nebula: "/assets/character/shells/nebulaShell.png",
	tribal: "/assets/character/shells/tribalShell.png",
	rune: "/assets/character/shells/runeShell.png",
	night_bg: "/assets/backgrounds/night_bg.png",
	sunset_bg: "/assets/backgrounds/sunset_bg.png",
	sunrise_bg: "/assets/backgrounds/sunrise_bg.png",
	login_bg: "/assets/backgrounds/login_bg.png",
	night_cycle_bg: "/assets/backgrounds/night_cycle_part2.png",
	sunset_cycle_bg: "/assets/backgrounds/sunset_bg.png",
	sunrise_cycle_bg: "/assets/backgrounds/sunrise_bg.png",
	login_cycle_bg: "/assets/backgrounds/login_bg.png",
};

const SHELL_PLACEHOLDERS = [
	"mystery-shell-1",
	"mystery-shell-2",
];

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

function getCosmeticActionLabel(cosmetic: Cosmetic): string {
	if (cosmetic.equipped) return "Equipped";
	if (cosmetic.owned) return "Equip";
	return `Buy · ${cosmetic.price} coins`;
}

function isCosmeticActionDisabled(cosmetic: Cosmetic): boolean {
	return cosmetic.equipped || cosmetic.lockedReason === "achievement-locked";
}

function getCosmeticDisplayName(cosmetic: Cosmetic): string {
	if (cosmetic.id === "base") return "Default Shell";
	return cosmetic.name;
}

function getCosmeticDisplayDescription(cosmetic: Cosmetic): string {
	if (cosmetic.id === "base") {
		return "The plain starter shell. No special colour, no decoration, just the shell every player begins with.";
	}
	return cosmetic.description;
}

function getShellSkinDisplayName(shellSkin: string | null | undefined): string {
	if (!shellSkin || shellSkin === "base") return "Default Shell";
	if (shellSkin === "dragon") return "Dragon Shell";
	if (shellSkin === "bamboo") return "Bamboo Shell";
	if (shellSkin === "purple") return "Purple Shell";
	return shellSkin
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
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

function getReplayGameLabel(gameId: string): string {
	return (
		RANKED_GAMES.find((game) => game.id === gameId)?.label ??
		gameId.replace(/-/g, " ")
	);
}

function formatReplayDate(value: string | null): string {
	if (!value) return "Pending";
	return new Date(value).toLocaleString();
}

const GAME_ROUTES: Record<
	string,
	{ label: string; description: string; available?: boolean }
> = {
	"kame-knock": {
		label: "Kame Knock",
		description: "Precision shell launches in the dojo arena.",
		available: true,
	},
	"bamboo-bash": {
		label: "Bamboo Bash",
		description: "Two turtles, one bamboo ring, maximum chaos.",
		available: true,
	},
	"temple-curling": {
		label: "Temple Curling",
		description: "Slide shells across the temple sheet.",
		available: true,
	},
	"bell-clash": {
		label: "Bell Clash",
		description: "Strike the shrine bells before time runs out.",
		available: true,
	},
	"river-rush": {
		label: "River Rush",
		description: "Ride the current through a wild river course.",
		available: false,
	},
	"oni-dodge": {
		label: "Oni Dodge",
		description: "Dodge the oni assault. Coming soon.",
		available: false,
	},
};

const GAME_BUTTON_IMAGES: Record<string, string> = {
	"bamboo-bash": "/assets/ui/gamesButtons/bambooBashButton.png",
	"bell-clash": "/assets/ui/gamesButtons/bellClashButton.png",
	"kame-knock": "/assets/ui/gamesButtons/kameKnockButton.png",
	"oni-dodge": "/assets/ui/gamesButtons/oniDodgeButton.png",
	"river-rush": "/assets/ui/gamesButtons/riverRushButton.png",
	"temple-curling": "/assets/ui/gamesButtons/templeCurlingButton.png",
};

const GAMBIT_BUTTON_IMAGES: Record<string, string> = {
	casino: "/assets/ui/gamesButtons/fortuneWheelButton.png",
	dice: "/assets/ui/gamesButtons/koiDiceButton.png",
	drop: "/assets/ui/gamesButtons/shellDropButton.png",
	flip: "/assets/ui/gamesButtons/shellFlipButton.png",
	monte: "/assets/ui/gamesButtons/threeShellMonteButton.png",
	slots: "/assets/ui/gamesButtons/shrineSlotsButton.png",
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
	const [view, setView] = useState<HubView>(() => {
		const initialView = searchParams.get("view");
		return initialView === "normal" || initialView === "gambit"
			? initialView
			: "choose";
	});
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [player, setPlayer] = useState<User | null>(null);
	const [minigames, setMinigames] = useState<MiniGameDefinition[]>([]);
	const [leaderboardGame, setLeaderboardGame] = useState<string>("overall");
	const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>("global");
	const toggleLeaderboardScope = () => {
		setLeaderboardScope((scope) => (scope === "global" ? "friends" : "global"));
	};
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
	const [wipGameId, setWipGameId] = useState<"river-rush" | "oni-dodge" | null>(null);
	const [infoModal, setInfoModal] = useState<InfoModal>(null);
	const [achievements, setAchievements] = useState<Achievement[] | null>(null);
	const [achievementFilter, setAchievementFilter] =
		useState<AchievementFilter>("all");
	const [cosmetics, setCosmetics] = useState<Cosmetic[] | null>(null);
	const [activeCosmeticTab, setActiveCosmeticTab] = useState<CosmeticTabType>("all");
	const [selectedShellCosmetic, setSelectedShellCosmetic] =
		useState<Cosmetic | null>(null);
	const [modalError, setModalError] = useState("");
	const [activeModal, setActiveModal] = useState<
		| "achievements"
		| "customization"
		| "profile"
		| "replays"
		| "social"
		| "rankings"
		| "cards"
		| "casino"
		| "flip"
		| "monte"
		| "slots"
		| "dice"
		| "drop"
		| null
	>(null);
	const [profileSaving, setProfileSaving] = useState(false);
	const [profileSuccess, setProfileSuccess] = useState("");
	const [profileTurtleName, setProfileTurtleName] = useState("");
	const [profileShowcasedAchievements, setProfileShowcasedAchievements] = useState<(string | null)[]>([null, null, null]);
	const [replays, setReplays] = useState<ReplaySummary[] | null>(null);
	const [replaysLoading, setReplaysLoading] = useState(false);
	const [selectedReplay, setSelectedReplay] = useState<ReplayDetail | null>(null);
	const [selectedReplayFrame, setSelectedReplayFrame] = useState(0);
	const [replayFrameProgress, setReplayFrameProgress] = useState(0);
	const [replayActionLoading, setReplayActionLoading] = useState<string | null>(
		null,
	);
	const [isReplayPlaying, setIsReplayPlaying] = useState(false);
	const [isReplayExpanded, setIsReplayExpanded] = useState(false);
	const [replayTab, setReplayTab] = useState<"match" | "saved">("match");
	const [showcasePickerSlot, setShowcasePickerSlot] = useState<number | null>(null);
	const [friends, setFriends] = useState<FriendView[] | null>(null);
	const [pendingRequests, setPendingRequests] = useState<PendingView[] | null>(null);
	const [outgoingRequests, setOutgoingRequests] = useState<PendingView[] | null>(
		null,
	);
	const [suggestions, setSuggestions] = useState<PendingView[] | null>(null);
	const [blockedUsers, setBlockedUsers] = useState<PendingView[] | null>(null);
	const [socialLoading, setSocialLoading] = useState(false);
	const [friendSearchQuery, setFriendSearchQuery] = useState("");
	const [friendUsername, setFriendUsername] = useState("");
	const [friendActionLoading, setFriendActionLoading] = useState(false);
	const { showToast } = useToast();

	// ── Chat ─────────────────────────────────────────────────────────────────
	const [conversations, setConversations] = useState<ConversationSummaryView[] | null>(null);
	const [unreadConversationIds, setUnreadConversationIds] = useState<Set<number>>(
		new Set(),
	);
	const [activeConversationId, setActiveConversationId] = useState<number | null>(
		null,
	);
	/** Oldest → newest, for display top-to-bottom in the thread view. */
	const [chatMessages, setChatMessages] = useState<ChatMessageView[]>([]);
	const [chatMessageDraft, setChatMessageDraft] = useState("");
	const [chatThreadLoading, setChatThreadLoading] = useState(false);
	// Whether there may be older messages to page in, and whether such a fetch
	// is in flight (Bug Audit L6).
	const [chatHasMoreOlder, setChatHasMoreOlder] = useState(false);
	const [chatLoadingOlder, setChatLoadingOlder] = useState(false);
	const [chatActionLoading, setChatActionLoading] = useState(false);
	const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
	const [newGroupName, setNewGroupName] = useState("");
	const [newGroupMemberIds, setNewGroupMemberIds] = useState<Set<number>>(new Set());
	const [isGifPickerOpen, setIsGifPickerOpen] = useState(false);
	const [gifSearchQuery, setGifSearchQuery] = useState("");
	const [gifResults, setGifResults] = useState<GifSearchResult[]>([]);
	const [gifSearchLoading, setGifSearchLoading] = useState(false);
	// ── Group member management (Decision 1/2) ───────────────────────────────
	// `groupMembers` is the open group's member list (null = panel closed / not
	// loaded); the rest drive the member panel, add-member picker, and the
	// owner-only rename control.
	const [groupMembers, setGroupMembers] = useState<GroupMemberView[] | null>(null);
	const [groupMembersLoading, setGroupMembersLoading] = useState(false);
	const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
	const [groupRenameDraft, setGroupRenameDraft] = useState<string | null>(null);
	const [groupActionLoading, setGroupActionLoading] = useState(false);
	/** Pending friend-removal timers keyed by userId; cleared on Undo. */
	const removalTimers = useRef(
		new Map<number, ReturnType<typeof setTimeout>>(),
	);
	// Clear any outstanding undo timers on unmount so a deferred commit can't
	// fire setState after the component is gone (Bug Audit L2).
	useEffect(() => {
		const timers = removalTimers.current;
		return () => {
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		};
	}, []);
	const [hoveredFriendUsername, setHoveredFriendUsername] = useState<
		string | null
	>(null);
	const [hoveredProfile, setHoveredProfile] = useState<User | null>(null);
	const [hoveredProfileLoading, setHoveredProfileLoading] = useState(false);
	const profileCardCache = useRef(createProfileCardCache<User>()).current;
	const [blockConfirmUserId, setBlockConfirmUserId] = useState<number | null>(
		null,
	);
	/** Only one block-confirm row can be open at a time, so a single shared
	 *  ref is enough to move focus onto whichever "Confirm" button appears —
	 *  otherwise focus is lost when the triggering "Block" button unmounts. */
	const blockConfirmButtonRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (blockConfirmUserId !== null) {
			blockConfirmButtonRef.current?.focus();
		}
	}, [blockConfirmUserId]);
	const [reportTarget, setReportTarget] = useState<{
		userId: number;
		username: string;
		turtleName: string | null;
	} | null>(null);
	const [reportCategory, setReportCategory] = useState<ReportCategory>(
		REPORT_CATEGORIES[0].id,
	);
	const [reportMessage, setReportMessage] = useState("");
	const [reportLoading, setReportLoading] = useState(false);
	const reportCategorySelectRef = useRef<HTMLSelectElement>(null);
	useEffect(() => {
		if (reportTarget) {
			reportCategorySelectRef.current?.focus();
		}
	}, [reportTarget]);
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
					if (!cancelled && err instanceof AuthError) {
						navigate("/auth", { replace: true });
					}
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

	// Hydrate the notification inbox on every mount via REST (Bug Audit H1).
	// The WS `notification:inbox` push below only fires once, at socket
	// *connect* time — but the game socket is a module-level singleton that
	// stays connected across route changes (hub → game → hub), so that
	// one-time hydration never re-runs on a HomePage remount. Without this
	// fetch the bell goes stale/empty after the most common navigation path
	// in the app. REST is the source of truth; the WS events remain the live
	// accelerator while this tab stays open.
	useEffect(() => {
		let cancelled = false;
		api
			.getNotifications()
			.then((items) => {
				if (!cancelled) setNotifications(items);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	// Hydrate the chat unread set on every mount via REST (Bug B1) — same
	// rationale as the notification hydration above: the `chat:unread-inbox`
	// socket push only fires at connect time on the singleton game socket, so
	// after hub → game → hub the remounted component's unread set is empty
	// until a new message arrives. REST rebuilds it; WS remains the live
	// accelerator.
	useEffect(() => {
		let cancelled = false;
		api
			.getUnreadConversations()
			.then((entries) => {
				if (!cancelled) setUnreadConversationIds(unreadIdsFromInbox(entries));
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	// Subscribe to notification + lobby events on the shared game socket
	useEffect(() => {
		const socket = getGameSocket();

		const onInbox = (items: NotificationView[]) => setNotifications(items);
		// Guard against a duplicated push (e.g. a reconnect race) rendering the
		// same notification twice and producing duplicate React keys — mirrors
		// the chat message handler's existing id-dedup (Bug Audit L4).
		const onNew = (item: NotificationView) =>
			setNotifications((prev) => prependNotificationDeduped(prev, item));

		// Friend removal is delivered live-only (Bug Audit §3/#10 — see the
		// backend NotificationType doc for why it's not a persisted bell
		// entry): just resync the friends list so the removed side doesn't
		// keep seeing someone who unfriended them until their next refresh.
		const onFriendRemoved = () => void refreshSocial();

		// Live presence transition for a friend (Decision 3): patch the friend
		// row in place. Pure patch via a functional update so the mount-bound
		// handler doesn't read a stale `friends`; a no-op when the modal has
		// never been opened (friends === null) or the user isn't in the list.
		const onPresenceChanged = (data: PresenceChange) =>
			setFriends((prev) => (prev ? patchFriendPresence(prev, data) : prev));

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

		// Both host and joiner receive this — take both players straight into the
		// match instead of leaving them to separately find their way to the game
		// page and click "Rejoin Match". GamePage reads autoJoinMatch from router
		// state and auto-launches once its own match:status round trip resolves.
		const onLobbyMatched = (data: { matchId: string; side: number; gameId: string }) => {
			setActiveLobby(null);
			setIncomingInvite(null);
			navigate(`/play/${data.gameId}`, { state: { autoJoinMatch: true } });
		};

		socket.on("notification:inbox", onInbox);
		socket.on("notification:new", onNew);
		socket.on("friend:removed", onFriendRemoved);
		socket.on("presence:changed", onPresenceChanged);
		socket.on("lobby:created", onLobbyCreated);
		socket.on("lobby:expired", onLobbyExpired);
		socket.on("lobby:cancelled", onLobbyCancelled);
		socket.on("lobby:declined", onLobbyDeclined);
		socket.on("lobby:invited", onLobbyInvited);
		socket.on("lobby:matched", onLobbyMatched);

		return () => {
			socket.off("notification:inbox", onInbox);
			socket.off("notification:new", onNew);
			socket.off("friend:removed", onFriendRemoved);
			socket.off("presence:changed", onPresenceChanged);
			socket.off("lobby:created", onLobbyCreated);
			socket.off("lobby:expired", onLobbyExpired);
			socket.off("lobby:cancelled", onLobbyCancelled);
			socket.off("lobby:declined", onLobbyDeclined);
			socket.off("lobby:invited", onLobbyInvited);
			socket.off("lobby:matched", onLobbyMatched);
		};
	}, []);

	// Mirrors activeConversationId into a ref so the chat socket effect below
	// doesn't need to resubscribe every time the open thread changes.
	const activeConversationIdRef = useRef<number | null>(null);
	useEffect(() => {
		activeConversationIdRef.current = activeConversationId;
	}, [activeConversationId]);

	// Mirror of `conversations` for the chat socket effect, which binds once on
	// mount and so can't read the live state directly.
	const conversationsRef = useRef<ConversationSummaryView[] | null>(null);
	useEffect(() => {
		conversationsRef.current = conversations;
	}, [conversations]);
	// Guards the unknown-conversation refetch (Bug B4): a burst of live messages
	// for a not-yet-listed conversation triggers at most one in-flight refetch.
	const conversationRefetchInFlightRef = useRef(false);

	// Chat scroll anchoring (Bug B2). The thread renders oldest→newest in a
	// scroll container; without help it opens at the top (oldest) and live
	// messages append below the fold. `chatListRef` is the scroll container;
	// `chatScrollActionRef` is a one-shot instruction consumed by the layout
	// effect after each `chatMessages` change; `chatMessagesRef` mirrors the
	// message list so the mount-bound socket handler can dedup without a stale
	// closure; `pendingSendScrollRef` forces a scroll-to-bottom when the user's
	// own just-sent message arrives, even if they'd scrolled up.
	const chatListRef = useRef<HTMLUListElement | null>(null);
	const chatScrollActionRef = useRef<
		{ kind: "bottom" } | { kind: "preserve"; prevScrollHeight: number } | null
	>(null);
	const chatMessagesRef = useRef<ChatMessageView[]>([]);
	const pendingSendScrollRef = useRef(false);
	// Last text body sent over the socket, held so a server rejection (rate
	// limit, frozen dm, group left elsewhere) can restore it into an empty
	// draft instead of losing the user's typing (Bug B8). Disarmed as soon as a
	// message lands in the active thread — a rejected send never echoes back, so
	// a still-armed ref on `chat:error` means the send genuinely failed.
	const lastSentChatBodyRef = useRef("");
	useEffect(() => {
		chatMessagesRef.current = chatMessages;
	}, [chatMessages]);

	// Apply the pending scroll instruction after the DOM has the new messages
	// but before paint, so there's no visible jump.
	useLayoutEffect(() => {
		const el = chatListRef.current;
		const action = chatScrollActionRef.current;
		chatScrollActionRef.current = null;
		if (!el || !action) return;
		if (action.kind === "bottom") {
			el.scrollTop = el.scrollHeight;
		} else {
			// Older history was prepended: keep the viewport on the same message
			// by shifting scrollTop down by exactly the height that appeared above.
			el.scrollTop += el.scrollHeight - action.prevScrollHeight;
		}
	}, [chatMessages]);

	// Subscribe to chat events on the shared game socket — kept separate from
	// the notification/lobby effect above for isolation.
	useEffect(() => {
		const socket = getGameSocket();

		const onChatMessage = (message: ChatMessageView) => {
			if (activeConversationIdRef.current === message.conversationId) {
				// Skip if we already have this message id — the sender receives its
				// own broadcast, and a message can race the initial history fetch
				// (Bug Audit L1). Dedup off the ref (not the stale closure) so the
				// scroll decision below only runs for a genuine append.
				const isNew = !chatMessagesRef.current.some((m) => m.id === message.id);
				if (isNew) {
					// Decide the scroll action *before* the DOM grows (Bug B2): stick
					// to the bottom if the reader was already near it, or if this is
					// the user's own just-sent message; otherwise leave scroll be so
					// we don't yank someone reading older history.
					const el = chatListRef.current;
					const forced = pendingSendScrollRef.current;
					pendingSendScrollRef.current = false;
					const pinned =
						forced ||
						!el ||
						isNearBottom(
							el.scrollHeight,
							el.scrollTop,
							el.clientHeight,
							CHAT_SCROLL_STICK_THRESHOLD_PX,
						);
					chatScrollActionRef.current = pinned ? { kind: "bottom" } : null;
					// A message landed in the open thread → our own send (if any) was
					// accepted, so disarm the draft-restore ref (Bug B8).
					lastSentChatBodyRef.current = "";
					setChatMessages((prev) =>
						prev.some((m) => m.id === message.id) ? prev : [...prev, message],
					);
				}
			}
			setConversations((prev) =>
				prev
					? sortConversationsByRecency(
							upsertConversationPreview(prev, {
								conversationId: message.conversationId,
								lastMessageAt: message.createdAt,
								lastMessagePreview: message.body,
							}),
						)
					: prev,
			);

			// A message for a conversation not in our list — a brand-new DM, or a
			// group we were just added to — can't be upserted (the id isn't there
			// to update), so pull the fresh list. Guarded against a message burst
			// stampeding the endpoint (Bug B4). No-op while the modal has never
			// been opened (conversations === null).
			const known = conversationsRef.current;
			if (
				known !== null &&
				!known.some((c) => c.id === message.conversationId) &&
				!conversationRefetchInFlightRef.current
			) {
				conversationRefetchInFlightRef.current = true;
				void refreshConversations().finally(() => {
					conversationRefetchInFlightRef.current = false;
				});
			}
		};

		const onChatUnreadInbox = (entries: UnreadConversationView[]) => {
			setUnreadConversationIds(unreadIdsFromInbox(entries));
		};

		const onChatUnread = (entry: UnreadConversationView) => {
			setUnreadConversationIds((prev) => addUnread(prev, entry.conversationId));
		};

		const onChatReadSync = (data: { conversationId: number }) => {
			setUnreadConversationIds((prev) => removeUnread(prev, data.conversationId));
		};

		const onChatError = (data: { message: string }) => {
			showToast({ message: data.message, variant: "error" });
			// The send that triggered this error cleared the draft optimistically;
			// restore the text so the user doesn't have to retype it — most useful
			// exactly when the error is a rate limit (Bug B8). Only restore into an
			// empty draft (don't clobber something they've since typed), and only
			// while the ref is still armed (a successful send would have disarmed
			// it via the message echo above).
			const pending = lastSentChatBodyRef.current;
			if (pending) {
				lastSentChatBodyRef.current = "";
				setChatMessageDraft((prev) => (prev.length === 0 ? pending : prev));
			}
		};

		// Kicked from a group, or the owner deleted it (Decision 1): drop the
		// conversation, clear its unread flag, and close the thread + member
		// panel if it was the open one.
		const onChatRemoved = (data: { conversationId: number }) => {
			setConversations((prev) =>
				prev ? prev.filter((c) => c.id !== data.conversationId) : prev,
			);
			setUnreadConversationIds((prev) => removeUnread(prev, data.conversationId));
			if (activeConversationIdRef.current === data.conversationId) {
				setActiveConversationId(null);
				setChatMessages([]);
				setChatHasMoreOlder(false);
				setChatMessageDraft("");
				setGroupMembers(null);
				setIsAddMemberOpen(false);
				setGroupRenameDraft(null);
			}
		};

		// Group metadata changed (Decision 1): patch whichever field is present —
		// `name` on an owner rename (the thread header derives its title from the
		// list, so it updates too) and/or `ownerId` on an ownership transfer, so
		// the new owner's owner-only controls light up live.
		const onChatConversationUpdated = (data: {
			conversationId: number;
			name?: string;
			ownerId?: number | null;
		}) => {
			setConversations((prev) =>
				prev
					? prev.map((c) => {
							if (c.id !== data.conversationId) return c;
							const patched = { ...c };
							if (data.name !== undefined) patched.name = data.name;
							if (data.ownerId !== undefined) patched.ownerId = data.ownerId;
							return patched;
						})
					: prev,
			);
		};

		socket.on("chat:message", onChatMessage);
		socket.on("chat:unread-inbox", onChatUnreadInbox);
		socket.on("chat:unread", onChatUnread);
		socket.on("chat:read-sync", onChatReadSync);
		socket.on("chat:error", onChatError);
		socket.on("chat:removed", onChatRemoved);
		socket.on("chat:conversation-updated", onChatConversationUpdated);

		return () => {
			socket.off("chat:message", onChatMessage);
			socket.off("chat:unread-inbox", onChatUnreadInbox);
			socket.off("chat:unread", onChatUnread);
			socket.off("chat:read-sync", onChatReadSync);
			socket.off("chat:error", onChatError);
			socket.off("chat:removed", onChatRemoved);
			socket.off("chat:conversation-updated", onChatConversationUpdated);
		};
	}, [showToast]);

	const unreadCount = notifications.length;

	function handleMarkAllRead(): void {
		getGameSocket().emit("notification:read-all");
		setNotifications([]);
	}

	function handleMarkRead(id: number): void {
		getGameSocket().emit("notification:read", { notificationId: id });
		setNotifications((prev) => prev.filter((n) => n.id !== id));
	}

	/**
	 * Resolve every "friend_request" notification from `fromUserId`, not just
	 * the one that was clicked. Prevents a duplicate notification (e.g. from a
	 * retried request) from being actioned independently — accepting one and
	 * then declining the duplicate would otherwise net to added-then-removed.
	 */
	function handleResolveFriendRequestNotifs(fromUserId: number): void {
		const ids = notificationIdsFrom(notifications, fromUserId, "friend_request");
		for (const id of ids) {
			getGameSocket().emit("notification:read", { notificationId: id });
		}
		setNotifications((prev) =>
			removeNotificationsFrom(prev, fromUserId, "friend_request"),
		);
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

	useEffect(() => {
		setReplayFrameProgress(0);
	}, [selectedReplay?.matchId, selectedReplayFrame]);

	const matchReplays = useMemo(
		() => replays?.filter((replay) => !replay.isSavedByCurrentUser) ?? [],
		[replays],
	);
	const savedReplays = useMemo(
		() => replays?.filter((replay) => replay.isSavedByCurrentUser) ?? [],
		[replays],
	);

	const gameCards = useMemo(() => {
		const apiGames = new Map(minigames.map((game) => [game.id, game]));
		const knownGames = Object.entries(GAME_ROUTES).map(([id, meta]) => {
			const apiGame = apiGames.get(id);
			return {
				id,
				name: apiGame?.name ?? meta.label,
				description: apiGame?.description ?? meta.description,
				buttonImage: GAME_BUTTON_IMAGES[id],
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
				buttonImage: GAME_BUTTON_IMAGES[game.id],
				available: game.status === "available",
			}));

		return [...knownGames, ...extraGames];
	}, [minigames]);

	const cosmeticGroups = useMemo(() => {
		const groups = new Map<CosmeticCategoryType, Cosmetic[]>();
		groups.set("shell_skin", []);
		groups.set("hub_background", []);
		groups.set("trail_effect", []);
		groups.set("dojo_tag", []);
		for (const cosmetic of cosmetics ?? []) {
			if (cosmetic.type === "hub_background_alter") continue;
			groups.set(cosmetic.type, [...(groups.get(cosmetic.type) ?? []), cosmetic]);
		}
		return groups;
	}, [cosmetics]);

	const cosmeticCollectionProgress = useMemo(() => {
		let owned = 0;
		let total = 0;
		for (const group of cosmeticGroups.values()) {
			owned += group.filter((cosmetic) => cosmetic.owned).length;
			total += group.length;
		}
		return { owned, total };
	}, [cosmeticGroups]);

	const cosmeticCategoryProgress = useMemo(() => {
		const progress = new Map<CosmeticCategoryType, { owned: number; total: number }>();
		for (const category of ["shell_skin", "hub_background", "trail_effect", "dojo_tag"] as const) {
			const group = cosmeticGroups.get(category) ?? [];
			progress.set(category, {
				owned: group.filter((cosmetic) => cosmetic.owned).length,
				total: group.length,
			});
		}
		return progress;
	}, [cosmeticGroups]);

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

	useEffect(() => {
		if (!selectedShellCosmetic) return;
		const nextSelectedShell = cosmetics?.find(
			(cosmetic) => cosmetic.id === selectedShellCosmetic.id,
		);
		setSelectedShellCosmetic(nextSelectedShell ?? null);
	}, [cosmetics, selectedShellCosmetic]);

	const handleLogout = async () => {
		if (isLoggingOut) return;

		setIsLoggingOut(true);
		try {
			await api.getCsrfToken();
			await api.logout();
		} catch (err: unknown) {
			console.warn("[HomeMenu] Logout failed, redirecting anyway:", err);
		} finally {
			// Bug Audit H2: the game socket is a module-level singleton that
			// otherwise stays connected — and authenticated as this user — right
			// through logout. Left alone, the "logged-out" user stays "online"
			// to friends until the tab closes, and if another user logs in on
			// the same tab afterwards (SPA navigation, no reload) they'd inherit
			// this still-open socket: receiving the previous user's pushes,
			// never getting their own, and their notification:read/-all
			// emissions would mutate the previous user's rows. Disconnecting
			// here forces a fresh, correctly-authenticated socket on next
			// connect (getGameSocket() re-creates it lazily).
			disconnectGameSocket();
			navigate("/auth", { replace: true });
		}
	};

	const handleReturnToModeSelector = () => {
		setView("choose");
		navigate("/", { replace: true });
	};

	const modeHeading =
		view === "choose"
			? "Choose Mode"
			: view === "gambit"
				? "Shell's Gambit"
				: "Normal";

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
		setActiveCosmeticTab("all");
		setSelectedShellCosmetic(null);
		setModalError("");
		setCosmetics(null);
		try {
			setCosmetics(await api.getCustomization());
		} catch {
			setModalError("Could not load customisation. Try again later.");
		}
	};

	const handleCosmeticAction = async (cosmetic: Cosmetic) => {
		setModalError("");
		try {
			await api.getCsrfToken();
			let nextCosmetics = cosmetic.owned
				? await api.equipCosmetic(cosmetic.id)
				: await api.buyCosmetic(cosmetic.id);
			if (!cosmetic.owned && cosmetic.type === "trail_effect") {
				nextCosmetics = await api.equipCosmetic(cosmetic.id);
			}
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
			const equippedTrail = nextCosmetics.find(
				(item) => item.equipped && item.type === "trail_effect",
			);
			const equippedTag = nextCosmetics.find(
				(item) => item.equipped && item.type === "dojo_tag",
			);
			if (player) {
				let refreshedPlayer: User | null = null;
				try {
					refreshedPlayer = await api.getMe();
				} catch {
					// Keep the local cosmetic update if the balance refresh fails.
				}
				setPlayer(refreshedPlayer ?? {
					...player,
					hubBackground: equippedBackground?.id ?? player.hubBackground,
					hubBackgroundAlter: equippedBackgroundAlter?.id ?? null,
					shellSkin: equippedShell?.id ?? player.shellSkin,
					trailEffect: equippedTrail?.id ?? player.trailEffect,
					profile: player.profile
						? {
								...player.profile,
								tag: equippedTag?.id ?? player.profile.tag,
							}
						: player.profile,
				});
			}
		} catch {
			setModalError("Could not update customisation.");
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
		setOutgoingRequests(null);
		setSuggestions(null);
		setBlockedUsers(null);
		setFriendSearchQuery("");
		setBlockConfirmUserId(null);
		setReportTarget(null);
		setSocialLoading(true);
		setActiveConversationId(null);
		setChatMessages([]);
		setIsNewGroupOpen(false);
		setNewGroupName("");
		setNewGroupMemberIds(new Set());
		setIsGifPickerOpen(false);
		setGifSearchQuery("");
		setGifResults([]);
		// Commit any in-flight friend removals first, so the fresh fetch below
		// doesn't momentarily re-show a friend mid-undo-window (Bug Audit L2).
		await flushPendingRemovals();
		try {
			const [
				nextFriends,
				nextPending,
				nextOutgoing,
				nextSuggestions,
				nextBlocked,
				nextConversations,
			] = await Promise.all([
				api.getFriends(),
				api.getPendingRequests(),
				api.getOutgoingRequests(),
				api.getFriendSuggestions(),
				api.getBlockedUsers(),
				api.getConversations(),
			]);
			setFriends(nextFriends);
			setPendingRequests(nextPending);
			setOutgoingRequests(nextOutgoing);
			setSuggestions(nextSuggestions);
			setBlockedUsers(nextBlocked);
			setConversations(sortConversationsByRecency(nextConversations));
		} catch {
			setModalError("Could not load social data. Try again later.");
		} finally {
			setSocialLoading(false);
		}
	};

	/** Re-fetch just the conversation list — used after starting a dm/group or leaving one. */
	const refreshConversations = async (): Promise<void> => {
		try {
			const next = await api.getConversations();
			setConversations(sortConversationsByRecency(next));
		} catch {
			// Leave the current state in place; the user can reopen Social to retry.
		}
	};

	const handleOpenConversation = async (conversationId: number): Promise<void> => {
		setActiveConversationId(conversationId);
		setChatMessages([]);
		setChatHasMoreOlder(false);
		setIsGifPickerOpen(false);
		setGifSearchQuery("");
		setGifResults([]);
		setChatThreadLoading(true);
		try {
			const messages = await api.getChatMessages(conversationId);
			// A newer conversation was opened while this fetch was in flight — its
			// slower resolution must not overwrite the newer thread (Bug B5). Same
			// sequence guard as runGifSearch; the ref already tracks the open id.
			if (activeConversationIdRef.current !== conversationId) return;
			// Server returns newest-first for pagination; display oldest-first.
			const ordered = [...messages].reverse();
			// Preserve any live messages that arrived during this fetch and aren't
			// in the fetched page, so they're neither dropped nor duplicated
			// (Bug Audit L1).
			setChatMessages((live) => {
				const seen = new Set(ordered.map((m) => m.id));
				const extras = live.filter(
					(m) => m.conversationId === conversationId && !seen.has(m.id),
				);
				return [...ordered, ...extras];
			});
			// Open on the newest message, not the oldest page (Bug B2).
			chatScrollActionRef.current = { kind: "bottom" };
			// A full page implies there may be older history to page in (L6).
			setChatHasMoreOlder(messages.length >= CHAT_MESSAGE_PAGE_SIZE);
			getGameSocket().emit("chat:read", { conversationId });
			setUnreadConversationIds((prev) => removeUnread(prev, conversationId));
		} catch (err: unknown) {
			// Ignore a stale failure so it doesn't clobber the newer thread (Bug B5).
			if (activeConversationIdRef.current !== conversationId) return;
			showToast({
				message: err instanceof Error ? err.message : "Could not load messages.",
				variant: "error",
			});
			setActiveConversationId(null);
		} finally {
			// Only the fetch for the currently-open thread owns the loading flag.
			if (activeConversationIdRef.current === conversationId) {
				setChatThreadLoading(false);
			}
		}
	};

	/** Page in the previous batch of messages, prepending them (Bug Audit L6). */
	const handleLoadOlderMessages = async (): Promise<void> => {
		if (!activeConversationId || chatLoadingOlder || chatMessages.length === 0) {
			return;
		}
		const oldest = chatMessages[0];
		setChatLoadingOlder(true);
		try {
			// Cursor by id, not createdAt, so a page boundary that lands between
			// two messages sharing a millisecond can't skip one (Bug B6).
			const older = await api.getChatMessages(activeConversationId, oldest.id);
			// Server returns newest-first; reverse to oldest-first, dedup, prepend.
			const ordered = [...older].reverse();
			// Capture the pre-prepend height so the layout effect can hold the
			// viewport on the same message instead of jumping (Bug B2).
			chatScrollActionRef.current = {
				kind: "preserve",
				prevScrollHeight: chatListRef.current?.scrollHeight ?? 0,
			};
			setChatMessages((prev) => {
				const seen = new Set(prev.map((m) => m.id));
				const dedup = ordered.filter((m) => !seen.has(m.id));
				return [...dedup, ...prev];
			});
			setChatHasMoreOlder(older.length >= CHAT_MESSAGE_PAGE_SIZE);
		} catch (err: unknown) {
			showToast({
				message:
					err instanceof Error
						? err.message
						: "Could not load older messages.",
				variant: "error",
			});
		} finally {
			setChatLoadingOlder(false);
		}
	};

	const handleCloseConversation = (): void => {
		setActiveConversationId(null);
		setChatMessages([]);
		setChatHasMoreOlder(false);
		setChatMessageDraft("");
		setIsGifPickerOpen(false);
		setGifSearchQuery("");
		setGifResults([]);
		// Reset the group member-management UI (Decision 1/2).
		setGroupMembers(null);
		setGroupMembersLoading(false);
		setIsAddMemberOpen(false);
		setGroupRenameDraft(null);
	};

	const handleStartDirectMessage = async (friend: { userId: number }): Promise<void> => {
		if (chatActionLoading) return;
		setChatActionLoading(true);
		try {
			await api.getCsrfToken();
			const conversation = await api.startDirectMessage(friend.userId);
			await refreshConversations();
			await handleOpenConversation(conversation.id);
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not start conversation.",
				variant: "error",
			});
		} finally {
			setChatActionLoading(false);
		}
	};

	const handleSendChatMessage = (): void => {
		const trimmed = chatMessageDraft.trim();
		if (!trimmed || !activeConversationId) return;
		// Force a scroll-to-bottom when our own message echoes back, even if we'd
		// scrolled up to read history (Bug B2).
		pendingSendScrollRef.current = true;
		// Arm the draft-restore ref so a server rejection can hand the text back
		// (Bug B8); the message echo disarms it on success.
		lastSentChatBodyRef.current = trimmed;
		getGameSocket().emit("chat:send", {
			conversationId: activeConversationId,
			body: trimmed,
		});
		setChatMessageDraft("");
	};

	/**
	 * Monotonic id for the latest in-flight gif search. A slower earlier
	 * response must not overwrite a newer one (Bug Audit L3).
	 */
	const gifSearchSeq = useRef(0);

	/** Run a gif search and populate gifResults — called (debounced) as the user types. */
	const runGifSearch = async (query: string): Promise<void> => {
		const trimmed = query.trim();
		const seq = ++gifSearchSeq.current;
		if (trimmed.length < GIF_SEARCH_MIN_LENGTH) {
			setGifResults([]);
			setGifSearchLoading(false);
			return;
		}
		setGifSearchLoading(true);
		try {
			const results = await api.searchGifs(trimmed);
			// Drop a stale response that resolved after a newer search began.
			if (seq !== gifSearchSeq.current) return;
			setGifResults(results);
		} catch {
			// Non-fatal — an empty grid with no error toast is enough feedback here.
			if (seq !== gifSearchSeq.current) return;
			setGifResults([]);
		} finally {
			if (seq === gifSearchSeq.current) setGifSearchLoading(false);
		}
	};

	const gifSearchDebounce = useRef(
		debounce((query: string) => void runGifSearch(query), GIF_SEARCH_DEBOUNCE_MS),
	).current;

	const handleGifSearchChange = (value: string): void => {
		setGifSearchQuery(value);
		gifSearchDebounce.run(value);
	};

	const handleToggleGifPicker = (): void => {
		setIsGifPickerOpen((prev) => {
			const next = !prev;
			if (!next) {
				gifSearchDebounce.cancel();
				setGifSearchQuery("");
				setGifResults([]);
			}
			return next;
		});
	};

	const handleSendGif = (gif: GifSearchResult): void => {
		if (!activeConversationId) return;
		// Force a scroll-to-bottom when our own gif echoes back (Bug B2).
		pendingSendScrollRef.current = true;
		// A gif send must not leave stale text armed for restore (Bug B8).
		lastSentChatBodyRef.current = "";
		getGameSocket().emit("chat:send-gif", {
			conversationId: activeConversationId,
			slug: gif.slug,
		});
		setIsGifPickerOpen(false);
		setGifSearchQuery("");
		setGifResults([]);
	};

	const handleToggleNewGroupMember = (userId: number): void => {
		setNewGroupMemberIds((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});
	};

	const handleCreateGroup = async (): Promise<void> => {
		const trimmedName = newGroupName.trim();
		if (!trimmedName || newGroupMemberIds.size === 0 || chatActionLoading) return;
		setChatActionLoading(true);
		try {
			await api.getCsrfToken();
			const conversation = await api.createGroupChat(trimmedName, [
				...newGroupMemberIds,
			]);
			setIsNewGroupOpen(false);
			setNewGroupName("");
			setNewGroupMemberIds(new Set());
			await refreshConversations();
			await handleOpenConversation(conversation.id);
			showToast({ message: `Created ${trimmedName}`, variant: "success" });
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not create group.",
				variant: "error",
			});
		} finally {
			setChatActionLoading(false);
		}
	};

	const handleLeaveGroup = async (conversationId: number): Promise<void> => {
		if (chatActionLoading) return;
		setChatActionLoading(true);
		try {
			await api.getCsrfToken();
			await api.leaveGroupChat(conversationId);
			handleCloseConversation();
			await refreshConversations();
			showToast({ message: "Left group", variant: "info" });
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not leave group.",
				variant: "error",
			});
		} finally {
			setChatActionLoading(false);
		}
	};

	/** Fetch and cache the open group's member list (Decision 2). */
	const refreshGroupMembers = async (conversationId: number): Promise<void> => {
		try {
			const members = await api.getGroupMembers(conversationId);
			// Guard against a stale response for a thread that's since closed/changed.
			if (activeConversationIdRef.current !== conversationId) return;
			setGroupMembers(members);
		} catch {
			// Leave whatever's shown; the toggle can be retried.
		}
	};

	/** Toggle the member panel; loads members on first open. */
	const handleToggleMembers = (): void => {
		if (!activeConversationId) return;
		if (groupMembers !== null) {
			setGroupMembers(null);
			setIsAddMemberOpen(false);
			return;
		}
		setGroupMembersLoading(true);
		void refreshGroupMembers(activeConversationId).finally(() =>
			setGroupMembersLoading(false),
		);
	};

	/** Owner-only: kick a member, then refresh the panel (Decision 1). */
	const handleKickMember = async (userId: number): Promise<void> => {
		if (!activeConversationId || groupActionLoading) return;
		setGroupActionLoading(true);
		try {
			await api.getCsrfToken();
			await api.kickGroupMember(activeConversationId, userId);
			await refreshGroupMembers(activeConversationId);
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not remove member.",
				variant: "error",
			});
		} finally {
			setGroupActionLoading(false);
		}
	};

	/** Add a friend to the open group, then refresh the panel (Decision 2). */
	const handleAddMemberToGroup = async (userId: number): Promise<void> => {
		if (!activeConversationId || groupActionLoading) return;
		setGroupActionLoading(true);
		try {
			await api.getCsrfToken();
			await api.addGroupMember(activeConversationId, userId);
			await refreshGroupMembers(activeConversationId);
			setIsAddMemberOpen(false);
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not add member.",
				variant: "error",
			});
		} finally {
			setGroupActionLoading(false);
		}
	};

	/** Owner-only: commit a group rename (Decision 1). */
	const handleRenameGroup = async (): Promise<void> => {
		if (!activeConversationId || groupActionLoading || groupRenameDraft === null) {
			return;
		}
		const trimmed = groupRenameDraft.trim();
		if (trimmed.length === 0) return;
		setGroupActionLoading(true);
		try {
			await api.getCsrfToken();
			await api.renameGroupChat(activeConversationId, trimmed);
			// The list + title update via the chat:conversation-updated broadcast.
			setGroupRenameDraft(null);
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not rename group.",
				variant: "error",
			});
		} finally {
			setGroupActionLoading(false);
		}
	};

	/** Owner-only: delete the open group (Decision 1). The owner also receives
	 * chat:removed, which closes the thread — no manual close needed here. */
	const handleDeleteGroup = async (): Promise<void> => {
		if (!activeConversationId || groupActionLoading) return;
		setGroupActionLoading(true);
		try {
			await api.getCsrfToken();
			await api.deleteGroupChat(activeConversationId);
			await refreshConversations();
			showToast({ message: "Group deleted", variant: "info" });
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not delete group.",
				variant: "error",
			});
		} finally {
			setGroupActionLoading(false);
		}
	};

	// Derived group/owner state for the member panel (Decision 1/2).
	const activeConversation =
		activeConversationId !== null
			? (conversations?.find((c) => c.id === activeConversationId) ?? null)
			: null;
	const isActiveGroup = activeConversation?.type === "group";
	const isOwnerOfActiveGroup =
		isActiveGroup &&
		activeConversation?.ownerId != null &&
		activeConversation.ownerId === player?.id;
	const activeMemberIds = new Set((groupMembers ?? []).map((m) => m.userId));
	// Friends not already in the group — the add-member candidate list.
	const addableFriends = (friends ?? []).filter(
		(f) => !activeMemberIds.has(f.userId),
	);

	const openReplays = async () => {
		setActiveModal("replays");
		setModalError("");
		setReplaysLoading(true);
		setSelectedReplay(null);
		setSelectedReplayFrame(0);
		setReplayFrameProgress(0);
		setIsReplayPlaying(false);
		setIsReplayExpanded(false);
		setReplayTab("match");
		try {
			const nextReplays = await api.getMyReplays();
			setReplays(nextReplays);
		} catch (err: unknown) {
			setModalError(err instanceof Error ? err.message : "Could not load replays.");
			setReplays(null);
		} finally {
			setReplaysLoading(false);
		}
	};

	const handleLoadReplay = async (matchId: string) => {
		setReplayActionLoading(matchId);
		setModalError("");
		setIsReplayPlaying(false);
		setIsReplayExpanded(false);
		try {
			const replay = await api.getReplay(matchId);
			setSelectedReplay(replay);
			setSelectedReplayFrame(0);
			setReplayFrameProgress(0);
		} catch (err: unknown) {
			setModalError(
				err instanceof Error ? err.message : "Could not load replay.",
			);
		} finally {
			setReplayActionLoading(null);
		}
	};

	const handleSaveReplay = async (
		matchId: string,
		nextSavedState: boolean,
	) => {
		setReplayActionLoading(matchId);
		setModalError("");
		try {
			await api.getCsrfToken();
			const updated = nextSavedState
				? await api.saveReplay(matchId)
				: await api.unsaveReplay(matchId);
			if (nextSavedState) setReplayTab("saved");
			else if (replayTab === "saved") setReplayTab("match");
			const refreshedReplays = await api.getMyReplays();
			setReplays(refreshedReplays);
			setSelectedReplay((prev) =>
				prev && prev.matchId === matchId ? { ...prev, ...updated } : prev,
			);
		} catch (err: unknown) {
			setModalError(
				err instanceof Error ? err.message : "Could not update replay.",
			);
		} finally {
			setReplayActionLoading(null);
		}
	};

	/** Re-fetch friends + pending + outgoing from the server (used to reconcile
	 *  after an optimistic update fails). Non-fatal on its own failure. */
	const refreshSocial = async (): Promise<void> => {
		try {
			const [
				nextFriends,
				nextPending,
				nextOutgoing,
				nextSuggestions,
				nextBlocked,
			] = await Promise.all([
				api.getFriends(),
				api.getPendingRequests(),
				api.getOutgoingRequests(),
				api.getFriendSuggestions(),
				api.getBlockedUsers(),
			]);
			setFriends(nextFriends);
			setPendingRequests(nextPending);
			setOutgoingRequests(nextOutgoing);
			setSuggestions(nextSuggestions);
			setBlockedUsers(nextBlocked);
		} catch {
			// Leave the current optimistic state in place; the user can reopen.
		}
	};

	/** Unblock a user and optimistically drop them from the Blocked list. */
	const handleUnblockUser = async (blocked: PendingView): Promise<void> => {
		setBlockedUsers((prev) => (prev ? removeById(prev, blocked.userId) : prev));
		try {
			await api.getCsrfToken();
			await api.unblockUser(blocked.userId);
			showToast({
				message: `Unblocked ${blocked.turtleName ?? blocked.username}`,
				variant: "info",
			});
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not unblock user.",
				variant: "error",
			});
			void refreshSocial();
		}
	};

	const handleCopyFriendCode = async () => {
		if (!player?.username) return;
		const code = buildFriendCode(player.username);
		try {
			if (!globalThis.navigator?.clipboard?.writeText) {
				throw new Error("Clipboard unavailable");
			}
			await globalThis.navigator.clipboard.writeText(code);
			showToast({ message: "Friend code copied", variant: "success" });
		} catch {
			showToast({
				message: `Could not copy — your friend code is ${code}`,
				variant: "error",
			});
		}
	};

	const handleSendFriendRequest = async () => {
		// Accept a pasted friend code (`@username`) as well as a bare username
		// (Bug Audit M4).
		const trimmed = parseFriendCode(friendUsername);
		if (!trimmed || friendActionLoading) return;
		setFriendActionLoading(true);
		try {
			await api.getCsrfToken();
			await api.sendFriendRequest(trimmed);
			setFriendUsername("");
			showToast({
				message: `Friend request sent to ${trimmed}`,
				variant: "success",
			});
			void refreshSocial();
		} catch (err: unknown) {
			showToast({
				message:
					err instanceof Error ? err.message : "Could not send request.",
				variant: "error",
			});
		} finally {
			setFriendActionLoading(false);
		}
	};

	const handleAddSuggestion = async (
		suggestion: PendingView,
	): Promise<void> => {
		// Optimistically drop from suggestions so the button can't be double-clicked.
		setSuggestions((prev) =>
			prev ? removeById(prev, suggestion.userId) : prev,
		);
		try {
			await api.getCsrfToken();
			await api.sendFriendRequest(suggestion.username);
			showToast({
				message: `Friend request sent to ${suggestion.turtleName ?? suggestion.username}`,
				variant: "success",
			});
			void refreshSocial();
		} catch (err: unknown) {
			showToast({
				message:
					err instanceof Error ? err.message : "Could not send request.",
				variant: "error",
			});
			void refreshSocial();
		}
	};

	const handleAcceptRequest = async (req: PendingView) => {
		// Optimistically move the requester from pending → friends.
		const optimisticFriend: FriendView = {
			userId: req.userId,
			username: req.username,
			turtleName: req.turtleName,
			shellSkin: req.shellSkin,
			avatar: req.avatar,
			level: req.level,
			isOnline: req.isOnline,
			status: req.isOnline ? "online" : "offline",
			gameId: null,
			lastSeenAt: null,
			requesterId: req.userId,
		};
		setPendingRequests((prev) => (prev ? removeById(prev, req.userId) : prev));
		setFriends((prev) => upsertById(prev ?? [], optimisticFriend));
		try {
			await api.getCsrfToken();
			await api.acceptFriendRequest(req.userId);
			// Bug Audit H3: accepting from the social tab used to never clear the
			// matching "X sent you a friend request" bell entry — its Accept
			// button would then 404 forever since the pending row is gone. The
			// backend now also cleans this up server-side (and re-pushes the
			// inbox to every tab), but resolving it locally too avoids a stale
			// flash in this tab before that push arrives.
			handleResolveFriendRequestNotifs(req.userId);
			showToast({
				message: `You're now friends with ${req.turtleName ?? req.username}`,
				variant: "success",
			});
		} catch (err: unknown) {
			showToast({
				message:
					err instanceof Error ? err.message : "Could not accept request.",
				variant: "error",
			});
		} finally {
			// Reconcile with the server either way so the UI matches reality.
			void refreshSocial();
		}
	};

	/** Commit a deferred friend removal once the Undo window has elapsed. */
	const commitRemoveFriend = async (userId: number): Promise<void> => {
		removalTimers.current.delete(userId);
		try {
			await api.getCsrfToken();
			await api.removeFriend(userId);
		} catch {
			showToast({
				message: "Couldn't remove friend — restoring.",
				variant: "error",
			});
			void refreshSocial();
		}
	};

	/**
	 * Commit every still-pending friend removal immediately. Called before
	 * (re)loading the friends list so a friend whose undo window hasn't elapsed
	 * isn't briefly re-shown by the fresh fetch only to vanish again seconds
	 * later (Bug Audit L2).
	 */
	const flushPendingRemovals = async (): Promise<void> => {
		const entries = [...removalTimers.current.entries()];
		await Promise.all(
			entries.map(([userId, timer]) => {
				clearTimeout(timer);
				return commitRemoveFriend(userId);
			}),
		);
	};

	const handleRemoveFriend = (friend: FriendView) => {
		// Optimistically drop the friend, leaving a window to undo before commit.
		setFriends((prev) => (prev ? removeById(prev, friend.userId) : prev));
		const timer = setTimeout(
			() => void commitRemoveFriend(friend.userId),
			FRIEND_REMOVAL_UNDO_MS,
		);
		removalTimers.current.set(friend.userId, timer);
		showToast({
			message: `Removed ${friend.turtleName ?? friend.username}`,
			variant: "info",
			durationMs: FRIEND_REMOVAL_UNDO_MS,
			action: {
				label: "Undo",
				onAction: () => {
					const pending = removalTimers.current.get(friend.userId);
					if (pending) {
						clearTimeout(pending);
						removalTimers.current.delete(friend.userId);
					}
					setFriends((prev) => upsertById(prev ?? [], friend));
				},
			},
		});
	};

	/**
	 * Block is immediate (no undo) — a deliberately confirmed, more severe
	 * action than remove/decline. Optimistically drops the user from every
	 * social list they might currently appear in.
	 */
	const handleBlockUser = async (friend: {
		userId: number;
		username: string;
		turtleName: string | null;
	}): Promise<void> => {
		setBlockConfirmUserId(null);
		setFriends((prev) => (prev ? removeById(prev, friend.userId) : prev));
		setPendingRequests((prev) =>
			prev ? removeById(prev, friend.userId) : prev,
		);
		setOutgoingRequests((prev) =>
			prev ? removeById(prev, friend.userId) : prev,
		);
		// Also drop from suggestions — otherwise a blocked user lingers there
		// with an Add button that 409s against the new block row (Bug Audit M5).
		setSuggestions((prev) => (prev ? removeById(prev, friend.userId) : prev));
		try {
			await api.getCsrfToken();
			await api.blockUser(friend.userId);
			showToast({
				message: `Blocked ${friend.turtleName ?? friend.username}`,
				variant: "info",
			});
			// Refresh so the new entry appears in the Blocked list (Bug Audit H3).
			void refreshSocial();
		} catch (err: unknown) {
			showToast({
				message: err instanceof Error ? err.message : "Could not block user.",
				variant: "error",
			});
			void refreshSocial();
		}
	};

	/**
	 * Reporting always auto-blocks (locked product decision — no separate
	 * block step). Optimistically drops the reported user from every social
	 * list, same as handleBlockUser.
	 */
	const handleSubmitReport = async (): Promise<void> => {
		if (!reportTarget) return;
		setReportLoading(true);
		try {
			await api.getCsrfToken();
			await api.reportUser(
				reportTarget.userId,
				reportCategory,
				reportMessage.trim() || undefined,
			);
			setFriends((prev) =>
				prev ? removeById(prev, reportTarget.userId) : prev,
			);
			setPendingRequests((prev) =>
				prev ? removeById(prev, reportTarget.userId) : prev,
			);
			setOutgoingRequests((prev) =>
				prev ? removeById(prev, reportTarget.userId) : prev,
			);
			// Reporting auto-blocks, so drop from suggestions too (Bug Audit M5).
			setSuggestions((prev) =>
				prev ? removeById(prev, reportTarget.userId) : prev,
			);
			showToast({
				message: `Reported and blocked ${reportTarget.turtleName ?? reportTarget.username}`,
				variant: "info",
			});
			setReportTarget(null);
			setReportMessage("");
			setReportCategory(REPORT_CATEGORIES[0].id);
			// Refresh so the Blocked list picks up the auto-block (Bug Audit H3/M5).
			void refreshSocial();
		} catch (err: unknown) {
			showToast({
				message:
					err instanceof Error ? err.message : "Could not submit report.",
				variant: "error",
			});
		} finally {
			setReportLoading(false);
		}
	};

	const handleDeclineRequest = async (req: PendingView) => {
		// Declines are immediate (no undo): drop from pending, delete server-side.
		setPendingRequests((prev) => (prev ? removeById(prev, req.userId) : prev));
		try {
			await api.getCsrfToken();
			await api.declineOrCancelFriendRequest(req.userId);
			showToast({
				message: `Declined ${req.turtleName ?? req.username}`,
				variant: "info",
			});
		} catch (err: unknown) {
			showToast({
				message:
					err instanceof Error ? err.message : "Could not decline request.",
				variant: "error",
			});
			void refreshSocial();
		}
	};

	const handleCancelOutgoingRequest = async (req: PendingView) => {
		// Cancelling is immediate (no undo), same as declining an incoming request.
		setOutgoingRequests((prev) =>
			prev ? removeById(prev, req.userId) : prev,
		);
		try {
			await api.getCsrfToken();
			await api.declineOrCancelFriendRequest(req.userId);
			showToast({
				message: `Cancelled request to ${req.turtleName ?? req.username}`,
				variant: "info",
			});
		} catch (err: unknown) {
			showToast({
				message:
					err instanceof Error ? err.message : "Could not cancel request.",
				variant: "error",
			});
			void refreshSocial();
		}
	};

	/** Fetch (or reuse the cached) profile for the hover/focus card. */
	const loadHoveredProfile = async (username: string): Promise<void> => {
		const cached = profileCardCache.get(username);
		if (cached) {
			setHoveredProfile(cached);
			setHoveredProfileLoading(false);
			return;
		}
		setHoveredProfileLoading(true);
		try {
			const fetched = await api.getUser(username);
			profileCardCache.set(username, fetched);
			setHoveredProfile(fetched);
		} catch {
			setHoveredProfile(null);
		} finally {
			setHoveredProfileLoading(false);
		}
	};

	const profileHoverDebounce = useRef(
		debounce(
			(username: string) => void loadHoveredProfile(username),
			PROFILE_HOVER_DEBOUNCE_MS,
		),
	).current;

	const handleFriendHoverStart = (friend: FriendView): void => {
		setHoveredFriendUsername(friend.username);
		const cached = profileCardCache.get(friend.username);
		if (cached) {
			setHoveredProfile(cached);
			setHoveredProfileLoading(false);
			return;
		}
		setHoveredProfile(null);
		setHoveredProfileLoading(true);
		profileHoverDebounce.run(friend.username);
	};

	const handleFriendHoverEnd = (): void => {
		profileHoverDebounce.cancel();
		setHoveredFriendUsername(null);
		setHoveredProfile(null);
		setHoveredProfileLoading(false);
	};

	if (isLoading) return <RouteLoading />;

	const playerName = player?.turtleName ?? player?.username ?? "Player";
	const friendStats = friendCounts(friends);
	const filteredFriends = friends
		? filterFriends(friends, friendSearchQuery)
		: null;
	const friendGroups = filteredFriends
		? groupFriendsByPresence(filteredFriends)
		: null;

	/** Render a single friend row (shared across presence groups). */
	const friendRow = (friend: FriendView): JSX.Element => (
		<li key={friend.userId} className="hub-modal__social-row">
			<span
				className="hub-modal__social-name"
				tabIndex={0}
				aria-label={`View profile card for ${friend.turtleName ?? friend.username}`}
				onMouseEnter={() => handleFriendHoverStart(friend)}
				onMouseLeave={handleFriendHoverEnd}
				onFocus={() => handleFriendHoverStart(friend)}
				onBlur={handleFriendHoverEnd}
			>
				{friend.turtleName ?? friend.username}
				<small> @{friend.username}</small>
				{friend.status === "in-game" ? (
					<span className="hub-modal__social-status hub-modal__social-status--ingame">
						{RANKED_GAMES.find((g) => g.id === friend.gameId)?.label ??
							"In a match"}
					</span>
				) : friend.status === "online" ? (
					<span
						className="hub-modal__social-online"
						role="img"
						aria-label="Online"
					/>
				) : (
					<span className="hub-modal__social-status hub-modal__social-status--offline">
						Last online {formatRelativeTime(friend.lastSeenAt)}
					</span>
				)}
				{hoveredFriendUsername === friend.username ? (
					<ProfileCard user={hoveredProfile} loading={hoveredProfileLoading} />
				) : null}
			</span>
			<div className="hub-modal__social-actions">
				{blockConfirmUserId === friend.userId ? (
					<>
						<span className="hub-modal__social-confirm-label">
							Block {friend.turtleName ?? friend.username}?
						</span>
						<button
							type="button"
							ref={blockConfirmButtonRef}
							className="hub-modal__social-confirm-btn"
							onClick={() => void handleBlockUser(friend)}
						>
							Confirm
						</button>
						<button
							type="button"
							onClick={() => setBlockConfirmUserId(null)}
						>
							Cancel
						</button>
					</>
				) : (
					<>
						<button
							type="button"
							className="hub-modal__social-message-btn"
							disabled={chatActionLoading}
							onClick={() => void handleStartDirectMessage(friend)}
						>
							Message
						</button>
						{friend.isOnline && !activeLobby && (
							<button
								type="button"
								className="hub-modal__social-invite-btn"
								onClick={() =>
									setInviteTarget({
										userId: friend.userId,
										name: friend.turtleName ?? friend.username,
									})
								}
							>
								Invite
							</button>
						)}
						<button
							type="button"
							onClick={() => void handleRemoveFriend(friend)}
						>
							Remove
						</button>
						<button
							type="button"
							className="hub-modal__social-block-btn"
							onClick={() => setBlockConfirmUserId(friend.userId)}
						>
							Block
						</button>
						<button
							type="button"
							className="hub-modal__social-block-btn"
							onClick={() =>
								setReportTarget({
									userId: friend.userId,
									username: friend.username,
									turtleName: friend.turtleName,
								})
							}
						>
							Report
						</button>
					</>
				)}
			</div>
		</li>
	);

	const profileTagId = player?.profile?.tag ?? null;
	const currentTag = profileTagId
		? (TURTLE_TAGS.find((t) => t.id === profileTagId) ?? null)
		: null;

	const showcasedIds = player?.profile?.showcasedAchievements ?? [];
	const showcasedAchievements = showcasedIds
		.map((id) => achievements?.find((a) => a.id === id) ?? null)
		.filter((a): a is Achievement => a !== null);
	const unlockedAchievementCount =
		achievements?.filter((achievement) => achievement.unlocked).length ?? 0;
	const totalAchievementCount = achievements?.length ?? 0;
	const filteredAchievements = achievements
		? achievements.filter((achievement) => {
				if (achievementFilter === "unlocked") return achievement.unlocked;
				if (achievementFilter === "locked") return !achievement.unlocked;
				return true;
			})
		: [];

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
							Lvl {player?.level ?? 1} · {getShellSkinDisplayName(player?.shellSkin)} · ⬡ {player?.coins ?? 0}
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
								<span className="hub-notif-bell__badge">
									{unreadCount > NOTIF_BADGE_CAP ? `${NOTIF_BADGE_CAP}+` : unreadCount}
								</span>
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
							onClick={() => setActiveModal("cards")}
						>
							SHELL CARDS
						</NineSliceButton>
						<NineSliceButton
							type="button"
							className="hub-panel__button"
							onClick={openAchievements}
						>
							ACHIEVEMENTS
						</NineSliceButton>
						<NineSliceButton
							type="button"
							className="hub-panel__button"
							onClick={openCustomization}
						>
							CUSTOMISATION
						</NineSliceButton>
						<NineSliceButton
							type="button"
							className="hub-panel__button"
							onClick={() => void openReplays()}
						>
							REPLAYS
						</NineSliceButton>
						<NineSliceButton type="button" className="hub-panel__button" onClick={() => void openSocial()}>
							SOCIAL
							{unreadConversationIds.size > 0 ? ` (${unreadConversationIds.size})` : ""}
						</NineSliceButton>
						<NineSliceButton
							type="button"
							className="hub-panel__button"
							onClick={() => setActiveModal("rankings")}
						>
							RANKINGS
						</NineSliceButton>
					</aside>

					<section className="hub-page__stage">
						<div className="menu-page__heading">
							<span className="menu-page__heading-line" />
							<h1 className="menu-page__choose-label">
								{modeHeading}
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
										src="/assets/ui/modesButtons/normalButton.png"
										alt=""
										aria-hidden="true"
									/>
									<span className="menu-page__mode-title">Normal Mode</span>
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
										src="/assets/ui/modesButtons/tournamentButton.png"
										alt=""
										aria-hidden="true"
									/>
									<span className="menu-page__mode-title">Tournament</span>
									<span className="menu-page__mode-divider" aria-hidden="true" />
									<span className="menu-page__mode-description">Compete for the top.</span>
								</button>

								<button
									className="menu-page__mode-card menu-page__mode-card--gambit"
									type="button"
									onClick={() => setView("gambit")}
								>
									<span className="menu-page__mode-corners" aria-hidden="true" />
									<img
										className="menu-page__mode-art"
										src="/assets/ui/modesButtons/gambitButton.png"
										alt=""
										aria-hidden="true"
									/>
									<span className="menu-page__mode-title">Shell's Gambit</span>
									<span className="menu-page__mode-divider" aria-hidden="true" />
									<span className="menu-page__mode-description">Risk coins for glory.</span>
								</button>
							</div>
						) : (
							<div className="hub-page__normal-view">
								<div className="hub-page__game-grid">
									{view === "gambit" ? (
										<>
											<button
												className="hub-game-card hub-game-card--fortune-wheel"
												type="button"
												onClick={() => setActiveModal("casino")}
											>
												<img
													className="hub-game-card__image"
													src={GAMBIT_BUTTON_IMAGES.casino}
													alt=""
													aria-hidden="true"
												/>
												<span className="sr-only">Fortune Wheel</span>
												<small>Wager coins at the gambling den</small>
											</button>
											<button
												className="hub-game-card hub-game-card--shell-flip"
												type="button"
												onClick={() => setActiveModal("flip")}
											>
												<img
													className="hub-game-card__image"
													src={GAMBIT_BUTTON_IMAGES.flip}
													alt=""
													aria-hidden="true"
												/>
												<span className="sr-only">Shell Flip</span>
												<small>Call a shell, double or nothing</small>
											</button>
											<button
												className="hub-game-card hub-game-card--three-shell-monte"
												type="button"
												onClick={() => setActiveModal("monte")}
											>
												<img
													className="hub-game-card__image"
													src={GAMBIT_BUTTON_IMAGES.monte}
													alt=""
													aria-hidden="true"
												/>
												<span className="sr-only">Three-Shell Monte</span>
												<small>Find the pearl, pay up to 5×</small>
											</button>
											<button
												className="hub-game-card hub-game-card--shrine-slots"
												type="button"
												onClick={() => setActiveModal("slots")}
											>
												<img
													className="hub-game-card__image"
													src={GAMBIT_BUTTON_IMAGES.slots}
													alt=""
													aria-hidden="true"
												/>
												<span className="sr-only">Shrine Slots</span>
												<small>Spin three reels for the jackpot</small>
											</button>
											<button
												className="hub-game-card hub-game-card--koi-dice"
												type="button"
												onClick={() => setActiveModal("dice")}
											>
												<img
													className="hub-game-card__image"
													src={GAMBIT_BUTTON_IMAGES.dice}
													alt=""
													aria-hidden="true"
												/>
												<span className="sr-only">Koi Dice</span>
												<small>Set your own odds, under or over</small>
											</button>
											<button
												className="hub-game-card hub-game-card--shell-drop"
												type="button"
												onClick={() => setActiveModal("drop")}
											>
												<img
													className="hub-game-card__image"
													src={GAMBIT_BUTTON_IMAGES.drop}
													alt=""
													aria-hidden="true"
												/>
												<span className="sr-only">Shell Drop</span>
												<small>Drop a shell through the pegs</small>
											</button>
										</>
									) : (
										gameCards.map((game) =>
											game.available ? (
												<Link
													key={game.id}
													className={`hub-game-card hub-game-card--${game.id}`}
													to={`/play/${game.id}`}
												>
													{game.buttonImage ? (
														<>
															<img
																className="hub-game-card__image"
																src={game.buttonImage}
																alt=""
																aria-hidden="true"
															/>
															<span className="sr-only">{game.name}</span>
															<small>{game.description}</small>
														</>
													) : (
														<>
															<span>{game.name}</span>
															<small>{game.description}</small>
														</>
													)}
												</Link>
											) : (
												<button
													key={game.id}
													className={`hub-game-card hub-game-card--locked hub-game-card--${game.id}`}
													type="button"
													onClick={() =>
												game.id === "river-rush" || game.id === "oni-dodge"
													? setWipGameId(game.id)
															: setInfoModal({
																	title: game.name,
																	description: `${game.description}\n\nArena is being built. Check back soon!`,
																})
													}
												>
													{game.buttonImage ? (
														<>
															<img
																className="hub-game-card__image"
																src={game.buttonImage}
																alt=""
																aria-hidden="true"
															/>
															<span className="sr-only">{game.name}</span>
															<small>{game.description}</small>
														</>
													) : (
														<>
															<span>{game.name}</span>
															<small>Coming soon</small>
														</>
													)}
												</button>
											),
										)
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
				isOpen={wipGameId !== null}
				onClose={() => setWipGameId(null)}
				featureName={wipGameId ? GAME_ROUTES[wipGameId].label : "Game"}
				title="Work In Progress"
				description={
					wipGameId === "oni-dodge"
						? "Oni Dodge is not designed yet. The oni assault will begin when the mode is ready."
						: "River Rush is not designed yet. This shrine will open when the mode is ready."
				}
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
										{/* Bug Audit L6 — createdAt was fetched but never rendered. */}
										<time
											className="hub-notif-drawer__item-time"
											dateTime={notif.createdAt}
										>
											{formatRelativeTime(notif.createdAt)}
										</time>
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
															handleResolveFriendRequestNotifs(notif.fromUserId);
															// Keep the social tab's friends/pending state in sync in
															// case it's open (or opened next) elsewhere.
															void refreshSocial();
														} catch (err: unknown) {
															// Bug Audit M3: this used to swallow every failure
															// silently — rate-limited (429), or the request
															// was already resolved elsewhere (404) — so the
															// button visibly did nothing. A 404 here means the
															// pending row is already gone (accepted/declined/
															// cancelled from another tab or device), so treat
															// it as resolved rather than a real error — this
															// also closes the H3 dead-end where an accept that
															// 404s left the notification stuck forever.
															if (err instanceof AuthError && err.status === 404) {
																handleResolveFriendRequestNotifs(notif.fromUserId);
																void refreshSocial();
																return;
															}
															showToast({
																message:
																	err instanceof Error
																		? err.message
																		: "Could not accept request.",
																variant: "error",
															});
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
															await api.declineOrCancelFriendRequest(notif.fromUserId);
															handleResolveFriendRequestNotifs(notif.fromUserId);
															// Keep the social tab's friends/pending state in sync in
															// case it's open (or opened next) elsewhere.
															void refreshSocial();
														} catch (err: unknown) {
															// Bug Audit M3 — see the Accept handler above;
															// decline is idempotent server-side so a 404 here
															// is rarer, but the stale-notification cleanup
															// still applies if it happens.
															if (err instanceof AuthError && err.status === 404) {
																handleResolveFriendRequestNotifs(notif.fromUserId);
																void refreshSocial();
																return;
															}
															showToast({
																message:
																	err instanceof Error
																		? err.message
																		: "Could not decline request.",
																variant: "error",
															});
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
				<HubModal title="Rankings" onClose={() => setActiveModal(null)} variant="wide">
					<div className="hub-modal__rankings">
						<div className="hub-ranking-controls">
							<nav className="hub-ranking-tabs" aria-label="Select game leaderboard">
								<button
									type="button"
									className={`hub-ranking-tab${leaderboardGame === "overall" ? " hub-ranking-tab--active" : ""}`}
									onClick={() => setLeaderboardGame("overall")}
								>
									Total
								</button>
								{RANKED_GAMES.map((g) => (
									<button
										key={g.id}
										type="button"
										className={`hub-ranking-tab${leaderboardGame === g.id ? " hub-ranking-tab--active" : ""}`}
										onClick={() => setLeaderboardGame(g.id)}
									>
										{g.label}
									</button>
								))}
							</nav>

							<button
								type="button"
								className="hub-ranking-scope-toggle"
								onClick={toggleLeaderboardScope}
								aria-label={`Currently showing ${leaderboardScope} rankings. Click to switch to ${
									leaderboardScope === "global" ? "friends" : "global"
								}.`}
							>
								<span className="hub-ranking-scope-toggle__icon" aria-hidden="true">
									⇄
								</span>
								{leaderboardScope === "global" ? "Global" : "Friends"}
							</button>
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
				<HubModal title="Achievements" onClose={() => setActiveModal(null)} variant="wide">
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}
					{achievements ? (
						<div className="hub-modal__achievements">
							<div className="hub-modal__achievements-toolbar">
								<p className="hub-modal__achievement-count">
									{unlockedAchievementCount}/{totalAchievementCount} unlocked
								</p>
								<div className="hub-modal__achievement-filters" aria-label="Achievement filter">
									{ACHIEVEMENT_FILTER_OPTIONS.map((option) => (
										<button
											key={option.value}
											type="button"
											className={
												achievementFilter === option.value
													? "hub-modal__achievement-filter hub-modal__achievement-filter--active"
													: "hub-modal__achievement-filter"
											}
											onClick={() => setAchievementFilter(option.value)}
										>
											{option.label}
										</button>
									))}
								</div>
							</div>
							{filteredAchievements.length > 0 ? (
								<div className="hub-modal__list hub-modal__list--achievements">
									{filteredAchievements.map((achievement) => {
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
								<p className="hub-modal__empty">No achievements match this filter.</p>
							)}
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
						<div className="hub-modal__current-tag">
							{currentTag ? (
								<span className="hub-modal__tag-chip hub-modal__tag-chip--selected">
									<span className="hub-modal__tag-chip-emoji">{currentTag.emoji}</span>
									<span className="hub-modal__tag-chip-label">{currentTag.label}</span>
								</span>
							) : (
								<span className="hub-panel__muted">No dojo tag selected.</span>
							)}
							<small>Choose and unlock dojo tags from Customisation.</small>
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

			{activeModal === "replays" ? (
				<HubModal
					title="Match Replays"
					variant="wide"
					onClose={() => {
						setActiveModal(null);
						setSelectedReplay(null);
						setSelectedReplayFrame(0);
						setReplayFrameProgress(0);
						setIsReplayPlaying(false);
						setIsReplayExpanded(false);
					}}
				>
					<p className="hub-modal__replay-notice">
						Replays are unavailable while power-ups are enabled.
					</p>
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}
					<div className="hub-modal__replays">
						<div className="hub-modal__replay-list">
							{replaysLoading ? (
								<p>Loading…</p>
							) : (
								<>
									<div className="hub-modal__replay-tabs" role="tablist" aria-label="Replay categories">
										<button
											type="button"
											role="tab"
											aria-selected={replayTab === "match"}
											className={`hub-modal__replay-tab${replayTab === "match" ? " hub-modal__replay-tab--active" : ""}`}
											onClick={() => setReplayTab("match")}
										>
											Match replays
										</button>
										<button
											type="button"
											role="tab"
											aria-selected={replayTab === "saved"}
											className={`hub-modal__replay-tab${replayTab === "saved" ? " hub-modal__replay-tab--active" : ""}`}
											onClick={() => setReplayTab("saved")}
										>
											My replays
										</button>
									</div>
									<ReplayListSection
										title={replayTab === "match" ? "Match replays" : "My replays"}
										replays={replayTab === "match" ? matchReplays : savedReplays}
										selectedReplay={selectedReplay}
										replayActionLoading={replayActionLoading}
										onLoadReplay={(matchId) => void handleLoadReplay(matchId)}
										onToggleSaved={(matchId, nextSavedState) =>
											void handleSaveReplay(matchId, nextSavedState)
										}
										emptyMessage={
											replayTab === "match"
												? "No temporary match replays available."
												: "You have no saved replays yet."
										}
									/>
								</>
							)}
						</div>

						<div className="hub-modal__replay-viewer">
							<h3>Replay viewer</h3>
							{selectedReplay ? (
								<ReplayViewer
									replay={selectedReplay}
									selectedReplayFrame={selectedReplayFrame}
									replayFrameProgress={replayFrameProgress}
									isReplayPlaying={isReplayPlaying}
									onSelectedReplayFrameChange={setSelectedReplayFrame}
									onReplayFrameProgressChange={setReplayFrameProgress}
									onIsReplayPlayingChange={setIsReplayPlaying}
									onExpand={() => setIsReplayExpanded(true)}
								/>
							) : (
								<div className="hub-modal__replay-empty">
									<img
										className="hub-modal__replay-empty-logo"
										src="/assets/logoShellSmash.png"
										alt="Shell Smash"
									/>
									<p className="hub-panel__muted">
										Select a replay to inspect its timeline.
									</p>
								</div>
							)}
						</div>
					</div>
				</HubModal>
			) : null}

			{activeModal === "replays" && isReplayExpanded && selectedReplay ? (
				<HubModal
					title={`${getReplayGameLabel(selectedReplay.gameId)} Replay`}
					variant="wide"
					onClose={() => setIsReplayExpanded(false)}
				>
					<div className="hub-modal__replay-viewer hub-modal__replay-viewer--expanded">
						<ReplayViewer
							replay={selectedReplay}
							selectedReplayFrame={selectedReplayFrame}
							replayFrameProgress={replayFrameProgress}
							isReplayPlaying={isReplayPlaying}
							onSelectedReplayFrameChange={setSelectedReplayFrame}
							onReplayFrameProgressChange={setReplayFrameProgress}
							onIsReplayPlayingChange={setIsReplayPlaying}
							expanded
						/>
					</div>
				</HubModal>
			) : null}

			{activeModal === "social" ? (
				<HubModal title="Social" onClose={() => { setActiveModal(null); setFriendUsername(""); }} variant="wide">
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}

					{player?.username ? (
						<div className="hub-modal__social-code">
							<span>
								Your friend code: <code>{buildFriendCode(player.username)}</code>
							</span>
							<button
								className="hub-modal__save-button"
								type="button"
								onClick={() => void handleCopyFriendCode()}
							>
								Copy
							</button>
						</div>
					) : null}

					<div className="hub-modal__social-add">
						<input
							className="hub-modal__field-input"
							type="text"
							placeholder="Username"
							maxLength={32}
							value={friendUsername}
							onChange={(e) => setFriendUsername(e.target.value)}
							onKeyDown={(e) => {
								// Ignore Enter while an IME composition is active (Bug Audit L4).
								if (e.key === "Enter" && !e.nativeEvent.isComposing)
									void handleSendFriendRequest();
							}}
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
							<section className="hub-modal__social-section hub-modal__chat-section">
								<div className="hub-modal__chat-header">
									<h3>Messages</h3>
									{!activeConversationId ? (
										<button
											type="button"
											className="hub-modal__save-button"
											onClick={() => setIsNewGroupOpen((prev) => !prev)}
										>
											{isNewGroupOpen ? "Cancel" : "New group"}
										</button>
									) : null}
								</div>

								{isNewGroupOpen && !activeConversationId ? (
									<div className="hub-modal__chat-new-group">
										<input
											className="hub-modal__field-input"
											type="text"
											placeholder="Group name"
											maxLength={60}
											value={newGroupName}
											onChange={(e) => setNewGroupName(e.target.value)}
										/>
										<p className="hub-modal__chat-new-group-hint">Add friends:</p>
										<ul className="hub-modal__social-list">
											{(friends ?? []).map((friend) => (
												<li key={friend.userId} className="hub-modal__chat-member-row">
													<label>
														<input
															type="checkbox"
															checked={newGroupMemberIds.has(friend.userId)}
															onChange={() => handleToggleNewGroupMember(friend.userId)}
														/>
														{friend.turtleName ?? friend.username}
													</label>
												</li>
											))}
										</ul>
										<button
											type="button"
											className="hub-modal__save-button"
											disabled={
												chatActionLoading ||
												!newGroupName.trim() ||
												newGroupMemberIds.size === 0
											}
											onClick={() => void handleCreateGroup()}
										>
											Create group
										</button>
									</div>
								) : null}

								{activeConversationId ? (
									<div className="hub-modal__chat-thread">
										<div className="hub-modal__chat-thread-header">
											<button type="button" onClick={handleCloseConversation}>
												← Back
											</button>
											<span className="hub-modal__chat-thread-title">
												{conversationTitle(
													conversations?.find((c) => c.id === activeConversationId) ?? {
														name: null,
														type: "dm",
													},
												)}
											</span>
											{isActiveGroup ? (
												<div className="hub-modal__chat-thread-actions">
													<button
														type="button"
														className="hub-modal__chat-members-toggle"
														onClick={handleToggleMembers}
													>
														{groupMembers !== null
															? "Hide members"
															: "Members"}
													</button>
													{isOwnerOfActiveGroup ? (
														<>
															<button
																type="button"
																className="hub-modal__chat-members-toggle"
																disabled={groupActionLoading}
																onClick={() =>
																	setGroupRenameDraft(
																		activeConversation?.name ?? "",
																	)
																}
															>
																Rename
															</button>
															<button
																type="button"
																className="hub-modal__chat-members-toggle"
																disabled={chatActionLoading}
																onClick={() =>
																	void handleLeaveGroup(activeConversationId)
																}
																title="Leave the group; ownership passes to the longest-standing member"
															>
																Leave group
															</button>
															<button
																type="button"
																className="hub-modal__social-block-btn"
																disabled={groupActionLoading}
																onClick={() => void handleDeleteGroup()}
															>
																Delete group
															</button>
														</>
													) : (
														<button
															type="button"
															className="hub-modal__social-block-btn"
															disabled={chatActionLoading}
															onClick={() =>
																void handleLeaveGroup(activeConversationId)
															}
														>
															Leave group
														</button>
													)}
												</div>
											) : null}
										</div>

										{isActiveGroup && groupRenameDraft !== null ? (
											<form
												className="hub-modal__chat-rename"
												onSubmit={(e) => {
													e.preventDefault();
													void handleRenameGroup();
												}}
											>
												<input
													type="text"
													value={groupRenameDraft}
													maxLength={60}
													autoFocus
													onChange={(e) => setGroupRenameDraft(e.target.value)}
													placeholder="Group name"
												/>
												<button
													type="submit"
													disabled={
														groupActionLoading || !groupRenameDraft.trim()
													}
												>
													Save
												</button>
												<button
													type="button"
													onClick={() => setGroupRenameDraft(null)}
												>
													Cancel
												</button>
											</form>
										) : null}

										{isActiveGroup && groupMembers !== null ? (
											<div className="hub-modal__chat-members">
												{groupMembersLoading ? (
													<p>Loading members…</p>
												) : (
													<ul className="hub-modal__chat-members-list">
														{groupMembers.map((member) => (
															<li
																key={member.userId}
																className="hub-modal__chat-member"
															>
																<span
																	className={
																		member.isOnline
																			? "hub-modal__presence-dot hub-modal__presence-dot--online"
																			: "hub-modal__presence-dot"
																	}
																/>
																<span className="hub-modal__chat-member-name">
																	{member.turtleName ?? member.username}
																	{member.isOwner ? " (owner)" : ""}
																</span>
																{isOwnerOfActiveGroup && !member.isOwner ? (
																	<button
																		type="button"
																		className="hub-modal__social-block-btn"
																		disabled={groupActionLoading}
																		onClick={() =>
																			void handleKickMember(member.userId)
																		}
																	>
																		Remove
																	</button>
																) : null}
															</li>
														))}
													</ul>
												)}

												<button
													type="button"
													className="hub-modal__chat-members-toggle"
													disabled={groupActionLoading}
													onClick={() => setIsAddMemberOpen((v) => !v)}
												>
													{isAddMemberOpen ? "Cancel" : "Add friend"}
												</button>

												{isAddMemberOpen ? (
													addableFriends.length === 0 ? (
														<p className="hub-modal__chat-members-empty">
															All your friends are already in this group.
														</p>
													) : (
														<ul className="hub-modal__chat-members-add-list">
															{addableFriends.map((friend) => (
																<li key={friend.userId}>
																	<button
																		type="button"
																		disabled={groupActionLoading}
																		onClick={() =>
																			void handleAddMemberToGroup(
																				friend.userId,
																			)
																		}
																	>
																		{friend.turtleName ?? friend.username}
																	</button>
																</li>
															))}
														</ul>
													)
												) : null}
											</div>
										) : null}

										{chatThreadLoading ? (
											<p>Loading…</p>
										) : (
											<ul
												className="hub-modal__chat-message-list"
												ref={chatListRef}
											>
												{chatHasMoreOlder ? (
													<li className="hub-modal__chat-load-older">
														<button
															type="button"
															disabled={chatLoadingOlder}
															onClick={() =>
																void handleLoadOlderMessages()
															}
														>
															{chatLoadingOlder
																? "Loading…"
																: "Load older messages"}
														</button>
													</li>
												) : null}
												{chatMessages.map((message) => {
													const gif =
														message.type === "gif"
															? parseGifMetadata(message.metadata)
															: null;
													return (
														<li
															key={message.id}
															className={
																message.type === "system"
																	? "hub-modal__chat-message hub-modal__chat-message--system"
																	: "hub-modal__chat-message"
															}
														>
															{message.type === "system" ? (
																<span>{message.body}</span>
															) : message.type === "gif" && gif ? (
																<>
																	<span className="hub-modal__chat-message-sender">
																		{message.senderUsername}
																	</span>
																	<img
																		className="hub-modal__chat-gif-image"
																		src={gif.url}
																		alt={message.body}
																		width={gif.width}
																		height={gif.height}
																		loading="lazy"
																	/>
																	<span className="hub-modal__chat-message-time">
																		{formatRelativeTime(message.createdAt)}
																	</span>
																</>
															) : (
																<>
																	<span className="hub-modal__chat-message-sender">
																		{message.senderUsername}
																	</span>
																	<span className="hub-modal__chat-message-body">
																		{message.body}
																	</span>
																	<span className="hub-modal__chat-message-time">
																		{formatRelativeTime(message.createdAt)}
																	</span>
																</>
															)}
														</li>
													);
												})}
											</ul>
										)}

										{isGifPickerOpen ? (
											<div className="hub-modal__chat-gif-picker">
												<input
													className="hub-modal__field-input"
													type="text"
													placeholder="Search gifs…"
													maxLength={200}
													value={gifSearchQuery}
													onChange={(e) => handleGifSearchChange(e.target.value)}
													autoFocus
												/>
												{gifSearchLoading ? (
													<p className="hub-modal__chat-gif-status">Searching…</p>
												) : gifResults.length > 0 ? (
													<ul className="hub-modal__chat-gif-grid">
														{gifResults.map((gif) => (
															<li key={gif.slug}>
																<button
																	type="button"
																	className="hub-modal__chat-gif-thumb"
																	onClick={() => handleSendGif(gif)}
																>
																	<img
																		src={gif.previewUrl}
																		alt={gif.title}
																		loading="lazy"
																	/>
																</button>
															</li>
														))}
													</ul>
												) : gifSearchQuery.trim().length >= GIF_SEARCH_MIN_LENGTH ? (
													<p className="hub-modal__chat-gif-status">No gifs found.</p>
												) : (
													<p className="hub-modal__chat-gif-status">
														Type to search for gifs.
													</p>
												)}
											</div>
										) : null}

										<div className="hub-modal__chat-composer">
											<input
												className="hub-modal__field-input"
												type="text"
												placeholder="Message…"
												maxLength={2000}
												value={chatMessageDraft}
												onChange={(e) => setChatMessageDraft(e.target.value)}
												onKeyDown={(e) => {
													// Ignore Enter while an IME composition is active (Bug Audit L4).
													if (e.key === "Enter" && !e.nativeEvent.isComposing)
														handleSendChatMessage();
												}}
											/>
											<button
												type="button"
												className={
													isGifPickerOpen
														? "hub-modal__chat-gif-toggle hub-modal__chat-gif-toggle--active"
														: "hub-modal__chat-gif-toggle"
												}
												onClick={handleToggleGifPicker}
												aria-pressed={isGifPickerOpen}
											>
												GIF
											</button>
											<button
												type="button"
												className="hub-modal__save-button"
												disabled={!chatMessageDraft.trim()}
												onClick={handleSendChatMessage}
											>
												Send
											</button>
										</div>
									</div>
								) : (
									<ul className="hub-modal__social-list">
										{conversations && conversations.length > 0 ? (
											conversations.map((conversation) => (
												<li key={conversation.id} className="hub-modal__social-row">
													<button
														type="button"
														className="hub-modal__chat-conversation-btn"
														onClick={() => void handleOpenConversation(conversation.id)}
													>
														<span className="hub-modal__social-name">
															{conversationTitle(conversation)}
															{unreadConversationIds.has(conversation.id) ? (
																<span
																	className="hub-modal__chat-unread-dot"
																	role="img"
																	aria-label="Unread"
																/>
															) : null}
														</span>
														<small className="hub-modal__chat-preview">
															{conversation.lastMessagePreview ?? "No messages yet"}
														</small>
													</button>
												</li>
											))
										) : (
											<p>No conversations yet — message a friend to get started.</p>
										)}
									</ul>
								)}
							</section>

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
													{blockConfirmUserId === req.userId ? (
														<>
															<span className="hub-modal__social-confirm-label">
																Block {req.turtleName ?? req.username}?
															</span>
															<button
																type="button"
																ref={blockConfirmButtonRef}
																className="hub-modal__social-confirm-btn"
																onClick={() => void handleBlockUser(req)}
															>
																Confirm
															</button>
															<button
																type="button"
																onClick={() => setBlockConfirmUserId(null)}
															>
																Cancel
															</button>
														</>
													) : (
														<>
															<button type="button" onClick={() => void handleAcceptRequest(req)}>Accept</button>
															<button type="button" onClick={() => void handleDeclineRequest(req)}>Decline</button>
															<button
																type="button"
																className="hub-modal__social-block-btn"
																onClick={() => setBlockConfirmUserId(req.userId)}
															>
																Block
															</button>
															<button
																type="button"
																className="hub-modal__social-block-btn"
																onClick={() =>
																	setReportTarget({
																		userId: req.userId,
																		username: req.username,
																		turtleName: req.turtleName,
																	})
																}
															>
																Report
															</button>
														</>
													)}
												</div>
											</li>
										))}
									</ul>
								</section>
							) : null}

							{outgoingRequests && outgoingRequests.length > 0 ? (
								<section className="hub-modal__social-section">
									<h3>Outgoing requests</h3>
									<ul className="hub-modal__social-list">
										{outgoingRequests.map((req) => (
											<li key={req.userId} className="hub-modal__social-row">
												<span className="hub-modal__social-name">
													{req.turtleName ?? req.username}
													<small> @{req.username}</small>
												</span>
												<div className="hub-modal__social-actions">
													<button
														type="button"
														onClick={() => void handleCancelOutgoingRequest(req)}
													>
														Cancel
													</button>
												</div>
											</li>
										))}
									</ul>
								</section>
							) : null}

							{/*
							 * No list virtualisation here (e.g. react-window): this is a niche
							 * 4-player mini-game hub, not a large social network — friend counts
							 * are expected to stay in the tens, not hundreds. Suggestions are
							 * already capped server-side (SUGGESTIONS_LIMIT = 20), and pending/
							 * outgoing requests are inherently self-limiting. Revisit if this
							 * list is ever observed to exceed ~50 rows in practice; a new dep
							 * would also need `npm install` on the user's machine first.
							 */}
							<section className="hub-modal__social-section">
								<h3>
									Friends
									{friendStats.total > 0 ? (
										<span className="hub-modal__social-count">
											{friendStats.online}/{friendStats.total} online
										</span>
									) : null}
								</h3>
								{friends && friends.length > 0 ? (
									<input
										className="hub-modal__field-input hub-modal__social-search"
										type="text"
										placeholder="Search friends…"
										value={friendSearchQuery}
										onChange={(e) => setFriendSearchQuery(e.target.value)}
										aria-label="Search friends"
									/>
								) : null}
								{friendGroups && filteredFriends && filteredFriends.length > 0 ? (
									<>
										{friendGroups.inGame.length > 0 ? (
											<div className="hub-modal__social-group">
												<h4 className="hub-modal__social-group-label">In game</h4>
												<ul className="hub-modal__social-list">
													{friendGroups.inGame.map(friendRow)}
												</ul>
											</div>
										) : null}
										{friendGroups.online.length > 0 ? (
											<div className="hub-modal__social-group">
												<h4 className="hub-modal__social-group-label">Online</h4>
												<ul className="hub-modal__social-list">
													{friendGroups.online.map(friendRow)}
												</ul>
											</div>
										) : null}
										{friendGroups.offline.length > 0 ? (
											<div className="hub-modal__social-group">
												<h4 className="hub-modal__social-group-label">Offline</h4>
												<ul className="hub-modal__social-list">
													{friendGroups.offline.map(friendRow)}
												</ul>
											</div>
										) : null}
									</>
								) : friends && friends.length > 0 ? (
									<p className="hub-panel__muted">No friends match your search.</p>
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

								{/* Report panel — shown after clicking Report on a friend or pending request */}
								{reportTarget && (
									<div className="hub-lobby-picker">
										<p>
											Report <strong>{reportTarget.turtleName ?? reportTarget.username}</strong>?
											This will also block them.
										</p>
										<select
											ref={reportCategorySelectRef}
											className="hub-leaderboard-select"
											value={reportCategory}
											onChange={(e) =>
												setReportCategory(e.target.value as ReportCategory)
											}
											aria-label="Report reason"
										>
											{REPORT_CATEGORIES.map((c) => (
												<option key={c.id} value={c.id}>
													{c.label}
												</option>
											))}
										</select>
										<textarea
											className="hub-modal__field-input"
											placeholder="Additional details (optional)"
											maxLength={500}
											value={reportMessage}
											onChange={(e) => setReportMessage(e.target.value)}
										/>
										<div className="hub-lobby-picker__actions">
											<button
												type="button"
												className="hub-lobby-picker__confirm"
												disabled={reportLoading}
												onClick={() => void handleSubmitReport()}
											>
												{reportLoading ? "Submitting…" : "Submit report"}
											</button>
											<button
												type="button"
												className="hub-lobby-picker__cancel"
												disabled={reportLoading}
												onClick={() => {
													setReportTarget(null);
													setReportMessage("");
												}}
											>
												Cancel
											</button>
										</div>
									</div>
								)}
							</section>

							{suggestions && suggestions.length > 0 ? (
								<section className="hub-modal__social-section">
									<h3>People you may know</h3>
									<ul className="hub-modal__social-list">
										{suggestions.map((suggestion) => (
											<li
												key={suggestion.userId}
												className="hub-modal__social-row"
											>
												<span className="hub-modal__social-name">
													{suggestion.turtleName ?? suggestion.username}
													<small> @{suggestion.username}</small>
												</span>
												<div className="hub-modal__social-actions">
													<button
														type="button"
														onClick={() => void handleAddSuggestion(suggestion)}
													>
														Add
													</button>
												</div>
											</li>
										))}
									</ul>
								</section>
							) : null}

							{blockedUsers && blockedUsers.length > 0 ? (
								<section className="hub-modal__social-section">
									<h3>Blocked users</h3>
									<ul className="hub-modal__social-list">
										{blockedUsers.map((blocked) => (
											<li
												key={blocked.userId}
												className="hub-modal__social-row"
											>
												<span className="hub-modal__social-name">
													{blocked.turtleName ?? blocked.username}
													<small> @{blocked.username}</small>
												</span>
												<div className="hub-modal__social-actions">
													<button
														type="button"
														onClick={() => void handleUnblockUser(blocked)}
													>
														Unblock
													</button>
												</div>
											</li>
										))}
									</ul>
								</section>
							) : null}
						</>
					)}
				</HubModal>
			) : null}

			{activeModal === "customization" ? (
				<HubModal
					title="Customisation"
					onClose={() => setActiveModal(null)}
					variant="wide"
				>
					{modalError ? <p className="hub-modal__error">{modalError}</p> : null}
					{cosmetics ? (
						<div className="hub-modal__cosmetics">
							<div className="hub-cards__store">
								<div className="hub-cards__store-info">
									<strong>Collection</strong>
									<span>
										{cosmeticCollectionProgress.owned} / {cosmeticCollectionProgress.total} items
									</span>
								</div>
								<div className="hub-cards__store-coins">
									<span aria-hidden="true">⬡</span> {player?.coins ?? 0} coins
								</div>
							</div>

							<div className="hub-modal__cosmetic-topbar">
								<nav className="hub-modal__cosmetic-tabs" aria-label="Customisation categories">
									{COSMETIC_TABS.map((tab) => (
										<button
											key={tab.id}
											type="button"
											className={`hub-modal__cosmetic-tab${
												activeCosmeticTab === tab.id
													? " hub-modal__cosmetic-tab--active"
													: ""
											}${tab.disabled ? " hub-modal__cosmetic-tab--disabled" : ""}`}
											disabled={tab.disabled}
											onClick={() => setActiveCosmeticTab(tab.id)}
										>
											{tab.title}
										</button>
									))}
								</nav>
							</div>

							{activeCosmeticTab === "all" || activeCosmeticTab === "shell_skin" ? (
								<section className="hub-modal__cosmetic-category hub-modal__cosmetic-category--shells">
									<header className="hub-modal__cosmetic-category-header">
										<h3>Shells</h3>
										<span className="hub-modal__cosmetic-category-progress">
											{cosmeticCategoryProgress.get("shell_skin")?.owned ?? 0} /{" "}
											{cosmeticCategoryProgress.get("shell_skin")?.total ?? 0}
										</span>
									</header>
									<div className="hub-modal__shell-grid">
										{(cosmeticGroups.get("shell_skin") ?? []).map((cosmetic) => {
											const hasImage = COSMETIC_PREVIEWS[cosmetic.id] !== undefined;
											return (
												<button
													key={cosmetic.id}
													type="button"
													className={`hub-modal__shell-card${
														cosmetic.equipped ? " hub-modal__shell-card--equipped" : ""
													}`}
													style={getCosmeticPreviewStyle(cosmetic)}
													title={getCosmeticDisplayDescription(cosmetic)}
													onClick={() => setSelectedShellCosmetic(cosmetic)}
												>
													<span className="hub-modal__shell-frame" aria-hidden="true">
														{hasImage ? (
															<span className="hub-modal__shell-image" />
														) : (
															<span className="hub-modal__shell-placeholder">?</span>
														)}
													</span>
													<strong>{getCosmeticDisplayName(cosmetic)}</strong>
													{cosmetic.equipped ? <small>Equipped</small> : null}
												</button>
											);
										})}
										{SHELL_PLACEHOLDERS.map((placeholderId) => (
											<button
												key={placeholderId}
												type="button"
												className="hub-modal__shell-card hub-modal__shell-card--mystery"
												disabled
											>
												<span className="hub-modal__shell-frame" aria-hidden="true">
													<span className="hub-modal__shell-placeholder">?</span>
												</span>
												<strong>?</strong>
											</button>
										))}
									</div>
								</section>
							) : null}

							{activeCosmeticTab === "all" || activeCosmeticTab === "hub_background" ? (
								<section className="hub-modal__cosmetic-category">
									<header className="hub-modal__cosmetic-category-header">
										<h3>Backgrounds</h3>
										<span className="hub-modal__cosmetic-category-progress">
											{cosmeticCategoryProgress.get("hub_background")?.owned ?? 0} /{" "}
											{cosmeticCategoryProgress.get("hub_background")?.total ?? 0}
										</span>
									</header>
									<div className="hub-modal__list hub-modal__cosmetic-grid hub-modal__cosmetic-grid--backgrounds">
										{(cosmeticGroups.get("hub_background") ?? []).map((cosmetic) => {
											const alters = backgroundAlters.get(cosmetic.id) ?? [];
											return (
												<article key={cosmetic.id}>
													<div
														className="hub-modal__cosmetic-preview hub-modal__cosmetic-preview--hub_background has-image"
														style={getCosmeticPreviewStyle(cosmetic)}
														aria-hidden="true"
													/>
													<strong>{getCosmeticDisplayName(cosmetic)}</strong>
													<p>{getCosmeticDisplayDescription(cosmetic)}</p>
													<button
														type="button"
														disabled={isCosmeticActionDisabled(cosmetic)}
														onClick={() => void handleCosmeticAction(cosmetic)}
													>
														{getCosmeticActionLabel(cosmetic)}
													</button>
													{alters.length > 0 ? (
														<div className="hub-modal__cosmetic-alters">
															<span className="hub-modal__cosmetic-alters-label">Alter art</span>
															{alters.map((alter) => (
																<div
																	key={alter.id}
																	className={`hub-modal__cosmetic-alter${
																		alter.equipped
																			? " hub-modal__cosmetic-alter--active"
																			: ""
																	}${!alter.owned ? " hub-modal__cosmetic-alter--locked" : ""}`}
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
																				alter.equipped ? " hub-modal__cosmetic-toggle--on" : ""
																			}`}
																			disabled={!alter.owned}
																			onClick={() =>
																				void handleBackgroundAlterAction(cosmetic, alter)
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
																			alter.lockedReason === "achievement-locked"
																		}
																		onClick={() => void handleCosmeticAction(alter)}
																	>
																		{alter.owned ? "Purchased" : `Buy alter · ${alter.price} coins`}
																	</button>
																</div>
															))}
														</div>
													) : null}
												</article>
											);
										})}
									</div>
								</section>
							) : null}

							{activeCosmeticTab === "all" || activeCosmeticTab === "trail_effect" ? (
								<section className="hub-modal__cosmetic-category">
									<header className="hub-modal__cosmetic-category-header">
										<h3>Trails</h3>
										<span className="hub-modal__cosmetic-category-progress">
											{cosmeticCategoryProgress.get("trail_effect")?.owned ?? 0} /{" "}
											{cosmeticCategoryProgress.get("trail_effect")?.total ?? 0}
										</span>
									</header>
									<div className="hub-modal__trail-effects">
										{(cosmeticGroups.get("trail_effect") ?? []).map((cosmetic) => (
											<article
												key={cosmetic.id}
												className={`hub-modal__trail-card hub-modal__trail-card--${cosmetic.id}${
													cosmetic.equipped ? " hub-modal__trail-card--equipped" : ""
												}`}
												style={getCosmeticPreviewStyle(cosmetic)}
											>
												<span className="hub-modal__trail-preview" aria-hidden="true">
													<span className="hub-modal__trail-line" />
												</span>
												<span className="hub-modal__trail-copy">
													<strong>{getCosmeticDisplayName(cosmetic)}</strong>
													<small>{getCosmeticDisplayDescription(cosmetic)}</small>
												</span>
												<button
													type="button"
													disabled={isCosmeticActionDisabled(cosmetic)}
													onClick={() => void handleCosmeticAction(cosmetic)}
												>
													{getCosmeticActionLabel(cosmetic)}
												</button>
											</article>
										))}
									</div>
								</section>
							) : null}

							{activeCosmeticTab === "all" || activeCosmeticTab === "dojo_tag" ? (
								<section className="hub-modal__cosmetic-category">
									<header className="hub-modal__cosmetic-category-header">
										<h3>Dojo Tags</h3>
										<span className="hub-modal__cosmetic-category-progress">
											{cosmeticCategoryProgress.get("dojo_tag")?.owned ?? 0} /{" "}
											{cosmeticCategoryProgress.get("dojo_tag")?.total ?? 0}
										</span>
									</header>
									<div className="hub-modal__dojo-tags">
										{(cosmeticGroups.get("dojo_tag") ?? []).map((cosmetic) => (
											<article
												key={cosmetic.id}
												className={`hub-modal__dojo-tag-card${
													cosmetic.equipped ? " hub-modal__dojo-tag-card--equipped" : ""
												}`}
												style={getCosmeticPreviewStyle(cosmetic)}
											>
												<span className="hub-modal__dojo-tag-icon" aria-hidden="true">
													{cosmetic.tagEmoji}
												</span>
												<span className="hub-modal__dojo-tag-copy">
													<strong>{getCosmeticDisplayName(cosmetic)}</strong>
													<small>{getCosmeticDisplayDescription(cosmetic)}</small>
												</span>
												<button
													type="button"
													disabled={isCosmeticActionDisabled(cosmetic)}
													onClick={() => void handleCosmeticAction(cosmetic)}
												>
													{getCosmeticActionLabel(cosmetic)}
												</button>
											</article>
										))}
									</div>
								</section>
							) : null}

							{selectedShellCosmetic ? (
								<div className="hub-modal__shell-detail" role="dialog" aria-modal="true">
									<button
										type="button"
										className="hub-modal__shell-detail-backdrop"
										aria-label="Close shell details"
										onClick={() => setSelectedShellCosmetic(null)}
									/>
									<article className="hub-modal__shell-detail-card">
										<button
											type="button"
											className="hub-modal__shell-detail-close"
											onClick={() => setSelectedShellCosmetic(null)}
										>
											Close
										</button>
										<div
											className="hub-modal__shell-detail-preview"
											style={getCosmeticPreviewStyle(selectedShellCosmetic)}
											aria-hidden="true"
										>
											{COSMETIC_PREVIEWS[selectedShellCosmetic.id] ? (
												<span className="hub-modal__shell-image" />
											) : (
												<span className="hub-modal__shell-placeholder">?</span>
											)}
										</div>
										<strong>{getCosmeticDisplayName(selectedShellCosmetic)}</strong>
										<p>{getCosmeticDisplayDescription(selectedShellCosmetic)}</p>
										<button
											type="button"
											disabled={isCosmeticActionDisabled(selectedShellCosmetic)}
											onClick={() => void handleCosmeticAction(selectedShellCosmetic)}
										>
											{getCosmeticActionLabel(selectedShellCosmetic)}
										</button>
									</article>
								</div>
							) : null}
						</div>
					) : (
						<p>Loading customisation...</p>
					)}
				</HubModal>
			) : null}

			{activeModal === "cards" ? (
				<HubModal title="Shell Cards" onClose={() => setActiveModal(null)} variant="wide">
					<ShellCardsModal
						coins={player?.coins ?? 0}
						onCoinsChange={(coins) =>
							setPlayer((prev) => (prev ? { ...prev, coins } : prev))
						}
					/>
				</HubModal>
			) : null}

			{activeModal === "casino" ? (
				<HubModal title="Fortune Wheel" onClose={() => setActiveModal(null)}>
					<FortuneWheelModal
						coins={player?.coins ?? 0}
						onCoinsChange={(coins) =>
							setPlayer((prev) => (prev ? { ...prev, coins } : prev))
						}
					/>
				</HubModal>
			) : null}

			{activeModal === "flip" ? (
				<HubModal title="Shell Flip" onClose={() => setActiveModal(null)}>
					<ShellFlipModal
						coins={player?.coins ?? 0}
						onCoinsChange={(coins) =>
							setPlayer((prev) => (prev ? { ...prev, coins } : prev))
						}
					/>
				</HubModal>
			) : null}

			{activeModal === "monte" ? (
				<HubModal
					title="Three-Shell Monte"
					onClose={() => setActiveModal(null)}
				>
					<ThreeShellMonteModal
						coins={player?.coins ?? 0}
						onCoinsChange={(coins) =>
							setPlayer((prev) => (prev ? { ...prev, coins } : prev))
						}
					/>
				</HubModal>
			) : null}

			{activeModal === "slots" ? (
				<HubModal title="Shrine Slots" onClose={() => setActiveModal(null)}>
					<ShrineSlotsModal
						coins={player?.coins ?? 0}
						onCoinsChange={(coins) =>
							setPlayer((prev) => (prev ? { ...prev, coins } : prev))
						}
					/>
				</HubModal>
			) : null}

			{activeModal === "dice" ? (
				<HubModal title="Koi Dice" onClose={() => setActiveModal(null)}>
					<KoiDiceModal
						coins={player?.coins ?? 0}
						onCoinsChange={(coins) =>
							setPlayer((prev) => (prev ? { ...prev, coins } : prev))
						}
					/>
				</HubModal>
			) : null}

			{activeModal === "drop" ? (
				<HubModal title="Shell Drop" onClose={() => setActiveModal(null)}>
					<ShellDropModal
						coins={player?.coins ?? 0}
						onCoinsChange={(coins) =>
							setPlayer((prev) => (prev ? { ...prev, coins } : prev))
						}
					/>
				</HubModal>
			) : null}
		</main>
	);
}

/** Selector for elements that can receive keyboard focus, used by the modal's focus trap. */
const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function HubModal({
	title,
	onClose,
	children,
	headerAddon,
	variant = "default",
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	headerAddon?: ReactNode;
	variant?: "default" | "wide";
}): JSX.Element {
	const titleId = useId();
	const panelRef = useRef<HTMLElement>(null);

	// Focus management: move focus into the modal on open, trap Tab within it,
	// close on Escape, and restore focus to whatever triggered the modal on close.
	useEffect(() => {
		const previouslyFocused = document.activeElement as HTMLElement | null;
		const panel = panelRef.current;
		const firstFocusable = panel?.querySelector<HTMLElement>(
			FOCUSABLE_SELECTOR,
		);
		(firstFocusable ?? panel)?.focus();

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key !== "Tab" || !panel) return;

			const focusable = Array.from(
				panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			);
			if (focusable.length === 0) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			previouslyFocused?.focus();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run per modal open, not per onClose identity change
	}, []);

	return (
		<div className="hub-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
			<button
				className="hub-modal__backdrop"
				type="button"
				aria-label="Close modal"
				onClick={onClose}
			/>
			<section
				className={`hub-modal__panel${variant === "wide" ? " hub-modal__panel--wide" : ""}`}
				ref={panelRef}
				tabIndex={-1}
			>
				<header>
					<div className="hub-modal__title-row">
						<h2 id={titleId}>{title}</h2>
						{headerAddon}
					</div>
					<button type="button" onClick={onClose}>
						Close
					</button>
				</header>
				<div className="hub-modal__body">{children}</div>
			</section>
		</div>
	);
}

function ReplayListSection({
	title,
	replays,
	selectedReplay,
	replayActionLoading,
	onLoadReplay,
	onToggleSaved,
	emptyMessage,
}: {
	title: string;
	replays: ReplaySummary[];
	selectedReplay: ReplayDetail | null;
	replayActionLoading: string | null;
	onLoadReplay: (matchId: string) => void;
	onToggleSaved: (matchId: string, nextSavedState: boolean) => void;
	emptyMessage: string;
}): JSX.Element {
	return (
		<section className="hub-modal__replay-section">
			<h3>{title}</h3>
			{replays.length > 0 ? (
				<div className="hub-modal__replay-items-scroll">
					<ul className="hub-modal__replay-items">
						{replays.map((replay) => (
							<li key={replay.matchId} className="hub-modal__replay-item">
								<div className="hub-modal__replay-copy">
									<strong>{getReplayGameLabel(replay.gameId)}</strong>
									<small>{replay.playerNames.join(" vs ")}</small>
									<small>{formatReplayDate(replay.finishedAt)}</small>
								</div>
								<div className="hub-modal__replay-actions">
									<button
										type="button"
										disabled={replayActionLoading === replay.matchId}
										onClick={() => onLoadReplay(replay.matchId)}
									>
										{selectedReplay?.matchId === replay.matchId ? "Viewing" : "View"}
									</button>
									<button
										type="button"
										disabled={replayActionLoading === replay.matchId}
										onClick={() =>
											onToggleSaved(replay.matchId, !replay.isSavedByCurrentUser)
										}
									>
										{replay.isSavedByCurrentUser ? "Remove saved" : "Save"}
									</button>
								</div>
							</li>
						))}
					</ul>
				</div>
			) : (
				<p className="hub-panel__muted">{emptyMessage}</p>
			)}
		</section>
	);
}

export function HomePage(): JSX.Element {
	return (
		<ProtectedRoute>
			<HomeMenu />
		</ProtectedRoute>
	);
}
