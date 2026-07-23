export function resolveCurlingReplayVelocity(
	current: { vx?: number; vy?: number },
	next: { vx?: number; vy?: number } | null,
	progress: number,
	scale: number,
): { vx: number; vy: number } {
	const currentVx = current.vx ?? 0;
	const currentVy = current.vy ?? 0;
	return {
		vx: (currentVx + ((next?.vx ?? currentVx) - currentVx) * progress) * scale,
		vy: (currentVy + ((next?.vy ?? currentVy) - currentVy) * progress) * scale,
	};
}
