import { useEffect, useRef } from "react";
import { createShellSmashGame } from "../lib/createShellSmashGame";

export default function GamePage(): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const game = createShellSmashGame(host);
		return () => {
			game.destroy(true);
			host.replaceChildren();
			document.getElementById("ls-overlay")?.remove();
			document.getElementById("ls-styles")?.remove();
		};
	}, []);

	return (
		<div
			ref={hostRef}
			className="game-host game-host-fullscreen"
			aria-label="Shell Smash game canvas"
		/>
	);
}
