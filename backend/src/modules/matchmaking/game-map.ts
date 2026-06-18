export interface ShellCurlMap {
	gameId: "shell-curl";
	bumpers: Array<{ fx: number; fy: number }>;
}

export type GameMap = ShellCurlMap | { gameId: string };

function generateShellCurlBumpers(): ShellCurlMap["bumpers"] {
	const count = 5 + Math.floor(Math.random() * 4);
	const minSep = 0.13;
	const bumpers: ShellCurlMap["bumpers"] = [];
	let attempts = 0;

	while (bumpers.length < count && attempts < 300) {
		attempts++;
		const fx = 0.15 + Math.random() * 0.43;
		const fy = 0.1 + Math.random() * 0.8;

		const clear = bumpers.every((bumper) => {
			const dx = bumper.fx - fx;
			const dy = bumper.fy - fy;
			return Math.sqrt(dx * dx + dy * dy) >= minSep;
		});

		if (clear) bumpers.push({ fx, fy });
	}

	return bumpers;
}

export function createGameMap(gameId: string): GameMap {
	if (gameId === "shell-curl")
		return { gameId, bumpers: generateShellCurlBumpers() };
	return { gameId };
}
