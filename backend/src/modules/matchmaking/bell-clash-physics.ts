import {
	BellClashPhysicsEntity,
	BellClashPhysicsState,
	BellClashSnapshot,
} from "./matchmaking.types";

const ARENA_RX = 705;
const ARENA_RY = 491;
const BALL_RADIUS = 52;
const BELL_RADIUS = 150;
const WALL_BOUNCE_DAMP = 0.8;
const BELL_BOUNCE_DAMP = 0.88;
const FRICTION = 0.985;
const MIN_SPEED = 6;
const BASE_HIT_SCORE = 100;
const HIT_COOLDOWN_MS = 180;
const PICKUP_RADIUS = 20;
const PICKUP_CLEARANCE = 14;
const ACTIVE_POWERS = [
	"heavy",
	"splitter",
	"spinning",
	"rocket",
	"giant",
	"tiny",
	"mirror",
	"phantom",
] as const;

export interface BellPhysicsAdvanceResult {
	changed: boolean;
	settledSides: number[];
	scoreChanged: boolean;
}

export function createBellPhysicsState(matchId: string): BellClashPhysicsState {
	return {
		matchId,
		physicsSeq: 0,
		serverTime: Date.now(),
		entities: [],
		pickups: [],
		scoreEvents: [],
		nextEntityId: 1,
		nextPickupId: 1,
		nextScoreEventId: 1,
		bellCooldownMs: [],
	};
}

export function resetBellPhysicsRound(
	physics: BellClashPhysicsState,
	powerupsEnabled: boolean,
): void {
	physics.entities = [];
	physics.pickups = powerupsEnabled ? [createPickup(physics)] : [];
	physics.scoreEvents = [];
	physics.bellCooldownMs = [];
	bumpPhysics(physics);
}

export function launchBellProjectile(
	physics: BellClashPhysicsState,
	ownerSide: number,
	shotNumber: number,
	x: number,
	y: number,
	vx: number,
	vy: number,
	power: string,
): void {
	// Re-anchor the new interpolation timeline after an idle period. Subsequent
	// timestamps advance strictly from fixed simulation steps.
	physics.serverTime = Math.max(physics.serverTime, Date.now());
	physics.entities = physics.entities.filter(
		(entity) => entity.ownerSide !== ownerSide,
	);
	const entity = createEntity(
		physics,
		ownerSide,
		shotNumber,
		x,
		y,
		vx,
		vy,
		power,
		true,
	);
	physics.entities.push(entity);
	applyPower(physics, entity, power);
	bumpPhysics(physics);
}

export function ensureBellPhysicsPickup(
	physics: BellClashPhysicsState,
	enabled: boolean,
): void {
	if (enabled && physics.pickups.length === 0)
		physics.pickups.push(createPickup(physics));
}

export function advanceBellPhysics(
	physics: BellClashPhysicsState,
	snapshot: BellClashSnapshot,
	deltaMs: number,
): BellPhysicsAdvanceResult {
	const movingSidesBefore = movingSides(physics.entities);
	if (movingSidesBefore.size === 0)
		return { changed: false, settledSides: [], scoreChanged: false };

	let scoreChanged = false;
	const maximumSpeed = Math.max(
		0,
		...physics.entities.map((entity) => Math.hypot(entity.vx, entity.vy)),
	);
	const minimumRadius = Math.max(
		8,
		Math.min(...physics.entities.map((entity) => entity.radius)),
	);
	const substeps = Math.max(
		1,
		Math.ceil((maximumSpeed * (deltaMs / 1000)) / (minimumRadius * 0.5)),
	);
	const substepMs = deltaMs / substeps;
	for (let substep = 0; substep < substeps; substep++) {
		physics.bellCooldownMs = physics.bellCooldownMs.map((cooldown) =>
			Math.max(0, cooldown - substepMs),
		);
		for (const entity of physics.entities) {
			if (entity.stopped) continue;
			stepEntity(entity, substepMs);
			if (resolveBellCollision(entity)) {
				if ((physics.bellCooldownMs[entity.ownerSide] ?? 0) > 0) continue;
				physics.bellCooldownMs[entity.ownerSide] = HIT_COOLDOWN_MS;
				const zoneKind = zoneAt(Math.atan2(entity.y, entity.x), snapshot);
				const multiplier =
					zoneKind === "red"
						? 0.5
						: zoneKind === "yellow"
							? 1.5
							: zoneKind === "green"
								? 2
								: 1;
				const points = Math.round(BASE_HIT_SCORE * multiplier);
				snapshot.liveRoundScores[entity.ownerSide] =
					(snapshot.liveRoundScores[entity.ownerSide] ?? 0) + points;
				physics.scoreEvents.push({
					id: physics.nextScoreEventId++,
					side: entity.ownerSide,
					points,
					zoneKind,
				});
				physics.scoreEvents = physics.scoreEvents.slice(-16);
				scoreChanged = true;
			}
		}
		resolveEntityCollisions(physics.entities);
		collectPickups(physics);
	}
	const movingSidesAfter = movingSides(physics.entities);
	const settledSides = [...movingSidesBefore].filter(
		(side) => !movingSidesAfter.has(side),
	);
	bumpPhysics(physics, deltaMs);
	return { changed: true, settledSides, scoreChanged };
}

function createEntity(
	physics: BellClashPhysicsState,
	ownerSide: number,
	shotNumber: number,
	x: number,
	y: number,
	vx: number,
	vy: number,
	power: string,
	primary: boolean,
): BellClashPhysicsEntity {
	return {
		id: physics.nextEntityId++,
		ownerSide,
		shotNumber,
		primary,
		x,
		y,
		vx,
		vy,
		radius: BALL_RADIUS,
		rotation: 0,
		angularVelocity: 0,
		power,
		stopped: false,
		alpha: power === "phantom" ? 0.52 : 1,
		ghostCollisionAvailable: power === "ghost",
	};
}

function applyPower(
	physics: BellClashPhysicsState,
	entity: BellClashPhysicsEntity,
	power: string,
): void {
	switch (power) {
		case "heavy":
			entity.vx *= 0.75;
			entity.vy *= 0.75;
			break;
		case "rocket":
			entity.vx *= 2;
			entity.vy *= 2;
			break;
		case "giant":
			entity.radius *= 2;
			break;
		case "tiny":
			entity.radius *= 0.5;
			entity.vx *= 1.35;
			entity.vy *= 1.35;
			break;
		case "spinning": {
			const speed = Math.hypot(entity.vx, entity.vy);
			const angle = Math.atan2(entity.vy, entity.vx) + Math.PI / 18;
			entity.vx = Math.cos(angle) * speed;
			entity.vy = Math.sin(angle) * speed;
			break;
		}
		case "splitter":
			splitEntity(physics, entity);
			break;
		case "mirror":
			physics.entities.push({
				...entity,
				id: physics.nextEntityId++,
				primary: false,
				x: -entity.x,
				vx: -entity.vx,
			});
			break;
	}
}

function splitEntity(
	physics: BellClashPhysicsState,
	entity: BellClashPhysicsEntity,
): void {
	const speed = Math.hypot(entity.vx, entity.vy);
	const angle = Math.atan2(entity.vy, entity.vx);
	entity.radius *= 0.75;
	const offset = Math.max(1, entity.radius * 0.45);
	for (const spread of [-Math.PI / 12, Math.PI / 12]) {
		const nextAngle = angle + spread;
		physics.entities.push({
			...entity,
			id: physics.nextEntityId++,
			primary: false,
			x: entity.x + Math.cos(nextAngle) * offset,
			y: entity.y + Math.sin(nextAngle) * offset,
			vx: Math.cos(nextAngle) * speed * 0.85,
			vy: Math.sin(nextAngle) * speed * 0.85,
		});
	}
	entity.vx = Math.cos(angle) * speed * 0.85;
	entity.vy = Math.sin(angle) * speed * 0.85;
}

function stepEntity(entity: BellClashPhysicsEntity, deltaMs: number): void {
	const dt = deltaMs / 1000;
	entity.x += entity.vx * dt;
	entity.y += entity.vy * dt;
	resolveArenaWall(entity);
	const frictionBase = entity.power === "spinning" ? 0.984 : FRICTION;
	const friction = Math.pow(frictionBase, deltaMs / 16.67);
	entity.vx *= friction;
	entity.vy *= friction;
	if (entity.power === "spinning") {
		const speed = Math.hypot(entity.vx, entity.vy);
		if (speed > 0.001) {
			const curl = 4 * 0.5 * speed * dt;
			const vx = entity.vx;
			const vy = entity.vy;
			entity.vx += (-vy / speed) * curl;
			entity.vy += (vx / speed) * curl;
		}
	}
	entity.rotation += entity.angularVelocity * dt;
	if (Math.hypot(entity.vx, entity.vy) < MIN_SPEED) {
		entity.vx = 0;
		entity.vy = 0;
		entity.stopped = true;
	}
}

function resolveArenaWall(entity: BellClashPhysicsEntity): void {
	const rx = Math.max(1, ARENA_RX - entity.radius);
	const ry = Math.max(1, ARENA_RY - entity.radius);
	const ex = entity.x / rx;
	const ey = entity.y / ry;
	const distanceSquared = ex * ex + ey * ey;
	if (distanceSquared < 1) return;
	const inverse = 1 / Math.sqrt(distanceSquared);
	entity.x *= inverse;
	entity.y *= inverse;
	const rawX = entity.x / (rx * rx);
	const rawY = entity.y / (ry * ry);
	const normalLength = Math.max(0.0001, Math.hypot(rawX, rawY));
	const nx = rawX / normalLength;
	const ny = rawY / normalLength;
	const dot = entity.vx * nx + entity.vy * ny;
	entity.vx = (entity.vx - 2 * dot * nx) * WALL_BOUNCE_DAMP;
	entity.vy = (entity.vy - 2 * dot * ny) * WALL_BOUNCE_DAMP;
}

function resolveBellCollision(entity: BellClashPhysicsEntity): boolean {
	const distance = Math.max(0.001, Math.hypot(entity.x, entity.y));
	const minimum = BELL_RADIUS + entity.radius;
	if (distance >= minimum) return false;
	const nx = entity.x / distance;
	const ny = entity.y / distance;
	entity.x = nx * minimum;
	entity.y = ny * minimum;
	const dot = entity.vx * nx + entity.vy * ny;
	if (dot >= 0) return false;
	entity.vx = (entity.vx - 2 * dot * nx) * BELL_BOUNCE_DAMP;
	entity.vy = (entity.vy - 2 * dot * ny) * BELL_BOUNCE_DAMP;
	return true;
}

function resolveEntityCollisions(entities: BellClashPhysicsEntity[]): void {
	for (let i = 0; i < entities.length; i++) {
		for (let j = i + 1; j < entities.length; j++) {
			const a = entities[i];
			const b = entities[j];
			if (a.power === "phantom" || b.power === "phantom") continue;
			if (a.stopped && b.stopped) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const distance = Math.max(0.001, Math.hypot(dx, dy));
			const minimum = a.radius + b.radius;
			if (distance >= minimum) continue;
			if (a.ghostCollisionAvailable) {
				a.ghostCollisionAvailable = false;
				continue;
			}
			if (b.ghostCollisionAvailable) {
				b.ghostCollisionAvailable = false;
				continue;
			}
			const nx = dx / distance;
			const ny = dy / distance;
			const overlap = (minimum - distance) / 2;
			a.x -= nx * overlap;
			a.y -= ny * overlap;
			b.x += nx * overlap;
			b.y += ny * overlap;
			const speed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
			if (speed > 0) continue;
			a.vx += speed * nx;
			a.vy += speed * ny;
			b.vx -= speed * nx;
			b.vy -= speed * ny;
			a.stopped = false;
			b.stopped = false;
		}
	}
}

function collectPickups(physics: BellClashPhysicsState): void {
	for (const entity of [...physics.entities]) {
		if (entity.stopped) continue;
		const pickup = physics.pickups.find(
			(candidate) =>
				Math.hypot(entity.x - candidate.x, entity.y - candidate.y) <
				entity.radius + candidate.radius,
		);
		if (!pickup) continue;
		physics.pickups = physics.pickups.filter(
			(candidate) => candidate.id !== pickup.id,
		);
		entity.power = pickup.type;
		entity.alpha = pickup.type === "phantom" ? 0.52 : 1;
		applyPower(physics, entity, pickup.type);
	}
}

function createPickup(physics: BellClashPhysicsState) {
	for (let attempt = 0; attempt < 80; attempt++) {
		const angle = Math.random() * Math.PI * 2;
		const radius = Math.sqrt(Math.random());
		const x = Math.cos(angle) * (ARENA_RX - PICKUP_RADIUS) * radius;
		const y = Math.sin(angle) * (ARENA_RY - PICKUP_RADIUS) * radius;
		if (Math.hypot(x, y) < BELL_RADIUS + PICKUP_RADIUS + PICKUP_CLEARANCE)
			continue;
		return {
			id: physics.nextPickupId++,
			type: ACTIVE_POWERS[Math.floor(Math.random() * ACTIVE_POWERS.length)],
			x,
			y,
			radius: PICKUP_RADIUS,
		};
	}
	return {
		id: physics.nextPickupId++,
		type: ACTIVE_POWERS[0],
		x: ARENA_RX * 0.5,
		y: 0,
		radius: PICKUP_RADIUS,
	};
}

function movingSides(entities: BellClashPhysicsEntity[]): Set<number> {
	return new Set(
		entities
			.filter((entity) => !entity.stopped)
			.map((entity) => entity.ownerSide),
	);
}

function zoneAt(
	angle: number,
	snapshot: BellClashSnapshot,
): "red" | "yellow" | "green" | "neutral" {
	const normalized = normalizeAngle(angle);
	for (const zone of snapshot.zones) {
		const start = normalizeAngle(zone.start);
		const end = normalizeAngle(zone.end);
		const inside =
			start < end
				? normalized >= start && normalized <= end
				: normalized >= start || normalized <= end;
		if (inside) return zone.kind;
	}
	return "neutral";
}

function normalizeAngle(angle: number): number {
	return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function bumpPhysics(physics: BellClashPhysicsState, elapsedMs = 0): void {
	physics.physicsSeq += 1;
	// Physics time must advance with fixed simulation steps. Wall-clock updates
	// during catch-up batches would make client interpolation invent acceleration.
	physics.serverTime += elapsedMs;
}
