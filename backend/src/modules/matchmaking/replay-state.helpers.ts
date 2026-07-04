import {
	BallSnapshotData,
	BambooBashSnapshot,
	BellClashSnapshot,
	CurlingSnapshot,
	GameSnapshot,
	KameKnockSnapshot,
	MatchRoom,
} from "./matchmaking.types";

const ARENA_RX_SRC = 705;
const ARENA_RY_SRC = 491;
const BALL_FRICTION_BASE = 0.985;
const BALL_BOUNCE_DAMP = 0.8;
const BALL_MIN_SPEED_SRC = 6;
const BELL_SPAWN_RADIUS_NX = (150 + 52 + 118) / ARENA_RX_SRC;
const BELL_SPAWN_RADIUS_NY = (150 + 52 + 118) / ARENA_RY_SRC;

const CURL_SHEET_W_SRC = 1570;
const CURL_SHEET_H_SRC = 880;
const CURL_DELIVERY_X = 90 / CURL_SHEET_W_SRC;
const CURL_DELIVERY_Y = 0.5;
const CURL_STONE_FRICTION = 0.99;
const CURL_STONE_BOUNCE_DAMP = 0.55;
const CURL_STONE_MIN_SPEED_SRC = 8;
const CURL_STONE_RADIUS_NX = 28 / CURL_SHEET_W_SRC;
const CURL_STONE_RADIUS_NY = 28 / CURL_SHEET_H_SRC;
const CURL_STONE_TRAIL_STEP = 0.035;

type ArenaBallSnapshot =
	| KameKnockSnapshot
	| BambooBashSnapshot
	| BellClashSnapshot;

const DEFAULT_PROJECTILE_SCALE = 1;
const DEFAULT_STONE_SCALE = 1;

const POWER_SCALE: Record<string, number> = {
	giant: 2,
	tiny: 0.5,
};

const TRANSLUCENT_POWERS = new Set(["phantom", "ghost"]);

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function readNumber(
	payload: Record<string, unknown>,
	key: string,
): number | null {
	const value = Number(payload[key]);
	return Number.isFinite(value) ? value : null;
}

function getSortedSides(snapshot: {
	players: Array<{ side: number }>;
}): number[] {
	return [...snapshot.players]
		.map((player) => player.side)
		.sort((left, right) => left - right);
}

function getIndexedSpawn(side: number, sides: number[]): { x: number; y: number } {
	const index = Math.max(0, sides.indexOf(side));
	if (sides.length <= 1) return { x: 0, y: 0 };
	if (sides.length === 2) {
		return { x: index === 0 ? -0.22 : 0.22, y: 0 };
	}
	const angle = -Math.PI / 2 + (index / Math.max(1, sides.length)) * Math.PI * 2;
	return {
		x: Math.cos(angle) * 0.24,
		y: Math.sin(angle) * 0.24,
	};
}

function getBellSpawn(side: number, snapshot: BellClashSnapshot): {
	x: number;
	y: number;
} {
	const sides = getSortedSides(snapshot);
	const index = Math.max(0, sides.indexOf(side));
	const angle = -Math.PI / 2 + (index / Math.max(1, sides.length || 1)) * Math.PI * 2;
	return {
		x: Math.cos(angle) * BELL_SPAWN_RADIUS_NX,
		y: Math.sin(angle) * BELL_SPAWN_RADIUS_NY,
	};
}

function getArenaBallSpawn(
	snapshot: ArenaBallSnapshot,
	side: number,
): { x: number; y: number } {
	if (snapshot.gameId === "kame-knock") return { x: 0, y: 0 };
	if (snapshot.gameId === "bell-clash") return getBellSpawn(side, snapshot);
	return getIndexedSpawn(side, getSortedSides(snapshot));
}

function buildProjectileSpriteKey(snapshot: ArenaBallSnapshot): string {
	switch (snapshot.gameId) {
		case "kame-knock":
			return "kame-knock-shell";
		case "bell-clash":
			return "bell-clash-shell";
		default:
			return "bamboo-bash-shell";
	}
}

function ensureActiveBallSlots(snapshot: ArenaBallSnapshot): void {
	if (snapshot.activeBallIdBySide.length >= snapshot.players.length) return;
	snapshot.activeBallIdBySide = Array.from(
		{ length: snapshot.players.length },
		(_value, index) => snapshot.activeBallIdBySide[index] ?? null,
	);
}

function buildArenaProjectile(
	snapshot: ArenaBallSnapshot,
	side: number,
	values: Partial<BallSnapshotData>,
): BallSnapshotData {
	const now = Date.now();
	const spawn = getArenaBallSpawn(snapshot, side);
	return applyReplayPowerVisuals({
		id: values.id ?? snapshot.nextBallId++,
		type: "projectile",
		side,
		ownerSide: side,
		x: clamp(values.x ?? spawn.x, -1.2, 1.2),
		y: clamp(values.y ?? spawn.y, -1.2, 1.2),
		vx: values.vx ?? 0,
		vy: values.vy ?? 0,
		rotation: values.rotation ?? 0,
		angularVelocity: values.angularVelocity ?? 0,
		scale: values.scale ?? DEFAULT_PROJECTILE_SCALE,
		visible: values.visible ?? true,
		alpha: values.alpha ?? 1,
		spriteKey: values.spriteKey ?? buildProjectileSpriteKey(snapshot),
		stateFlags: values.stateFlags ?? ["active"],
		createdAt: values.createdAt ?? now,
		updatedAt: values.updatedAt ?? now,
		stopped: values.stopped ?? false,
		power: values.power ?? "none",
	});
}

function applyReplayPowerVisuals<T extends BallSnapshotData>(entity: T): T {
	const power = entity.power ?? "none";
	const powerFlags = power === "none" ? [] : [`power:${power}`];
	entity.power = power;
	entity.scale = POWER_SCALE[power] ?? entity.scale ?? DEFAULT_PROJECTILE_SCALE;
	entity.alpha = TRANSLUCENT_POWERS.has(power) ? 0.52 : entity.alpha ?? 1;
	entity.stateFlags = [
		...(entity.stateFlags ?? []),
		...powerFlags,
	].filter((flag, index, flags) => flags.indexOf(flag) === index);
	return entity;
}

function syncCurlingEntityMirror(snapshot: CurlingSnapshot): void {
	snapshot.entities = snapshot.objects.map((object) => ({
		id: object.id,
		type: "stone",
		side: object.side,
		ownerSide: object.ownerSide,
		x: object.x,
		y: object.y,
		vx: object.vx ?? 0,
		vy: object.vy ?? 0,
		rotation: object.rotation,
		angularVelocity: object.angularVelocity,
		scale: object.scale,
		visible: object.visible,
		alpha: object.alpha,
		spriteKey: object.spriteKey,
		stateFlags: [...object.stateFlags],
		createdAt: object.createdAt,
		updatedAt: object.updatedAt,
		stopped: object.stopped,
		power: object.power,
		...(object.trail?.length ? { trail: object.trail.map((point) => ({ ...point })) } : {}),
	}));
}

function getActiveArenaProjectile(
	snapshot: ArenaBallSnapshot,
	side: number,
): BallSnapshotData | null {
	ensureActiveBallSlots(snapshot);
	const activeId = snapshot.activeBallIdBySide[side] ?? null;
	if (activeId !== null) {
		const active = snapshot.entities.find(
			(entity) => entity.type === "projectile" && entity.id === activeId,
		);
		if (active) return active as BallSnapshotData;
	}

	const latest = [...snapshot.entities]
		.reverse()
		.find(
			(entity) =>
				entity.type === "projectile" && entity.ownerSide === side,
		);
	return (latest as BallSnapshotData | undefined) ?? null;
}

function syncArenaProjectileMirror(
	snapshot: ArenaBallSnapshot,
	projectile: BallSnapshotData,
): void {
	const mirrorIndex = snapshot.balls.findIndex((ball) => ball.side === projectile.side);
	const mirror: BallSnapshotData = {
		...projectile,
		stateFlags: [...projectile.stateFlags],
	};
	if (mirrorIndex >= 0) snapshot.balls[mirrorIndex] = mirror;
	else snapshot.balls.push(mirror);
}

function upsertArenaBall(
	snapshot: ArenaBallSnapshot,
	side: number,
	values: Partial<BallSnapshotData>,
): void {
	const now = Date.now();
	ensureActiveBallSlots(snapshot);
	let projectile = getActiveArenaProjectile(snapshot, side);
	if (!projectile || values.id !== undefined) {
		projectile = buildArenaProjectile(snapshot, side, values);
		const existingIndex = snapshot.entities.findIndex(
			(entity) => entity.type === "projectile" && entity.id === projectile.id,
		);
		if (existingIndex >= 0) snapshot.entities[existingIndex] = projectile;
		else snapshot.entities.push(projectile);
		snapshot.activeBallIdBySide[side] = projectile.id;
		syncArenaProjectileMirror(snapshot, projectile);
		return;
	}

	if (isFiniteNumber(values.x)) projectile.x = clamp(values.x, -1.2, 1.2);
	if (isFiniteNumber(values.y)) projectile.y = clamp(values.y, -1.2, 1.2);
	if (isFiniteNumber(values.vx)) projectile.vx = values.vx;
	if (isFiniteNumber(values.vy)) projectile.vy = values.vy;
	if (isFiniteNumber(values.rotation)) projectile.rotation = values.rotation;
	if (isFiniteNumber(values.angularVelocity))
		projectile.angularVelocity = values.angularVelocity;
	if (isFiniteNumber(values.scale)) projectile.scale = values.scale;
	if (typeof values.visible === "boolean") projectile.visible = values.visible;
	if (isFiniteNumber(values.alpha)) projectile.alpha = values.alpha;
	if (typeof values.power === "string") projectile.power = values.power;
	if (Array.isArray(values.stateFlags))
		projectile.stateFlags = [...values.stateFlags];
	if (typeof values.spriteKey === "string") projectile.spriteKey = values.spriteKey;
	if (typeof values.stopped === "boolean") projectile.stopped = values.stopped;
	projectile.updatedAt = now;
	applyReplayPowerVisuals(projectile);
	syncArenaProjectileMirror(snapshot, projectile);
}

function applyArenaBallPayload(
	snapshot: ArenaBallSnapshot,
	side: number,
	payload: Record<string, unknown>,
): boolean {
	const x = readNumber(payload, "x");
	const y = readNumber(payload, "y");
	const vx = readNumber(payload, "vx");
	const vy = readNumber(payload, "vy");
	// Ball owners self-report whether their own ball has come to rest — this is
	// the only reliable "stopped" signal for games (Bamboo Bash) that never
	// call settleArenaReplayBall. upsertArenaBall() already knows how to apply
	// a boolean `stopped`; relaying the client's report through here lets the
	// opponent's client trust it instead of re-deriving movement from its own
	// independent local physics simulation.
	const stopped =
		typeof payload.stopped === "boolean" ? payload.stopped : undefined;
	if (
		x === null &&
		y === null &&
		vx === null &&
		vy === null &&
		stopped === undefined
	)
		return false;
	upsertArenaBall(snapshot, side, {
		x: x ?? undefined,
		y: y ?? undefined,
		vx: vx ?? undefined,
		vy: vy ?? undefined,
		stopped,
	});
	return true;
}

export function initializeArenaReplayBall(
	snapshot: ArenaBallSnapshot,
	side: number,
	vx: number,
	vy: number,
	position?: { x?: number; y?: number },
	power = "none",
): void {
	const spawn = getArenaBallSpawn(snapshot, side);
	upsertArenaBall(snapshot, side, {
		x: position?.x ?? spawn.x,
		y: position?.y ?? spawn.y,
		vx: Number.isFinite(vx) ? vx : 0,
		vy: Number.isFinite(vy) ? vy : 0,
		rotation: 0,
		angularVelocity: 0,
		power,
		stateFlags: power === "none" ? ["launched"] : ["launched", `power:${power}`],
		stopped: false,
	});
}

export function syncArenaReplayBallFromPayload(
	snapshot: ArenaBallSnapshot,
	side: number,
	payload: Record<string, unknown>,
): boolean {
	return applyArenaBallPayload(snapshot, side, payload);
}

export function settleArenaReplayBall(
	snapshot: ArenaBallSnapshot,
	side: number,
	payload: Record<string, unknown>,
): void {
	const synced = applyArenaBallPayload(snapshot, side, payload);
	if (!synced) {
		upsertArenaBall(snapshot, side, {
			vx: 0,
			vy: 0,
			stopped: true,
			stateFlags: ["settled"],
		});
		return;
	}
	upsertArenaBall(snapshot, side, {
		vx: 0,
		vy: 0,
		stopped: true,
		stateFlags: ["settled"],
	});
}

export function resetArenaReplayBalls(
	snapshot: ArenaBallSnapshot,
	options?: { clearEntities?: boolean },
): void {
	snapshot.balls = snapshot.players.map((player) => {
		const spawn = getArenaBallSpawn(snapshot, player.side);
		return buildArenaProjectile(snapshot, player.side, {
			id: player.side + 1,
			x: spawn.x,
			y: spawn.y,
			vx: 0,
			vy: 0,
			visible: true,
			alpha: 1,
			stateFlags: ["idle"],
			stopped: true,
		});
	});
	snapshot.activeBallIdBySide = Array.from(
		{ length: snapshot.players.length },
		() => null,
	);
	snapshot.nextBallId = snapshot.players.length + 1;
	if (options?.clearEntities ?? true) snapshot.entities = [];
}

export function initializeCurlingReplayStone(
	snapshot: CurlingSnapshot,
	id: number,
	side: number,
	vx: number,
	vy: number,
	power: string,
): void {
	const existingIndex = snapshot.objects.findIndex((object) => object.id === id);
	const now = Date.now();
	const base = {
		id,
		side,
		type: "stone" as const,
		ownerSide: side,
		x: CURL_DELIVERY_X,
		y: CURL_DELIVERY_Y,
		vx: Number.isFinite(vx) ? vx : 0,
		vy: Number.isFinite(vy) ? vy : 0,
		rotation: 0,
		angularVelocity: 0,
		moving: true,
		scale: POWER_SCALE[power] ?? DEFAULT_STONE_SCALE,
		visible: true,
		alpha: TRANSLUCENT_POWERS.has(power) ? 0.52 : 1,
		spriteKey: "temple-curling-stone",
		stateFlags: power === "none" ? ["launched"] : ["launched", `power:${power}`],
		createdAt: now,
		updatedAt: now,
		stopped: false,
		power,
		trail: [{ x: CURL_DELIVERY_X, y: CURL_DELIVERY_Y }],
	};
	if (existingIndex >= 0) snapshot.objects[existingIndex] = base;
	else snapshot.objects.push(base);
	syncCurlingEntityMirror(snapshot);
	snapshot.activeStoneId = id;
}

function sanitizeTrailPoint(
	point: unknown,
): { x: number; y: number } | null {
	if (!point || typeof point !== "object") return null;
	const raw = point as Record<string, unknown>;
	const x = Number(raw.x);
	const y = Number(raw.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

export function syncCurlingReplayStateFromPayload(
	snapshot: CurlingSnapshot,
	payload: Record<string, unknown>,
): boolean {
	const objects = Array.isArray(payload.objects) ? payload.objects : null;
	if (!objects) return false;

	snapshot.objects = objects
		.map((object) => {
			if (!object || typeof object !== "object") return null;
			const raw = object as Record<string, unknown>;
			const id = Number(raw.id);
			const side = Number(raw.side);
			const x = Number(raw.x);
			const y = Number(raw.y);
			if (
				!Number.isFinite(id) ||
				!Number.isFinite(side) ||
				!Number.isFinite(x) ||
				!Number.isFinite(y)
			)
				return null;
			const vx = readNumber(raw, "vx");
			const vy = readNumber(raw, "vy");
			const moving =
				Boolean(raw.moving) ||
				Math.abs(vx ?? 0) > 0.001 ||
				Math.abs(vy ?? 0) > 0.001;
			const now = Date.now();
			return {
				id,
				side,
				type: "stone" as const,
				ownerSide: side,
				x: clamp(x, 0, 1),
				y: clamp(y, 0, 1),
				vx: vx ?? 0,
				vy: vy ?? 0,
				rotation: readNumber(raw, "rotation") ?? 0,
				angularVelocity: readNumber(raw, "angularVelocity") ?? 0,
				moving,
				scale: readNumber(raw, "scale") ?? DEFAULT_STONE_SCALE,
				visible: raw.visible !== false,
				alpha: readNumber(raw, "alpha") ?? 1,
				spriteKey: String(raw.spriteKey ?? "temple-curling-stone"),
				stateFlags: Array.isArray(raw.stateFlags)
					? raw.stateFlags.filter((flag): flag is string => typeof flag === "string")
					: [moving ? "sliding" : "settled"],
				createdAt: readNumber(raw, "createdAt") ?? now,
				updatedAt: now,
				stopped: Boolean(raw.stopped) || !moving,
				power: String(raw.power ?? "none"),
				trail: Array.isArray(raw.trail)
					? raw.trail
							.map((point) => sanitizeTrailPoint(point))
							.filter((point): point is { x: number; y: number } => point !== null)
					: undefined,
			};
		})
		.filter((object) => object !== null) as CurlingSnapshot["objects"];
	syncCurlingEntityMirror(snapshot);
	snapshot.activeStoneId =
		snapshot.objects.find((object) => object.moving)?.id ?? null;
	return true;
}

function isArenaBallMoving(ball: BallSnapshotData): boolean {
	return Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1;
}

function stepArenaBall(ball: BallSnapshotData, deltaMs: number): boolean {
	const wasMoving = isArenaBallMoving(ball);
	if (!wasMoving) return false;

	const dt = deltaMs / 1000;
	ball.x += (ball.vx * dt) / ARENA_RX_SRC;
	ball.y += (ball.vy * dt) / ARENA_RY_SRC;

	const ex = ball.x;
	const ey = ball.y;
	const distSq = ex * ex + ey * ey;
	if (distSq >= 1) {
		const inv = 1 / Math.sqrt(distSq);
		ball.x *= inv;
		ball.y *= inv;

		const nRawX = ball.x;
		const nRawY = ball.y;
		const nLen = Math.max(0.0001, Math.hypot(nRawX, nRawY));
		const nx = nRawX / nLen;
		const ny = nRawY / nLen;
		const dot = ball.vx * nx + ball.vy * ny;
		ball.vx = (ball.vx - 2 * dot * nx) * BALL_BOUNCE_DAMP;
		ball.vy = (ball.vy - 2 * dot * ny) * BALL_BOUNCE_DAMP;
	}

	const friction = Math.pow(BALL_FRICTION_BASE, deltaMs / 16.67);
	ball.vx *= friction;
	ball.vy *= friction;
	ball.rotation += ball.angularVelocity * (deltaMs / 1000);
	ball.updatedAt = Date.now();
	if (Math.hypot(ball.vx, ball.vy) < BALL_MIN_SPEED_SRC) {
		ball.vx = 0;
		ball.vy = 0;
		ball.stopped = true;
		ball.stateFlags = ["settled"];
		return true;
	}
	ball.stopped = false;
	ball.stateFlags = ["sliding"];
	return true;
}

function updateCurlingTrail(object: CurlingSnapshot["objects"][number]): void {
	const trail = object.trail ?? [];
	const last = trail[trail.length - 1];
	if (!last || Math.hypot(last.x - object.x, last.y - object.y) >= CURL_STONE_TRAIL_STEP) {
		trail.push({ x: object.x, y: object.y });
		object.trail = trail.slice(-80);
	}
}

function stepCurlingObject(
	object: CurlingSnapshot["objects"][number],
	deltaMs: number,
): boolean {
	const vx = object.vx ?? 0;
	const vy = object.vy ?? 0;
	const wasMoving =
		Boolean(object.moving) || Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1;
	if (!wasMoving) return false;

	const dt = deltaMs / 1000;
	object.x = clamp(object.x + (vx * dt) / CURL_SHEET_W_SRC, 0, 1);
	object.y = clamp(object.y + (vy * dt) / CURL_SHEET_H_SRC, 0, 1);

	let nextVx = vx;
	let nextVy = vy;
	const leftWall = CURL_STONE_RADIUS_NX;
	const rightWall = 1 - CURL_STONE_RADIUS_NX;
	const topWall = CURL_STONE_RADIUS_NY;
	const bottomWall = 1 - CURL_STONE_RADIUS_NY;

	if (object.x <= leftWall || object.x >= rightWall) {
		object.x = clamp(object.x, leftWall, rightWall);
		nextVx = -nextVx * CURL_STONE_BOUNCE_DAMP;
	}
	if (object.y <= topWall || object.y >= bottomWall) {
		object.y = clamp(object.y, topWall, bottomWall);
		nextVy = -nextVy * CURL_STONE_BOUNCE_DAMP;
	}

	const friction = Math.pow(CURL_STONE_FRICTION, deltaMs / 16.67);
	nextVx *= friction;
	nextVy *= friction;
	object.vx = nextVx;
	object.vy = nextVy;
	object.rotation += object.angularVelocity * (deltaMs / 1000);
	object.updatedAt = Date.now();
	if (Math.hypot(nextVx, nextVy) < CURL_STONE_MIN_SPEED_SRC) {
		object.vx = 0;
		object.vy = 0;
		object.moving = false;
		object.stopped = true;
		object.stateFlags = ["settled"];
		updateCurlingTrail(object);
		return true;
	}

	object.moving = true;
	object.stopped = false;
	object.stateFlags = ["sliding"];
	updateCurlingTrail(object);
	return true;
}

function advanceSnapshot(snapshot: GameSnapshot, deltaMs: number): boolean {
	if ("balls" in snapshot) {
		const changed = snapshot.entities.some(
			(entity) => entity.type === "projectile" && stepArenaBall(entity as BallSnapshotData, deltaMs),
		);
		for (const side of snapshot.players.map((player) => player.side)) {
			const active = getActiveArenaProjectile(snapshot, side);
			if (active) syncArenaProjectileMirror(snapshot, active);
		}
		return changed;
	}
	if ("objects" in snapshot) {
		const changed = snapshot.objects.some((object) => stepCurlingObject(object, deltaMs));
		snapshot.activeStoneId =
			snapshot.objects.find((object) => object.moving)?.id ?? null;
		return changed;
	}
	return false;
}

function hasSnapshotMotion(snapshot: GameSnapshot): boolean {
	if ("balls" in snapshot) {
		return snapshot.entities.some(
			(entity) =>
				entity.type === "projectile" &&
				isArenaBallMoving(entity as BallSnapshotData),
		);
	}
	if ("objects" in snapshot) {
		return snapshot.objects.some(
			(object) =>
				Boolean(object.moving) ||
				Math.abs(object.vx ?? 0) > 0.1 ||
				Math.abs(object.vy ?? 0) > 0.1,
		);
	}
	return false;
}

export function advanceReplaySimulation(room: MatchRoom, now = Date.now()): boolean {
	if (!hasSnapshotMotion(room.state)) {
		room.replayLastSimulationAt = null;
		return false;
	}

	if (room.replayLastSimulationAt === null) {
		room.replayLastSimulationAt = now;
		return false;
	}

	const deltaMs = Math.max(0, Math.min(250, now - room.replayLastSimulationAt));
	room.replayLastSimulationAt = now;
	if (deltaMs <= 0) return false;

	const changed = advanceSnapshot(room.state, deltaMs);
	if (changed) room.state.seq = ++room.seq;
	if (!hasSnapshotMotion(room.state)) room.replayLastSimulationAt = null;
	return changed;
}

export function markReplaySimulation(room: MatchRoom): void {
	room.replayLastSimulationAt = Date.now();
}
