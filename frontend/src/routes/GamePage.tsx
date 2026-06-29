import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../features/hub/api";
import { RETURN_TO_HUB_EVENT } from "../features/hub/ReturnToHubScene";
import type { ShellSmashStartData } from "../lib/createShellSmashGame";
import { createShellSmashGame } from "../lib/createShellSmashGame";
import { hubBackgroundClass } from "../shared/backgrounds";
import { GAME_POWERS, type GameId } from "../shared/mechanics/game-powers";
import { ALL_POWERS } from "../shared/mechanics/power-system";
import {
	getGameSocket,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../services/network/gameSocket";

const DISPLAYED_POWERUP_COUNT = 8;
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
	phase?: GameSnapshot["phase"];
	side?: number;
	reconnectExpiresAt?: number | null;
	snapshot?: GameSnapshot;
}

const GAME_SCENES: Record<string, GameSceneConfig> = {
	"kame-knock": {
		targetScene: "KameKnockScene",
		playerCount: 1,
		localModes: { solo: true, versus: false },
		defaultLocalMode: "solo",
	},
	"bamboo-bash": {
		targetScene: "BambooBashScene",
		playerCount: 2,
		localModes: { solo: false, versus: true },
		defaultLocalMode: "versus",
	},
	"temple-curling": {
		targetScene: "ShellCurlScene",
		playerCount: 2,
		localModes: { solo: false, versus: true },
		defaultLocalMode: "versus",
	},
	"bell-clash": {
		targetScene: "BellClashScene",
		playerCount: 1,
		localModes: { solo: true, versus: false },
		defaultLocalMode: "solo",
	},
};

export default function GamePage(): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const navigate = useNavigate();
	const { gameId } = useParams();
	const [hubBackground, setHubBackground] = useState<string | null>(null);
	const [hubBackgroundAlter, setHubBackgroundAlter] = useState<string | null>(null);
	const [launchData, setLaunchData] = useState<ShellSmashStartData | null>(null);

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
					setHubBackground(user.hubBackground);
					setHubBackgroundAlter(user.hubBackgroundAlter);
				}
			})
			.catch((err: unknown) => {
				if (!cancelled) console.warn("[GamePage] Failed to load user:", err);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!launchData) return;
		const host = hostRef.current;
		if (!host) return;

		const handleReturnToHub = () =>
			navigate("/?view=normal", { replace: true });
		window.addEventListener(RETURN_TO_HUB_EVENT, handleReturnToHub);

		const game = createShellSmashGame(host, launchData);
		return () => {
			window.removeEventListener(RETURN_TO_HUB_EVENT, handleReturnToHub);
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
			/>
		);
	}

	return (
		<div
			ref={hostRef}
			className={`game-host game-host-fullscreen ${hubBackgroundClass(
				"game-host",
				hubBackground,
				hubBackgroundAlter,
			)}`}
			aria-label="Shell Smash game canvas"
		/>
	);
}

function PowerupMatchmakingPanel({
	sceneData,
	hubBackground,
	hubBackgroundAlter,
	onBack,
	onLaunch,
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
}): JSX.Element {
	const gameId = sceneData.gameId as GameId;
	const [message, setMessage] = useState("Random power-ups will appear during the match.");
	const [messageTone, setMessageTone] = useState<"muted" | "gold" | "error">("muted");
	const [soloPowerupsEnabled, setSoloPowerupsEnabled] = useState(true);
	const [localVsPlayerCount, setLocalVsPlayerCount] = useState(2);
	const [localVsPowerupsEnabled, setLocalVsPowerupsEnabled] = useState(true);
	const [onlinePlayerCount, setOnlinePlayerCount] = useState(2);
	const [privateOnlinePlayerCount, setPrivateOnlinePlayerCount] = useState(2);
	const [privateOnlinePowerupsEnabled, setPrivateOnlinePowerupsEnabled] = useState(true);
	const [privateRoomPin, setPrivateRoomPin] = useState("");
	const [isSearchingOnline, setIsSearchingOnline] = useState(false);
	const [activeMatchStatus, setActiveMatchStatus] = useState<MatchStatusPayload | null>(null);
	const isSearchingOnlineRef = useRef(false);

	useEffect(() => {
		isSearchingOnlineRef.current = isSearchingOnline;
	}, [isSearchingOnline]);

	useEffect(() => {
		const socket = getGameSocket();
		const handleMatchStatus = (payload: MatchStatusPayload) => {
			setActiveMatchStatus(payload.inMatch ? payload : null);
			if (payload.inMatch) setIsSearchingOnline(false);
		};
		socket.off("match:status", handleMatchStatus);
		socket.on("match:status", handleMatchStatus);
		socket.emit("match:status", { away: true });

		return () => {
			if (isSearchingOnlineRef.current) socket.emit("queue:leave");
			socket.off("match:status", handleMatchStatus);
			socket.off("match:found");
			socket.off("game:state");
			socket.off("queue:error");
			socket.off("queue:left");
		};
	}, []);

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
		? Math.max(0, Math.ceil((activeMatchStatus.reconnectExpiresAt - Date.now()) / 1000))
		: 45;

	const renderPlayerPicker = (
		selectedCount: number,
		onSelect: (count: number) => void,
		label: string,
		disabled = false,
	) => (
		<div className="power-picker-page__player-picker" aria-label={label}>
			{[2, 3, 4, 5].map((count) => (
				<button
					key={count}
					type="button"
					className={selectedCount === count ? "is-selected" : ""}
					disabled={disabled}
					onClick={() => onSelect(count)}
				>
					{count}
					<span className="power-picker-page__shell-icon" aria-hidden="true" />
				</button>
			))}
		</div>
	);

	const launchLocalGame = (localMode: LocalGameMode, localPowerupsEnabled: boolean) => {
		if (!sceneData.localModes[localMode]) {
			setMessage(
				localMode === "solo"
					? `Solo mode is not ready for ${gameTitle}.`
					: `Local VS is not ready for ${gameTitle}.`,
			);
			setMessageTone("muted");
			return;
		}
		onLaunch({
			gameId,
			targetScene: sceneData.targetScene,
			shellSelection: { player0: [], player1: [] },
			localMode,
			localPowerupsEnabled,
		});
	};

	const showPrivateRoomMessage = (action: "create" | "join") => {
		if (action === "join" && !privateRoomPin.trim()) {
			setMessage("Enter a room PIN before joining a private match.");
			setMessageTone("error");
			return;
		}
		setMessage(
			action === "create"
				? `Private rooms are prepared for ${privateOnlinePlayerCount} players. Room creation is coming soon.`
				: `Private room ${privateRoomPin.trim()} is ready for join integration.`,
		);
		setMessageTone("gold");
	};

	const cancelOnlineSearch = () => {
		getGameSocket().emit("queue:leave");
		setIsSearchingOnline(false);
		setMessage("Search cancelled. You can start a new search whenever you are ready.");
		setMessageTone("muted");
	};

	const rejoinActiveMatch = () => {
		if (!activeMatchStatus?.matchId || activeMatchStatus.side === undefined || !activeMatchStatus.snapshot) return;
		const targetScene = GAME_SCENES[activeMatchStatus.gameId ?? ""]?.targetScene;
		if (!targetScene) return;
		getGameSocket().emit("match:rejoin");
		onLaunch({
			gameId: activeMatchStatus.gameId as GameId,
			targetScene,
			shellSelection: { player0: [], player1: [] },
			onlineMatch: {
				matchId: activeMatchStatus.matchId,
				side: activeMatchStatus.side,
				snapshot: activeMatchStatus.snapshot,
			},
		});
	};

	const abandonActiveMatch = () => {
		if (!activeMatchStatus) return;
		getGameSocket().emit("match:abandon");
		setActiveMatchStatus(null);
		setMessage("Match abandoned. You can search for a new match.");
		setMessageTone("muted");
	};

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
		setIsSearchingOnline(true);
		setMessage(`Searching for ${onlinePlayerCount} online players...`);
		setMessageTone("gold");
		socket.off("match:found");
		socket.off("game:state");
		socket.off("queue:error");
		socket.off("queue:left");
		socket.on("match:found", (payload: { matchId: string; side: number }) => {
			matchId = payload.matchId;
			side = payload.side;
			setIsSearchingOnline(false);
			socket.emit("room:ready", { matchId: payload.matchId });
		});
		const onState = (snapshot: GameSnapshot) => {
			if (!matchId || snapshot.matchId !== matchId || snapshot.phase !== "active" || snapshot.gameId !== gameId) return;
			socket.off("game:state", onState);
			setIsSearchingOnline(false);
			onLaunch({
				gameId,
				targetScene: sceneData.targetScene,
				shellSelection: { player0: [], player1: [] },
				onlineMatch: { matchId: snapshot.matchId, side, snapshot } satisfies OnlineMatchContext,
			});
		};
		socket.on("game:state", onState);
		socket.once("queue:error", (payload: { message?: string }) => {
			setIsSearchingOnline(false);
			setMessage(payload.message ?? "Matchmaking failed.");
			setMessageTone("error");
		});
		socket.once("queue:left", () => setIsSearchingOnline(false));
		socket.emit("queue:join", {
			gameId,
			mode: "casual",
			playerCount: onlinePlayerCount,
			shellSelection: [],
		});
	};

	return (
		<main className={`power-picker-page game-host ${backgroundClass}`}>
			<section className="power-picker-page__panel">
				<header className="power-picker-page__header">
					<button type="button" className="power-picker-page__back" onClick={onBack}>Back</button>
					<div className="power-picker-page__title-card">
						<h1>{gameTitle}</h1>
					</div>
				</header>

				<section className="power-picker-page__powerups" aria-label="Power-ups available in this match">
					<h2>Power-Ups in This Match</h2>
					<div className="power-picker-page__grid">
						{displayedPowerups.map((type) => {
							const def = ALL_POWERS[type];

							return (
								<article
									key={type}
									className="power-card"
									style={{ "--power-accent": toHex(def.accentColour) } as CSSProperties}
									title={def.description}
								>
									<span className="power-card__orb" />
									<strong>{def.label}</strong>
								</article>
							);
						})}
					</div>
					<p className={`power-picker-page__message power-picker-page__message--${messageTone}`}>{message}</p>
				</section>

				<footer className="power-picker-page__actions">
					<section className="power-picker-page__mode-card">
						<h2>Local Solo</h2>
						<p>Train alone and tune the chaos before facing other turtles.</p>
						<button
							type="button"
							className={`power-picker-page__toggle ${soloPowerupsEnabled ? "is-selected" : ""}`}
							aria-pressed={soloPowerupsEnabled}
							onClick={() => setSoloPowerupsEnabled((enabled) => !enabled)}
						>
							Power-ups {soloPowerupsEnabled ? "On" : "Off"}
						</button>
						<button
							type="button"
							className="power-picker-page__primary"
							disabled={!sceneData.localModes.solo}
							onClick={() => launchLocalGame("solo", soloPowerupsEnabled)}
						>
							Play Solo
						</button>
					</section>

					<section className="power-picker-page__mode-card">
						<h2>Local VS</h2>
						<p>Couch battle setup for a bigger local showdown.</p>
						{renderPlayerPicker(localVsPlayerCount, setLocalVsPlayerCount, "Local VS player count", !sceneData.localModes.versus)}
						<button
							type="button"
							className={`power-picker-page__toggle ${localVsPowerupsEnabled ? "is-selected" : ""}`}
							aria-pressed={localVsPowerupsEnabled}
							onClick={() => setLocalVsPowerupsEnabled((enabled) => !enabled)}
						>
							Power-ups {localVsPowerupsEnabled ? "On" : "Off"}
						</button>
						<button
							type="button"
							className="power-picker-page__primary"
							disabled={!sceneData.localModes.versus}
							onClick={() => launchLocalGame("versus", localVsPowerupsEnabled)}
						>
							Start Local VS
						</button>
						<p className="power-picker-page__mode-note">Players selected: {localVsPlayerCount}</p>
					</section>

					{isOnlineGame ? (
						<section className="power-picker-page__mode-card power-picker-page__mode-card--online">
							<h2>Multiplayer Online</h2>
							<p>Jump into matchmaking against online opponents.</p>
							{renderPlayerPicker(onlinePlayerCount, setOnlinePlayerCount, "Online player count", Boolean(activeMatchStatus))}
							<button type="button" className="power-picker-page__online-button" onClick={() => void findOnlineMatch()}>
								{activeMatchStatus ? "Rejoin Match" : isSearchingOnline ? "Cancel Search" : "Find Online Match"}
							</button>
							<p className="power-picker-page__online-status">
								{activeMatchStatus
									? `Reconnect window: ${activeReconnectSeconds}s`
									: isSearchingOnline
										? "Searching for opponents..."
										: `Players selected: ${onlinePlayerCount}`}
							</p>
							{activeMatchStatus ? <button type="button" className="power-picker-page__danger" onClick={abandonActiveMatch}>Abandon Match</button> : null}
						</section>
					) : null}

					<section className="power-picker-page__mode-card power-picker-page__mode-card--private">
						<h2>Private Online</h2>
						<p>Create a room or prepare to enter a friend's <span className="power-picker-page__pin-word">PIN</span>.</p>
						{renderPlayerPicker(privateOnlinePlayerCount, setPrivateOnlinePlayerCount, "Private online player count")}
						<button
							type="button"
							className={`power-picker-page__toggle ${privateOnlinePowerupsEnabled ? "is-selected" : ""}`}
							aria-pressed={privateOnlinePowerupsEnabled}
							onClick={() => setPrivateOnlinePowerupsEnabled((enabled) => !enabled)}
						>
							Power-ups {privateOnlinePowerupsEnabled ? "On" : "Off"}
						</button>
						<div className="power-picker-page__pin-row">
							<input
								className="power-picker-page__pin-input"
								value={privateRoomPin}
								onChange={(event) => setPrivateRoomPin(event.target.value.toUpperCase())}
								placeholder="PIN"
								maxLength={8}
								aria-label="Private room PIN"
							/>
							<button type="button" className="power-picker-page__primary" onClick={() => showPrivateRoomMessage("join")}>
								Join
							</button>
							<button type="button" className="power-picker-page__online-button" onClick={() => showPrivateRoomMessage("create")}>
								Create
							</button>
						</div>
					</section>
				</footer>
			</section>
		</main>
	);
}

function toHex(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`;
}
