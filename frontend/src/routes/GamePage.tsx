import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../features/hub/api";
import { RETURN_TO_HUB_EVENT } from "../features/hub/ReturnToHubScene";
import { createShellSmashGame } from "../lib/createShellSmashGame";
import { hubBackgroundClass } from "../shared/backgrounds";

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
				if (!cancelled) setHubBackground(user.hubBackground);
			})
			.catch((err: unknown) => {
				if (!cancelled) console.warn("[GamePage] Failed to load user:", err);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!sceneData) return;
		const host = hostRef.current;
		if (!host) return;

		const handleReturnToHub = () =>
			navigate("/?view=normal", { replace: true });
		window.addEventListener(RETURN_TO_HUB_EVENT, handleReturnToHub);

		const game = createShellSmashGame(host, sceneData);
		return () => {
			window.removeEventListener(RETURN_TO_HUB_EVENT, handleReturnToHub);
			game.destroy(true);
			host.replaceChildren();
		};
	}, [navigate, sceneData]);

	if (!sceneData) return <Navigate to="/" replace />;

	return (
		<div
			ref={hostRef}
			className={`game-host game-host-fullscreen ${hubBackgroundClass(
				"game-host",
				hubBackground,
			)}`}
			aria-label="Shell Smash game canvas"
		/>
	);
}
