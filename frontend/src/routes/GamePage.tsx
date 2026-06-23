import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../features/hub/api";
import type { ShellInventory, User } from "../features/hub/api";
import { RETURN_TO_HUB_EVENT } from "../features/hub/ReturnToHubScene";
import type { ShellSmashStartData } from "../lib/createShellSmashGame";
import { createShellSmashGame } from "../lib/createShellSmashGame";
import { hubBackgroundClass } from "../shared/backgrounds";
import { GAME_POWERS, type GameId } from "../shared/mechanics/game-powers";
import { ALL_POWERS, PowerType } from "../shared/mechanics/power-system";
import {
	getGameSocket,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../services/network/gameSocket";

const MAX_PICKS = 3;

interface MatchStatusPayload {
	inMatch: boolean;
	matchId?: string;
	gameId?: string;
	phase?: GameSnapshot["phase"];
	side?: number;
	reconnectExpiresAt?: number | null;
	snapshot?: GameSnapshot;
}

const GAME_SCENES: Record<
	string,
	{ targetScene: string; playerCount: number }
> = {
	"kame-knock": { targetScene: "KameKnockScene", playerCount: 1 },
	"bamboo-bash": { targetScene: "BambooBashScene", playerCount: 2 },
	"temple-curling": { targetScene: "ShellCurlScene", playerCount: 2 },
	"bell-clash": { targetScene: "BellClashScene", playerCount: 1 },
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
	sceneData: { gameId: string; targetScene: string; playerCount: number };
	hubBackground: string | null;
	hubBackgroundAlter: string | null;
	onBack: () => void;
	onLaunch: (data: ShellSmashStartData) => void;
}): JSX.Element {
	const gameId = sceneData.gameId as GameId;
	const [player, setPlayer] = useState<User | null>(null);
	const [inventory, setInventory] = useState<ShellInventory>({ none: Infinity });
	const [isLoading, setIsLoading] = useState(true);
	const [currentPlayer, setCurrentPlayer] = useState(0);
	const [selections, setSelections] = useState<[string[], string[]]>([[], []]);
	const [message, setMessage] = useState("Pick up to 3 special shells, or go with no power.");
	const [messageTone, setMessageTone] = useState<"muted" | "gold" | "error">("muted");
	const [onlinePlayerCount, setOnlinePlayerCount] = useState(2);
	const [isSearchingOnline, setIsSearchingOnline] = useState(false);
	const [activeMatchStatus, setActiveMatchStatus] = useState<MatchStatusPayload | null>(null);
	const isSearchingOnlineRef = useRef(false);

	useEffect(() => {
		let cancelled = false;

		async function loadPicker(): Promise<void> {
			try {
				const nextPlayer = await api.getMe();
				let nextInventory: ShellInventory;
				if (nextPlayer.isGuest) nextInventory = buildFullInventory();
				else {
					try {
						nextInventory = await api.getShellInventory();
					} catch {
						nextInventory = buildFullInventory();
					}
				}
				if (!cancelled) {
					setPlayer(nextPlayer);
					setInventory(nextInventory);
				}
			} catch (err: unknown) {
				console.warn("[GamePage] Failed to load shell picker:", err);
				if (!cancelled) setInventory(buildFullInventory());
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		}

		void loadPicker();
		return () => {
			cancelled = true;
		};
	}, []);

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

	const selected = selections[currentPlayer];
	const backgroundClass = hubBackgroundClass(
		"game-host",
		hubBackground,
		hubBackgroundAlter,
	);
	const isOnlineGame = Boolean(GAME_SCENES[gameId]);
	const playerLabel = sceneData.playerCount === 2 ? `Player ${currentPlayer + 1}` : "Your";
	const activeReconnectSeconds = activeMatchStatus?.reconnectExpiresAt
		? Math.max(0, Math.ceil((activeMatchStatus.reconnectExpiresAt - Date.now()) / 1000))
		: 45;

	const launchLocalGame = async () => {
		if (!(await validateSelection(player, selections[currentPlayer], setMessage, setMessageTone))) return;

		if (sceneData.playerCount === 2 && currentPlayer === 0) {
			setCurrentPlayer(1);
			setMessage("Player 2, pick up to 3 special shells, or go with no power.");
			setMessageTone("muted");
			return;
		}

		onLaunch({
			gameId,
			targetScene: sceneData.targetScene,
			shellSelection: { player0: selections[0], player1: selections[1] },
		});
	};

	const toggleSelection = (type: PowerType) => {
		setSelections((prev) => {
			const next: [string[], string[]] = [[...prev[0]], [...prev[1]]];
			const picks = next[currentPlayer];
			const index = picks.indexOf(type);
			if (index >= 0) picks.splice(index, 1);
			else {
				if (picks.length >= MAX_PICKS) picks.shift();
				picks.push(type);
			}
			return next;
		});
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
			shellSelection: { player0: selections[0], player1: selections[1] },
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
		if (!(await validateSelection(player, selections[0], setMessage, setMessageTone))) return;

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
				shellSelection: { player0: selections[0], player1: [] },
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
			shellSelection: selections[0],
		});
	};

	if (isLoading) {
		return <main className={`power-picker-page game-host ${backgroundClass}`}>Loading shells...</main>;
	}

	return (
		<main className={`power-picker-page game-host ${backgroundClass}`}>
			<section className="power-picker-page__panel">
				<header className="power-picker-page__header">
					<button type="button" className="power-picker-page__back" onClick={onBack}>Back</button>
					<div>
						<p className="power-picker-page__eyebrow">Powerups and Matchmaking</p>
						<h1>{sceneData.playerCount === 2 ? `${playerLabel} Shells` : "Choose Your Shells"}</h1>
					</div>
				</header>

				<p className={`power-picker-page__message power-picker-page__message--${messageTone}`}>{message}</p>
				<p className="power-picker-page__count">{selected.length} / {MAX_PICKS} special shells selected</p>

				<div className="power-picker-page__grid">
					{GAME_POWERS[gameId].map((type) => {
						const def = ALL_POWERS[type];
						const quantity = inventory[type] ?? 0;
						const locked = quantity === 0;
						const isSelected = selected.includes(type);

						return (
							<button
								key={type}
								type="button"
								className={`power-card${isSelected ? " is-selected" : ""}${locked ? " is-locked" : ""}`}
								style={{ "--power-accent": toHex(def.accentColour) } as CSSProperties}
								disabled={locked}
								onClick={() => toggleSelection(type)}
								title={def.description}
							>
								<span className="power-card__orb" />
								<strong>{def.label}</strong>
								<small>{def.description}</small>
								<span className="power-card__qty">{quantity === Infinity ? "∞" : `x${quantity}`}</span>
							</button>
						);
					})}
				</div>

				<footer className="power-picker-page__actions">
					<button type="button" className="power-picker-page__primary" onClick={() => void launchLocalGame()}>
						{sceneData.playerCount === 2 && currentPlayer === 0 ? "Next: Player 2" : "Start Game"}
					</button>
					{isOnlineGame && currentPlayer === 0 ? (
						<div className="power-picker-page__online">
							<div className="power-picker-page__stepper">
								<button type="button" disabled={Boolean(activeMatchStatus)} onClick={() => setOnlinePlayerCount((count) => Math.max(2, count - 1))}>-</button>
								<span>{activeMatchStatus ? `Reconnect window: ${activeReconnectSeconds}s` : `Online players: ${onlinePlayerCount}`}</span>
								<button type="button" disabled={Boolean(activeMatchStatus)} onClick={() => setOnlinePlayerCount((count) => Math.min(5, count + 1))}>+</button>
							</div>
							<button type="button" className="power-picker-page__online-button" onClick={() => void findOnlineMatch()}>
								{activeMatchStatus ? "Rejoin Match" : isSearchingOnline ? "Cancel Search" : "Find Online Match"}
							</button>
							{activeMatchStatus ? <button type="button" className="power-picker-page__danger" onClick={abandonActiveMatch}>Abandon Match</button> : null}
						</div>
					) : null}
				</footer>
			</section>
		</main>
	);
}

async function validateSelection(
	player: User | null,
	picks: string[],
	setMessage: (message: string) => void,
	setMessageTone: (tone: "muted" | "gold" | "error") => void,
): Promise<boolean> {
	if (player?.isGuest || picks.length === 0) return true;
	try {
		await api.validateShellSelection(picks);
		return true;
	} catch {
		setMessage("Selection invalid. Try again.");
		setMessageTone("error");
		return false;
	}
}

function buildFullInventory(): ShellInventory {
	const inventory: ShellInventory = { none: Infinity };
	for (const type of Object.values(PowerType)) {
		if (type !== PowerType.NONE) inventory[type] = Infinity;
	}
	return inventory;
}

function toHex(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`;
}
