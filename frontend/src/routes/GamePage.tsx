import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
	Navigate,
	useLocation,
	useNavigate,
	useParams,
} from "react-router-dom";
import { GameConfirmModal } from "../components/common/GameConfirmModal";
import { StoneButton } from "../components/common/StoneButton";
import { api, type User } from "../features/hub/api";
import { RETURN_TO_HUB_EVENT } from "../features/hub/ReturnToHubScene";
import { TOURNAMENT_WS_MESSAGES } from "../features/tournaments/contracts";
import type { TournamentMinigameStartPayload } from "../features/tournaments/TournamentBoardView";
import { TOURNAMENT_QUIT_EVENT } from "../shared/mechanics/hud";
import type { ShellSmashStartData } from "../lib/createShellSmashGame";
import { createShellSmashGame } from "../lib/createShellSmashGame";
import { hubBackgroundClass } from "../shared/backgrounds";
import {
	GAME_POWERS,
	POWER_UP_ASSETS,
	type GameId,
} from "../shared/mechanics/game-powers";
import { ALL_POWERS } from "../shared/mechanics/power-system";
import {
	replayAvailability,
	REPLAY_DISABLED_MESSAGE,
} from "../games/common/replay/contracts";
import {
	getGameSocket,
	type BellClashPhysicsState,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../services/network/gameSocket";

const DISPLAYED_POWERUP_COUNT = 8;
const LOCAL_TEST_SHELL_SKINS = ["dragon", "bamboo", "purple", "base"];
type LocalGameMode = "solo" | "versus";

interface GameSceneConfig {
	targetScene: string;
	playerCount: number;
	localModes: Record<LocalGameMode, boolean>;
	defaultLocalMode: LocalGameMode;
}

const GAME_TITLES: Record<GameId, string> = {
	"temple-curling": "Temple Curling",
	"bamboo-bash": "Bamboo Bash",
	"bell-clash": "Bell Clash",
	"kame-knock": "Kame Knock",
};

interface MatchStatusPayload {
	inMatch: boolean;
	matchId?: string;
	gameId?: string;
	tournamentId?: string;
	phase?: GameSnapshot["phase"];
	side?: number;
	reconnectExpiresAt?: number | null;
	snapshot?: GameSnapshot;
	physicsState?: BellClashPhysicsState;
}

const GAME_SCENES: Record<string, GameSceneConfig> = {
	"kame-knock": {
		targetScene: "KameKnockScene",
		playerCount: 1,
		localModes: { solo: true, versus: true },
		defaultLocalMode: "solo",
	},
	"bamboo-bash": {
		targetScene: "BambooBashScene",
		playerCount: 2,
		localModes: { solo: true, versus: true },
		defaultLocalMode: "versus",
	},
	"temple-curling": {
		targetScene: "ShellCurlScene",
		playerCount: 2,
		localModes: { solo: true, versus: true },
		defaultLocalMode: "versus",
	},
	"bell-clash": {
		targetScene: "BellClashScene",
		playerCount: 1,
		localModes: { solo: true, versus: true },
		defaultLocalMode: "solo",
	},
};

export default function GamePage(): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const navigate = useNavigate();
	const { gameId } = useParams();
	const [hubBackground, setHubBackground] = useState<string | null>(null);
	const [hubBackgroundAlter, setHubBackgroundAlter] = useState<string | null>(
		null,
	);
	const [shellSkin, setShellSkin] = useState("base");
	const [trailEffect, setTrailEffect] = useState("trail_classic");
	const [currentUser, setCurrentUser] = useState<User | null>(null);
	const [launchData, setLaunchData] = useState<ShellSmashStartData | null>(
		null,
	);
	const [isTournamentQuitOpen, setIsTournamentQuitOpen] = useState(false);

	const sceneData = useMemo(() => {
		if (!gameId) return null;
		const game = GAME_SCENES[gameId];
		if (!game) return null;
		return {
			gameId,
			targetScene: game.targetScene,
			playerCount: game.playerCount,
			localModes: game.localModes,
			defaultLocalMode: game.defaultLocalMode,
		};
	}, [gameId]);

	useEffect(() => {
		let cancelled = false;

		void api
			.getMe()
			.then((user) => {
				if (!cancelled) {
					setCurrentUser(user);
					setHubBackground(user.hubBackground);
					setHubBackgroundAlter(user.hubBackgroundAlter);
					setShellSkin(user.shellSkin || "base");
					setTrailEffect(user.trailEffect || "trail_classic");
				}
			})
			.catch((err: unknown) => {
				if (!cancelled)
					console.warn("[GamePage] Failed to load user:", err);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!launchData) return;
		const host = hostRef.current;
		if (!host) return;

		// Tournament minigames return to their tournament board, not the hub.
		const tournamentId = launchData.onlineMatch?.tournamentId;
		const handleReturnToHub = () =>
			tournamentId
				? navigate(`/tournament/${tournamentId}`, { replace: true })
				: navigate("/?view=normal", { replace: true });
		window.addEventListener(RETURN_TO_HUB_EVENT, handleReturnToHub);

		// The in-arena "LEAVE GAME" button (tournament minigames only, see
		// buildReturnButton): quit the WHOLE tournament for good — the server
		// hands both the board seat and this minigame seat to CPUs — and go to
		// the hub, NOT back to the tournament page. The id travels in the body
		// because this socket left the tournament room when it entered the
		// arena.
		const handleQuitTournament = () => {
			if (!tournamentId) return;
			setIsTournamentQuitOpen(true);
		};
		window.addEventListener(TOURNAMENT_QUIT_EVENT, handleQuitTournament);

		const game = createShellSmashGame(host, launchData);
		// Tell the server this client's arena scene has actually mounted — a
		// server-initiated launch (tournament minigame, lobby match, rematch)
		// marks every seat ready at match creation, well before any client has
		// navigated in, so BotPlayerService holds CPU activity on THIS signal
		// instead of a guessed navigation delay (see game:arena-ready).
		if (launchData.onlineMatch) {
			getGameSocket().emit("game:arena-ready", {
				matchId: launchData.onlineMatch.matchId,
			});
		}
		return () => {
			window.removeEventListener(RETURN_TO_HUB_EVENT, handleReturnToHub);
			window.removeEventListener(
				TOURNAMENT_QUIT_EVENT,
				handleQuitTournament,
			);
			game.destroy(true);
			host.replaceChildren();
		};
	}, [navigate, launchData]);

	if (!sceneData) return <Navigate to="/" replace />;
	if (!launchData) {
		return (
			<PowerupMatchmakingPanel
				sceneData={sceneData}
				hubBackground={hubBackground}
				hubBackgroundAlter={hubBackgroundAlter}
				onBack={() => navigate("/?view=normal", { replace: true })}
				onLaunch={setLaunchData}
				shellSkin={shellSkin}
				trailEffect={trailEffect}
				currentUser={currentUser}
			/>
		);
	}

	const tournamentId = launchData.onlineMatch?.tournamentId;
	const confirmTournamentQuit = () => {
		if (!tournamentId) return;
		setIsTournamentQuitOpen(false);
		getGameSocket().emit(TOURNAMENT_WS_MESSAGES.QUIT, { tournamentId });
		// Leaving a tournament for good always returns to the main mode-select
		// page (matches TournamentBoardView's onExit), never the Normal hub.
		navigate("/", { replace: true });
	};

	return (
		<>
			<div
				ref={hostRef}
				className={`game-host game-host-fullscreen ${hubBackgroundClass(
					"game-host",
					hubBackground,
					hubBackgroundAlter,
				)}`}
				aria-label="Shell Smash game canvas"
			/>
			<GameConfirmModal
				isOpen={isTournamentQuitOpen}
				title="Leave tournament?"
				description="This counts as a loss on your record. A CPU will take your place for the rest of the tournament and you will not be able to rejoin."
				confirmLabel="Leave tournament"
				onConfirm={confirmTournamentQuit}
				onCancel={() => setIsTournamentQuitOpen(false)}
			/>
		</>
	);
}

function PowerupMatchmakingPanel({
	sceneData,
	hubBackground,
	hubBackgroundAlter,
	onBack,
	onLaunch,
	shellSkin,
	trailEffect,
	currentUser,
}: {
	sceneData: {
		gameId: string;
		targetScene: string;
		playerCount: number;
		localModes: Record<LocalGameMode, boolean>;
		defaultLocalMode: LocalGameMode;
	};
	hubBackground: string | null;
	hubBackgroundAlter: string | null;
	onBack: () => void;
	onLaunch: (data: ShellSmashStartData) => void;
	shellSkin: string;
	trailEffect: string;
	currentUser: User | null;
}): JSX.Element {
	const gameId = sceneData.gameId as GameId;
	const location = useLocation();
	const autoJoinMatch = Boolean(
		(location.state as { autoJoinMatch?: boolean } | null)?.autoJoinMatch,
	);
	// The full `tournament:minigame-start` payload (TournamentBoardView),
	// carried through navigation state so we can launch straight into
	// gameplay from it instead of re-discovering the match through the
	// auto-join round trip below (see the effect using it further down).
	const tournamentMinigame = (
		location.state as
			| { tournamentMinigame?: TournamentMinigameStartPayload }
			| null
	)?.tournamentMinigame;
	const hasAutoJoinedRef = useRef(false);
	const [message, setMessage] = useState(
		"Power-ups are off by default. Enable them for extra chaos.",
	);
	const [messageTone, setMessageTone] = useState<"muted" | "gold" | "error">(
		"muted",
	);
	const [soloPowerupsEnabled, setSoloPowerupsEnabled] = useState(false);
	const [localVsPlayerCount, setLocalVsPlayerCount] = useState(2);
	const [localVsPowerupsEnabled, setLocalVsPowerupsEnabled] = useState(false);
	const [onlinePlayerCount, setOnlinePlayerCount] = useState(2);
	const [onlinePowerupsEnabled, setOnlinePowerupsEnabled] = useState(false);
	// Rankings Bug Audit N7 (2026-07-20): this is the real "Normal Mode"
	// online-queue flow (reached via the game cards -> /play/:gameId), and its
	// queue:join emit used to hardcode `mode: "casual"` — the backend's
	// entire ranked pipeline (Elo, per-game leaderboard tabs) was live but
	// unreachable from here. Guests never see the toggle (the backend
	// rejects ranked for them regardless — `matchmaking.service.ts`).
	const [onlineMode, setOnlineMode] = useState<"casual" | "ranked">("casual");
	const [privateOnlinePlayerCount, setPrivateOnlinePlayerCount] = useState(2);
	const [privateOnlinePowerupsEnabled, setPrivateOnlinePowerupsEnabled] =
		useState(false);
	const [privateRoomPin, setPrivateRoomPin] = useState("");
	const [privateLobby, setPrivateLobby] = useState<{
		lobbyId: string;
		pin: string;
		gameId: string;
		playerCount: number;
		joinedCount: number;
		expiresAt: number;
	} | null>(null);
	const [isSearchingOnline, setIsSearchingOnline] = useState(false);
	const [activeMatchStatus, setActiveMatchStatus] =
		useState<MatchStatusPayload | null>(null);
	const [isAbandonConfirmOpen, setIsAbandonConfirmOpen] = useState(false);
	const isSearchingOnlineRef = useRef(false);
	// R10: hold references to the online-search socket handlers so they can be
	// detached precisely. Bare `socket.off("game:state")` on the shared singleton
	// socket would strip a live scene's own listener too.
	const onlineSearchHandlersRef = useRef<{
		matchFound?: (payload: { matchId: string; side: number }) => void;
		state?: (snapshot: GameSnapshot) => void;
		queueError?: (payload: { message?: string }) => void;
		queueLeft?: () => void;
	}>({});
	const detachOnlineSearchHandlers = () => {
		const socket = getGameSocket();
		const handlers = onlineSearchHandlersRef.current;
		if (handlers.matchFound)
			socket.off("match:found", handlers.matchFound);
		if (handlers.state) socket.off("game:state", handlers.state);
		if (handlers.queueError)
			socket.off("queue:error", handlers.queueError);
		if (handlers.queueLeft) socket.off("queue:left", handlers.queueLeft);
		onlineSearchHandlersRef.current = {};
	};
	const togglePowerups = (
		setEnabled: (updater: (enabled: boolean) => boolean) => void,
	) => {
		setEnabled((enabled) => {
			const next = !enabled;
			if (next) {
				setMessage(REPLAY_DISABLED_MESSAGE);
				setMessageTone("muted");
			}
			return next;
		});
	};

	useEffect(() => {
		isSearchingOnlineRef.current = isSearchingOnline;
	}, [isSearchingOnline]);

	useEffect(() => {
		const socket = getGameSocket();
		const handleMatchStatus = (payload: MatchStatusPayload) => {
			setActiveMatchStatus(payload.inMatch ? payload : null);
			if (payload.inMatch) setIsSearchingOnline(false);
		};
		const handleLobbyCreatedPin = (payload: {
			lobbyId: string;
			pin: string;
			gameId: string;
			playerCount: number;
			joinedCount: number;
			expiresAt: number;
		}) => {
			setPrivateLobby(payload);
			setPrivateRoomPin(payload.pin);
			setMessage(
				`Private room ${payload.pin} created. Waiting for ${payload.joinedCount}/${payload.playerCount} players.`,
			);
			setMessageTone("gold");
		};
		const handleLobbyWaiting = (payload: {
			lobbyId: string;
			pin: string;
			gameId: string;
			playerCount: number;
			joinedCount: number;
			expiresAt: number;
		}) => {
			if (payload.gameId !== gameId) return;
			setPrivateLobby(payload);
			setPrivateRoomPin(payload.pin);
			setMessage(
				`Private room ${payload.pin}: ${payload.joinedCount}/${payload.playerCount} players joined.`,
			);
			setMessageTone("gold");
		};
		const handleLobbyMatched = (payload: {
			matchId: string;
			side: number;
			gameId: string;
			snapshot?: GameSnapshot;
			physicsState?: BellClashPhysicsState;
		}) => {
			if (payload.gameId !== gameId || !payload.snapshot) return;
			setPrivateLobby(null);
			setIsSearchingOnline(false);
			onLaunch({
				gameId,
				targetScene: sceneData.targetScene,
				user: currentUser ?? undefined,
				shellSelection: buildEmptyShellSelection(
					payload.snapshot.players.length,
				),
				...replayAvailability(payload.snapshot.powerupsEnabled),
				onlineMatch: {
					matchId: payload.matchId,
					side: payload.side,
					snapshot: payload.snapshot,
					physicsState: payload.physicsState,
					...replayAvailability(payload.snapshot.powerupsEnabled),
				} satisfies OnlineMatchContext,
			});
		};
		const handleLobbySpectating = (payload: {
			matchId: string;
			gameId: string;
			snapshot: GameSnapshot;
			physicsState?: BellClashPhysicsState;
		}) => {
			if (payload.gameId !== gameId) return;
			setPrivateLobby(null);
			onLaunch({
				gameId,
				targetScene: sceneData.targetScene,
				user: currentUser ?? undefined,
				shellSelection: buildEmptyShellSelection(
					payload.snapshot.players.length,
				),
				...replayAvailability(payload.snapshot.powerupsEnabled),
				onlineMatch: {
					matchId: payload.matchId,
					side: -1,
					spectator: true,
					snapshot: payload.snapshot,
					physicsState: payload.physicsState,
					...replayAvailability(payload.snapshot.powerupsEnabled),
				} satisfies OnlineMatchContext,
			});
		};
		const handleLobbyClosed = (payload: { lobbyId: string }) => {
			setPrivateLobby((current) =>
				!current || current.lobbyId !== payload.lobbyId
					? current
					: null,
			);
			setMessage(
				"Private room closed. You can create or join another one.",
			);
			setMessageTone("muted");
		};
		const handleLobbyError = (payload: { message?: string }) => {
			setMessage(payload.message ?? "Private room action failed.");
			setMessageTone("error");
		};
		socket.off("match:status", handleMatchStatus);
		socket.on("match:status", handleMatchStatus);
		socket.on("lobby:created-pin", handleLobbyCreatedPin);
		socket.on("lobby:waiting", handleLobbyWaiting);
		socket.on("lobby:matched", handleLobbyMatched);
		socket.on("lobby:spectating", handleLobbySpectating);
		socket.on("lobby:expired", handleLobbyClosed);
		socket.on("lobby:cancelled", handleLobbyClosed);
		socket.on("lobby:error", handleLobbyError);
		socket.emit("match:status");

		return () => {
			if (isSearchingOnlineRef.current) socket.emit("queue:leave");
			socket.off("match:status", handleMatchStatus);
			socket.off("lobby:created-pin", handleLobbyCreatedPin);
			socket.off("lobby:waiting", handleLobbyWaiting);
			socket.off("lobby:matched", handleLobbyMatched);
			socket.off("lobby:spectating", handleLobbySpectating);
			socket.off("lobby:expired", handleLobbyClosed);
			socket.off("lobby:cancelled", handleLobbyClosed);
			socket.off("lobby:error", handleLobbyError);
			// R10: remove the online-search listeners by reference, never with a
			// bare event-name off that would also detach a live scene's handler.
			detachOnlineSearchHandlers();
		};
	}, [currentUser, gameId, onLaunch, sceneData.targetScene]);

	const backgroundClass = hubBackgroundClass(
		"game-host",
		hubBackground,
		hubBackgroundAlter,
	);
	const isOnlineGame = Boolean(GAME_SCENES[gameId]);
	const gameTitle = GAME_TITLES[gameId];
	const displayedPowerups = GAME_POWERS[gameId].slice(
		0,
		DISPLAYED_POWERUP_COUNT,
	);
	const activeReconnectSeconds = activeMatchStatus?.reconnectExpiresAt
		? Math.max(
				0,
				Math.ceil(
					(activeMatchStatus.reconnectExpiresAt - Date.now()) / 1000,
				),
			)
		: 45;

	const renderPlayerPicker = (
		selectedCount: number,
		onSelect: (count: number) => void,
		label: string,
		disabled = false,
	) => (
		<div className="power-picker-page__player-picker" aria-label={label}>
			{[2, 3, 4, 5].map((count) => (
				<StoneButton
					key={count}
					type="button"
					className={selectedCount === count ? "is-selected" : ""}
					disabled={disabled}
					onClick={() => onSelect(count)}
				>
					{count}
					<span
						className="power-picker-page__shell-icon"
						aria-hidden="true"
					/>
				</StoneButton>
			))}
		</div>
	);

	// Rankings Bug Audit N7: mirrors renderPlayerPicker's segmented-control
	// styling for the Casual/Ranked choice. Only rendered for non-guest
	// players — see the `canRank` guard where this is called.
	const renderModePicker = (
		selectedMode: "casual" | "ranked",
		onSelect: (mode: "casual" | "ranked") => void,
		label: string,
		disabled = false,
	) => (
		<div className="power-picker-page__player-picker" aria-label={label}>
			{(["casual", "ranked"] as const).map((mode) => (
				<StoneButton
					key={mode}
					type="button"
					className={selectedMode === mode ? "is-selected" : ""}
					disabled={disabled}
					onClick={() => onSelect(mode)}
				>
					{mode === "casual" ? "Casual" : "Ranked"}
				</StoneButton>
			))}
		</div>
	);

	const launchLocalGame = (
		localMode: LocalGameMode,
		localPowerupsEnabled: boolean,
	) => {
		if (!sceneData.localModes[localMode]) {
			setMessage(
				localMode === "solo"
					? `Solo mode is not ready for ${gameTitle}.`
					: `Local VS is not ready for ${gameTitle}.`,
			);
			setMessageTone("muted");
			return;
		}
		const playerCount = localMode === "versus" ? localVsPlayerCount : 1;
		const shellSkins = Object.fromEntries(
			Array.from({ length: playerCount }, (_value, index) => [
				`player${index}`,
				index === 0
					? shellSkin
					: LOCAL_TEST_SHELL_SKINS[
							(index - 1) % LOCAL_TEST_SHELL_SKINS.length
						],
			]),
		) as Record<string, string>;
		const trailEffects = Object.fromEntries(
			Array.from({ length: playerCount }, (_value, index) => [
				`player${index}`,
				index === 0 ? trailEffect : "trail_classic",
			]),
		) as Record<string, string>;
		onLaunch({
			gameId,
			targetScene: sceneData.targetScene,
			user: currentUser ?? undefined,
			shellSelection: Object.fromEntries(
				Array.from({ length: playerCount }, (_value, index) => [
					`player${index}`,
					[],
				]),
			) as Record<string, string[]>,
			localMode,
			localPlayerCount: playerCount,
			localPowerupsEnabled,
			...replayAvailability(localPowerupsEnabled),
			shellSkins,
			trailEffects,
		});
	};

	const createPrivateRoom = () => {
		if (activeMatchStatus) {
			setMessage(
				"Finish or abandon your active match before creating a private room.",
			);
			setMessageTone("error");
			return;
		}
		getGameSocket().emit("lobby:create-pin", {
			gameId,
			playerCount: privateOnlinePlayerCount,
			powerupsEnabled: privateOnlinePowerupsEnabled,
			shellSelection: [],
		});
		setMessage("Creating private room...");
		setMessageTone("gold");
	};

	const joinPrivateRoom = () => {
		const pin = privateRoomPin.trim();
		if (!pin) {
			setMessage("Enter a room PIN before joining a private match.");
			setMessageTone("error");
			return;
		}
		getGameSocket().emit("lobby:join-pin", {
			pin,
			gameId,
			shellSelection: [],
		});
		setMessage(`Joining private room ${pin}...`);
		setMessageTone("gold");
	};

	const spectatePrivateRoom = () => {
		const pin = privateRoomPin.trim();
		if (!pin) {
			setMessage("Enter a room PIN before watching a private match.");
			setMessageTone("error");
			return;
		}
		getGameSocket().emit("lobby:spectate-pin", { pin, gameId });
		setMessage(`Looking for private match ${pin}...`);
		setMessageTone("gold");
	};

	const cancelPrivateRoom = () => {
		if (!privateLobby) return;
		getGameSocket().emit("lobby:cancel", { lobbyId: privateLobby.lobbyId });
		setPrivateLobby(null);
		setMessage("Private room cancelled.");
		setMessageTone("muted");
	};

	const cancelOnlineSearch = () => {
		getGameSocket().emit("queue:leave");
		setIsSearchingOnline(false);
		setMessage(
			"Search cancelled. You can start a new search whenever you are ready.",
		);
		setMessageTone("muted");
	};

	const rejoinActiveMatch = () => {
		if (
			!activeMatchStatus?.matchId ||
			activeMatchStatus.side === undefined ||
			!activeMatchStatus.snapshot
		)
			return;
		const targetScene =
			GAME_SCENES[activeMatchStatus.gameId ?? ""]?.targetScene;
		if (!targetScene) return;
		const socket = getGameSocket();
		const {
			matchId,
			gameId: activeGameId,
			side,
			tournamentId,
		} = activeMatchStatus;
		const onRejoinedState = (snapshot: GameSnapshot) => {
			if (
				snapshot.matchId !== matchId ||
				snapshot.gameId !== activeGameId
			)
				return;
			socket.off("game:state", onRejoinedState);
			socket.emit(
				"game:physics-request",
				{ matchId },
				(physicsState: OnlineMatchContext["physicsState"] | null) => {
					onLaunch({
						gameId: activeGameId as GameId,
						targetScene,
						user: currentUser ?? undefined,
						// P6: size the (empty) shell selection to the real player
						// count so N>2 online rejoins do not silently assume 2 seats.
						shellSelection: buildEmptyShellSelection(
							snapshot.players.length,
						),
						...replayAvailability(snapshot.powerupsEnabled),
						onlineMatch: {
							matchId,
							side,
							tournamentId,
							rejoining: true,
							snapshot,
							physicsState: physicsState ?? undefined,
							...replayAvailability(snapshot.powerupsEnabled),
						},
					});
				},
			);
		};
		socket.on("game:state", onRejoinedState);
		socket.emit("match:rejoin");
	};

	const abandonActiveMatch = () => {
		if (!activeMatchStatus) return;
		setIsAbandonConfirmOpen(true);
	};

	const confirmAbandonActiveMatch = () => {
		setIsAbandonConfirmOpen(false);
		getGameSocket().emit("match:abandon");
		setActiveMatchStatus(null);
		setMessage("Match abandoned. You can search for a new match.");
		setMessageTone("muted");
	};

	// A tournament minigame carries its full match payload already (see
	// TournamentBoardView's onMinigameStart) — launch straight from it,
	// available synchronously on the very first render (`location.state`),
	// instead of falling through to the round-trip auto-join below. That
	// round trip (match:status → match:rejoin → game:physics-request) used
	// to be the ONLY path here, discarding the payload the server already
	// sent — its indirection raced the arena's "wait for every real seat"
	// gate (BotPlayerService, `game:arena-ready`): a slow trip could let the
	// CPUs' backstop timer fire before this client ever mounted, so the
	// player would land mid-match with no proper start (or end) sequence.
	useEffect(() => {
		if (hasAutoJoinedRef.current) return;
		if (!tournamentMinigame || tournamentMinigame.gameId !== gameId) return;
		hasAutoJoinedRef.current = true;
		onLaunch({
			gameId,
			targetScene: sceneData.targetScene,
			user: currentUser ?? undefined,
			shellSelection: buildEmptyShellSelection(
				tournamentMinigame.snapshot.players.length,
			),
			...replayAvailability(tournamentMinigame.snapshot.powerupsEnabled),
			onlineMatch: {
				matchId: tournamentMinigame.matchId,
				side: tournamentMinigame.side,
				tournamentId: tournamentMinigame.tournamentId,
				snapshot: tournamentMinigame.snapshot,
				physicsState: tournamentMinigame.physicsState,
				...replayAvailability(tournamentMinigame.snapshot.powerupsEnabled),
			} satisfies OnlineMatchContext,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- onLaunch/sceneData/currentUser close over render-local values re-created every render; the ref guard makes re-running this effect body harmless
	}, [tournamentMinigame, gameId]);

	// Auto-join a private-lobby match: HomePage navigates here with
	// { autoJoinMatch: true } right after a lobby invite is accepted (see
	// onLobbyMatched in HomePage.tsx), so both players land directly in
	// gameplay instead of each having to find and click "Rejoin Match".
	// Guarded by a ref so it only fires once per page visit, and scoped to
	// this game's id so a stale flag can't hijack an unrelated match. Also
	// the fallback path for a tournament minigame that lost its navigation
	// state (e.g. a hard refresh) — the effect above already handles the
	// normal case directly.
	useEffect(() => {
		if (!autoJoinMatch || hasAutoJoinedRef.current) return;
		if (
			activeMatchStatus?.matchId &&
			activeMatchStatus.side !== undefined &&
			activeMatchStatus.snapshot &&
			activeMatchStatus.gameId === gameId
		) {
			hasAutoJoinedRef.current = true;
			rejoinActiveMatch();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- rejoinActiveMatch closes over activeMatchStatus/onLaunch, re-created every render; the ref guard makes re-running this effect body harmless
	}, [autoJoinMatch, activeMatchStatus, gameId]);

	const findOnlineMatch = async () => {
		if (activeMatchStatus) {
			rejoinActiveMatch();
			return;
		}
		if (isSearchingOnline) {
			cancelOnlineSearch();
			return;
		}

		const socket = getGameSocket();
		let matchId: string | null = null;
		let side = 0;
		// Defensive fallback (see the `onlineMode` state comment above): never
		// send "ranked" for a guest even if `onlineMode` were somehow stale,
		// since the toggle that sets it is not rendered for guests at all.
		const mode = currentUser?.isGuest ? "casual" : onlineMode;
		setIsSearchingOnline(true);
		setMessage(`Searching for ${onlinePlayerCount} ${mode} players...`);
		setMessageTone("gold");
		detachOnlineSearchHandlers();
		const onMatchFound = (payload: { matchId: string; side: number }) => {
			matchId = payload.matchId;
			side = payload.side;
			setIsSearchingOnline(false);
			socket.emit("room:ready", { matchId: payload.matchId });
		};
		const onState = (snapshot: GameSnapshot) => {
			if (
				!matchId ||
				snapshot.matchId !== matchId ||
				snapshot.phase !== "active" ||
				snapshot.gameId !== gameId
			)
				return;
			socket.off("game:state", onState);
			setIsSearchingOnline(false);
			onLaunch({
				gameId,
				targetScene: sceneData.targetScene,
				user: currentUser ?? undefined,
				// P6: size the (empty) shell selection to the real player count.
				shellSelection: buildEmptyShellSelection(
					snapshot.players.length,
				),
				...replayAvailability(snapshot.powerupsEnabled),
				onlineMatch: {
					matchId: snapshot.matchId,
					side,
					snapshot,
					...replayAvailability(snapshot.powerupsEnabled),
				} satisfies OnlineMatchContext,
			});
		};
		const onQueueError = (payload: { message?: string }) => {
			setIsSearchingOnline(false);
			setMessage(payload.message ?? "Matchmaking failed.");
			setMessageTone("error");
		};
		const onQueueLeft = () => setIsSearchingOnline(false);
		// Track every handler so both the pre-subscribe detach above and the
		// effect cleanup can remove exactly these listeners by reference (R10).
		onlineSearchHandlersRef.current = {
			matchFound: onMatchFound,
			state: onState,
			queueError: onQueueError,
			queueLeft: onQueueLeft,
		};
		socket.on("match:found", onMatchFound);
		socket.on("game:state", onState);
		socket.on("queue:error", onQueueError);
		socket.on("queue:left", onQueueLeft);
		socket.emit("queue:join", {
			gameId,
			mode,
			playerCount: onlinePlayerCount,
			powerupsEnabled: onlinePowerupsEnabled,
			shellSelection: [],
		});
	};

	return (
		<main className={`power-picker-page game-host ${backgroundClass}`}>
			<GameConfirmModal
				isOpen={isAbandonConfirmOpen}
				title="Abandon match?"
				description="This counts as a loss on your record and your opponent is awarded the win. You can search for a new match afterwards."
				confirmLabel="Abandon match"
				onConfirm={confirmAbandonActiveMatch}
				onCancel={() => setIsAbandonConfirmOpen(false)}
			/>
			<section className="power-picker-page__panel">
				<header className="power-picker-page__header">
					<div className="power-picker-page__title-card">
						<h1>{gameTitle}</h1>
					</div>
				</header>

				<section
					className="power-picker-page__powerups"
					aria-label="Power-ups available in this match"
				>
					<h2>Power-Ups in This Match</h2>
					<div className="power-picker-page__grid">
						{displayedPowerups.map((type) => {
							const def = ALL_POWERS[type];
							const imageSrc = POWER_UP_ASSETS[type];

							return (
								<article
									key={type}
									className="power-card"
									style={
										{
											"--power-accent": toHex(
												def.accentColour,
											),
										} as CSSProperties
									}
									title={def.description}
								>
									{imageSrc ? (
										<img
											className="power-card__orb"
											src={imageSrc}
											alt=""
											aria-hidden="true"
										/>
									) : (
										<span className="power-card__orb" />
									)}
									<strong>{def.label}</strong>
								</article>
							);
						})}
					</div>
					<p
						className={`power-picker-page__message power-picker-page__message--${messageTone}`}
					>
						{message}
					</p>
				</section>

				<footer className="power-picker-page__actions">
					<section className="power-picker-page__mode-card">
						<h2>Local Solo</h2>
						<p>
							Train alone and tune the chaos before facing other
							turtles.
						</p>
						<div
							className="power-picker-page__player-picker-spacer"
							aria-hidden="true"
						/>
						<StoneButton
							variant="back"
							type="button"
							className={`power-picker-page__stone-control ${soloPowerupsEnabled ? "is-selected" : ""}`}
							aria-pressed={soloPowerupsEnabled}
							onClick={() =>
								togglePowerups(setSoloPowerupsEnabled)
							}
						>
							Power-ups {soloPowerupsEnabled ? "On" : "Off"}
						</StoneButton>
						{soloPowerupsEnabled ? (
							<p className="power-picker-page__replay-warning">
								{REPLAY_DISABLED_MESSAGE}
							</p>
						) : null}
						<StoneButton
							variant="back"
							type="button"
							className="power-picker-page__stone-control"
							disabled={!sceneData.localModes.solo}
							onClick={() =>
								launchLocalGame("solo", soloPowerupsEnabled)
							}
						>
							Play Solo
						</StoneButton>
						<p className="power-picker-page__mode-note">
							Play solo matches
						</p>
					</section>

					<section className="power-picker-page__mode-card">
						<h2>Local VS</h2>
						<p>Couch battle setup for a bigger local showdown.</p>
						{renderPlayerPicker(
							localVsPlayerCount,
							setLocalVsPlayerCount,
							"Local VS player count",
							!sceneData.localModes.versus,
						)}
						<StoneButton
							variant="back"
							type="button"
							className={`power-picker-page__stone-control ${localVsPowerupsEnabled ? "is-selected" : ""}`}
							aria-pressed={localVsPowerupsEnabled}
							onClick={() =>
								togglePowerups(setLocalVsPowerupsEnabled)
							}
						>
							Power-ups {localVsPowerupsEnabled ? "On" : "Off"}
						</StoneButton>
						{localVsPowerupsEnabled ? (
							<p className="power-picker-page__replay-warning">
								{REPLAY_DISABLED_MESSAGE}
							</p>
						) : null}
						<StoneButton
							variant="back"
							type="button"
							className="power-picker-page__stone-control"
							disabled={!sceneData.localModes.versus}
							onClick={() =>
								launchLocalGame(
									"versus",
									localVsPowerupsEnabled,
								)
							}
						>
							Start Local VS
						</StoneButton>
						<p className="power-picker-page__mode-note">
							Players selected: {localVsPlayerCount}
						</p>
					</section>

					{isOnlineGame ? (
						<section className="power-picker-page__mode-card power-picker-page__mode-card--online">
							<h2>Multiplayer Online</h2>
							<p>
								Jump into matchmaking against online opponents.
							</p>
							{!currentUser?.isGuest
								? renderModePicker(
										onlineMode,
										setOnlineMode,
										"Online match mode",
										isSearchingOnline ||
											Boolean(activeMatchStatus),
									)
								: null}
							{renderPlayerPicker(
								onlinePlayerCount,
								setOnlinePlayerCount,
								"Online player count",
								Boolean(activeMatchStatus),
							)}
							<StoneButton
								variant="back"
								type="button"
								className={`power-picker-page__stone-control ${onlinePowerupsEnabled ? "is-selected" : ""}`}
								aria-pressed={onlinePowerupsEnabled}
								disabled={
									isSearchingOnline ||
									Boolean(activeMatchStatus)
								}
								onClick={() =>
									togglePowerups(setOnlinePowerupsEnabled)
								}
							>
								Power-ups {onlinePowerupsEnabled ? "On" : "Off"}
							</StoneButton>
							{onlinePowerupsEnabled ? (
								<p className="power-picker-page__replay-warning">
									{REPLAY_DISABLED_MESSAGE}
								</p>
							) : null}
							<StoneButton
								variant="back"
								type="button"
								className="power-picker-page__stone-control"
								onClick={() => void findOnlineMatch()}
							>
								{activeMatchStatus
									? "Rejoin Match"
									: isSearchingOnline
										? "Cancel Search"
										: "Find Online Match"}
							</StoneButton>
							<p className="power-picker-page__online-status">
								{activeMatchStatus
									? `Reconnect window: ${activeReconnectSeconds}s`
									: isSearchingOnline
										? "Searching for opponents..."
										: currentUser?.isGuest
											? `Players selected: ${onlinePlayerCount}`
											: `Players selected: ${onlinePlayerCount} · ${onlineMode === "ranked" ? "Ranked" : "Casual"}`}
							</p>
							{activeMatchStatus ? (
								<button
									type="button"
									className="power-picker-page__danger"
									onClick={abandonActiveMatch}
								>
									Abandon Match
								</button>
							) : null}
						</section>
					) : null}

					<section className="power-picker-page__mode-card power-picker-page__mode-card--private">
						<h2>Private Online</h2>
						<p>
							Create a room or prepare to enter a friend's{" "}
							<span className="power-picker-page__pin-word">
								PIN.
							</span>
						</p>
						{renderPlayerPicker(
							privateOnlinePlayerCount,
							setPrivateOnlinePlayerCount,
							"Private online player count",
						)}
						<StoneButton
							variant="back"
							type="button"
							className={`power-picker-page__stone-control ${privateOnlinePowerupsEnabled ? "is-selected" : ""}`}
							aria-pressed={privateOnlinePowerupsEnabled}
							onClick={() =>
								togglePowerups(setPrivateOnlinePowerupsEnabled)
							}
						>
							Power-ups{" "}
							{privateOnlinePowerupsEnabled ? "On" : "Off"}
						</StoneButton>
						{privateOnlinePowerupsEnabled ? (
							<p className="power-picker-page__replay-warning">
								{REPLAY_DISABLED_MESSAGE}
							</p>
						) : null}
						<div className="power-picker-page__pin-row">
							<input
								className="power-picker-page__pin-input"
								value={privateRoomPin}
								onChange={(event) =>
									setPrivateRoomPin(
										event.target.value
											.replace(/[^a-z0-9]/gi, "")
											.toUpperCase(),
									)
								}
								placeholder="PIN"
								maxLength={6}
								aria-label="Private room PIN"
							/>
							<StoneButton
								type="button"
								className="power-picker-page__stone-action"
								onClick={joinPrivateRoom}
							>
								Join
							</StoneButton>
							<StoneButton
								type="button"
								className="power-picker-page__stone-action"
								onClick={createPrivateRoom}
							>
								Create
							</StoneButton>
							<StoneButton
								type="button"
								className="power-picker-page__stone-action"
								onClick={spectatePrivateRoom}
							>
								Watch
							</StoneButton>
						</div>
						{privateLobby ? (
							<>
								<p className="power-picker-page__mode-note">
									PIN {privateLobby.pin} ·{" "}
									{privateLobby.joinedCount}/
									{privateLobby.playerCount} players
								</p>
								<button
									type="button"
									className="power-picker-page__danger"
									onClick={cancelPrivateRoom}
								>
									Cancel Private Room
								</button>
							</>
						) : null}
					</section>
				</footer>
				<StoneButton
					variant="back"
					type="button"
					className="power-picker-page__back"
					onClick={onBack}
				>
					← Back
				</StoneButton>
			</section>
		</main>
	);
}

function buildEmptyShellSelection(
	playerCount: number,
): Record<string, string[]> {
	return Object.fromEntries(
		Array.from({ length: playerCount }, (_value, index) => [
			`player${index}`,
			[],
		]),
	) as Record<string, string[]>;
}

function toHex(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`;
}
