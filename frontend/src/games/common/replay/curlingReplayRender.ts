export interface CurlingReplayVelocity {
	vx: number;
	vy: number;
}

export function resolveCurlingReplayVelocity(
	current: { vx?: number; vy?: number },
	next: { vx?: number; vy?: number } | null,
	progress: number,
	scale: number,
	target: CurlingReplayVelocity = { vx: 0, vy: 0 },
): CurlingReplayVelocity {
	const currentVx = current.vx ?? 0;
	const currentVy = current.vy ?? 0;
	target.vx =
		(currentVx + ((next?.vx ?? currentVx) - currentVx) * progress) * scale;
	target.vy =
		(currentVy + ((next?.vy ?? currentVy) - currentVy) * progress) * scale;
	return target;
}
