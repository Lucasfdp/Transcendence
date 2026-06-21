import { useEffect, useMemo, useRef } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { RETURN_TO_HUB_EVENT } from "../features/hub/ReturnToHubScene";
import { createShellSmashGame } from "../lib/createShellSmashGame";

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
			className="game-host game-host-fullscreen"
			aria-label="Shell Smash game canvas"
		/>
	);
}
