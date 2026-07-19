import {
	KameKnockPhysicsEntity,
	KameKnockPhysicsState,
	KameKnockSnapshot,
} from "./matchmaking.types";

const ARENA_RX = 705;
const ARENA_RY = 491;
const BALL_RADIUS = 52;
const FRICTION = 0.985;
const MIN_SPEED = 6;
const WALL_BOUNCE_DAMP = 0.8;
const SOLID_BOUNCE_DAMP = 0.92;
const HIT_KNOCKBACK = 90;
const PERFECT_ACCURACY = 0.35;
const PERFECT_BONUS = 500;
const PICKUP_RADIUS = 20;
const ACTIVE_POWERS = [
	"heavy", "splitter", "spinning", "rocket", "giant", "tiny", "mirror", "phantom",
] as const;

export function createKamePhysicsState(matchId: string): KameKnockPhysicsState {
	return {
		matchId,
		physicsSeq: 0,
		serverTime: Date.now(),
		entities: [],
		pickups: [],
		scoreEvents: [],
		pickupEvents: [],
		impactEvents: [],
		nextEntityId: 1,
		nextPickupId: 1,
		nextScoreEventId: 1,
		nextPickupEventId: 1,
		nextImpactEventId: 1,
		combo: 0,
		settledProjectionPending: false,
	};
}

export function resetKamePhysicsTurn(
	physics: KameKnockPhysicsState,
	powerupsEnabled: boolean,
): void {
	physics.entities = [];
	physics.pickups = powerupsEnabled ? [createPickup(physics)] : [];
	physics.scoreEvents = [];
	physics.pickupEvents = [];
	physics.impactEvents = [];
	physics.combo = 0;
	physics.settledProjectionPending = false;
	bump(physics);
}

export function launchKameProjectile(
	physics: KameKnockPhysicsState,
	side: number,
	turnNumber: number,
	vx: number,
	vy: number,
	power: string,
): void {
	physics.serverTime = Math.max(physics.serverTime, Date.now());
	physics.entities = [];
	physics.combo = 0;
	physics.settledProjectionPending = false;
	const entity = createEntity(physics, side, turnNumber, 0, 0, vx, vy, power, true);
	physics.entities.push(entity);
	applyPower(physics, entity, power);
	bump(physics);
}

export function advanceKamePhysics(
	physics: KameKnockPhysicsState,
	snapshot: KameKnockSnapshot,
	deltaMs: number,
): boolean {
	if (!physics.entities.some((entity) => !entity.stopped)) return false;
	const maximumSpeed = Math.max(...physics.entities.map((entity) => Math.hypot(entity.vx, entity.vy)));
	const minimumRadius = Math.max(8, Math.min(...physics.entities.map((entity) => entity.radius)));
	const substeps = Math.max(1, Math.ceil((maximumSpeed * deltaMs / 1000) / (minimumRadius * 0.5)));
	for (let step = 0; step < substeps; step++) {
		const substepMs = deltaMs / substeps;
		for (const entity of physics.entities) {
			if (entity.stopped) continue;
			stepEntity(entity, substepMs);
			resolveTargets(physics, snapshot, entity);
		}
		resolveEntityCollisions(physics.entities);
		collectPickups(physics);
	}
	bump(physics, deltaMs);
	return true;
}

export function allKameProjectilesSettled(physics: KameKnockPhysicsState): boolean {
	return physics.entities.length > 0 && physics.entities.every((entity) => entity.stopped);
}

function createEntity(physics: KameKnockPhysicsState, ownerSide: number, turnNumber: number, x: number, y: number, vx: number, vy: number, power: string, primary: boolean): KameKnockPhysicsEntity {
	return { id: physics.nextEntityId++, ownerSide, turnNumber, shotNumber: turnNumber, primary, x, y, vx, vy, radius: BALL_RADIUS, rotation: 0, angularVelocity: 0, power, stopped: false, alpha: power === "phantom" ? 0.52 : 1, ghostCollisionAvailable: power === "phantom" };
}

function applyPower(physics: KameKnockPhysicsState, entity: KameKnockPhysicsEntity, power: string): void {
	switch (power) {
		case "heavy": entity.vx *= 0.75; entity.vy *= 0.75; break;
		case "rocket": entity.vx *= 2; entity.vy *= 2; break;
		case "giant": entity.radius *= 2; break;
		case "tiny": entity.radius *= 0.5; entity.vx *= 1.35; entity.vy *= 1.35; break;
		case "spinning": {
			const speed = Math.hypot(entity.vx, entity.vy);
			const angle = Math.atan2(entity.vy, entity.vx) + Math.PI / 18;
			entity.vx = Math.cos(angle) * speed; entity.vy = Math.sin(angle) * speed;
			break;
		}
		case "splitter": splitEntity(physics, entity); break;
		case "mirror": physics.entities.push({ ...entity, id: physics.nextEntityId++, primary: false, x: -entity.x, vx: -entity.vx }); break;
	}
}

function splitEntity(physics: KameKnockPhysicsState, entity: KameKnockPhysicsEntity): void {
	const speed = Math.hypot(entity.vx, entity.vy);
	const angle = Math.atan2(entity.vy, entity.vx);
	entity.radius *= 0.75;
	for (const spread of [-Math.PI / 12, Math.PI / 12]) {
		const next = angle + spread;
		physics.entities.push({ ...entity, id: physics.nextEntityId++, primary: false, x: entity.x + Math.cos(next) * entity.radius * 0.45, y: entity.y + Math.sin(next) * entity.radius * 0.45, vx: Math.cos(next) * speed * 0.85, vy: Math.sin(next) * speed * 0.85 });
	}
	entity.vx = Math.cos(angle) * speed * 0.85;
	entity.vy = Math.sin(angle) * speed * 0.85;
}

function stepEntity(entity: KameKnockPhysicsEntity, deltaMs: number): void {
	const dt = deltaMs / 1000;
	entity.x += entity.vx * dt; entity.y += entity.vy * dt;
	resolveWall(entity);
	const friction = Math.pow(entity.power === "spinning" ? 0.984 : FRICTION, deltaMs / 16.67);
	entity.vx *= friction; entity.vy *= friction;
	if (entity.power === "spinning") {
		const speed = Math.hypot(entity.vx, entity.vy);
		if (speed > 0.001) { const curl = 2 * speed * dt; const vx = entity.vx; entity.vx += (-entity.vy / speed) * curl; entity.vy += (vx / speed) * curl; }
	}
	if (Math.hypot(entity.vx, entity.vy) < MIN_SPEED) { entity.vx = 0; entity.vy = 0; entity.stopped = true; }
}

function resolveWall(entity: KameKnockPhysicsEntity): void {
	const rx = ARENA_RX - entity.radius; const ry = ARENA_RY - entity.radius;
	const length = Math.hypot(entity.x / rx, entity.y / ry);
	if (length < 1) return;
	entity.x /= length; entity.y /= length;
	const rawX = entity.x / (rx * rx); const rawY = entity.y / (ry * ry);
	const normal = Math.max(0.0001, Math.hypot(rawX, rawY)); const nx = rawX / normal; const ny = rawY / normal;
	const dot = entity.vx * nx + entity.vy * ny;
	entity.vx = (entity.vx - 2 * dot * nx) * WALL_BOUNCE_DAMP; entity.vy = (entity.vy - 2 * dot * ny) * WALL_BOUNCE_DAMP;
}

function resolveTargets(physics: KameKnockPhysicsState, snapshot: KameKnockSnapshot, entity: KameKnockPhysicsEntity): void {
	for (let index = snapshot.targets.length - 1; index >= 0; index--) {
		const target = snapshot.targets[index]; const x = target.nx * ARENA_RX; const y = target.ny * ARENA_RY;
		const distance = Math.max(0.001, Math.hypot(entity.x - x, entity.y - y)); const minimum = entity.radius + target.radiusSrc;
		if (distance >= minimum) continue;
		if (!target.breakable) {
			if (bounceTarget(entity, x, y, target.radiusSrc, distance)) {
				physics.impactEvents.push({ id: physics.nextImpactEventId++, kind: "solid-target", entityId: entity.id, side: entity.ownerSide, objectId: target.id, x, y });
				physics.impactEvents = physics.impactEvents.slice(-16);
			}
			continue;
		}
		if (entity.ghostCollisionAvailable) { entity.ghostCollisionAvailable = false; continue; }
		snapshot.targets.splice(index, 1);
		physics.combo += 1;
		const perfect = distance / Math.max(1, target.radiusSrc) <= PERFECT_ACCURACY;
		const points = target.points * physics.combo + (perfect ? PERFECT_BONUS : 0);
		snapshot.score[entity.ownerSide] = (snapshot.score[entity.ownerSide] ?? 0) + points;
		snapshot.roundScores[entity.ownerSide] = (snapshot.roundScores[entity.ownerSide] ?? 0) + points;
		physics.scoreEvents.push({ id: physics.nextScoreEventId++, side: entity.ownerSide, targetId: target.id, targetKind: target.kind, points, combo: physics.combo, perfect, x, y });
		physics.scoreEvents = physics.scoreEvents.slice(-16);
		const nx = (entity.x - x) / distance; const ny = (entity.y - y) / distance;
		entity.vx += nx * HIT_KNOCKBACK; entity.vy += ny * HIT_KNOCKBACK; entity.stopped = false;
	}
}

function bounceTarget(entity: KameKnockPhysicsEntity, x: number, y: number, radius: number, distance: number): boolean {
	const nx = (entity.x - x) / distance; const ny = (entity.y - y) / distance;
	entity.x = x + nx * (entity.radius + radius); entity.y = y + ny * (entity.radius + radius);
	const dot = entity.vx * nx + entity.vy * ny;
	if (dot >= 0) return false;
	entity.vx = (entity.vx - 2 * dot * nx) * SOLID_BOUNCE_DAMP; entity.vy = (entity.vy - 2 * dot * ny) * SOLID_BOUNCE_DAMP;
	return true;
}

function resolveEntityCollisions(entities: KameKnockPhysicsEntity[]): void {
	for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
		const a = entities[i]; const b = entities[j]; if (a.stopped && b.stopped) continue;
		const dx = b.x - a.x; const dy = b.y - a.y; const distance = Math.max(0.001, Math.hypot(dx, dy)); const minimum = a.radius + b.radius;
		if (distance >= minimum) continue;
		if (a.ghostCollisionAvailable) { a.ghostCollisionAvailable = false; continue; }
		if (b.ghostCollisionAvailable) { b.ghostCollisionAvailable = false; continue; }
		const nx = dx / distance; const ny = dy / distance; const overlap = (minimum - distance) / 2;
		a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
		const speed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
		if (speed <= 0) { a.vx += speed * nx; a.vy += speed * ny; b.vx -= speed * nx; b.vy -= speed * ny; a.stopped = false; b.stopped = false; }
	}
}

function collectPickups(physics: KameKnockPhysicsState): void {
	for (const entity of physics.entities) {
		if (entity.stopped) continue;
		const pickup = physics.pickups.find((candidate) => Math.hypot(entity.x - candidate.x, entity.y - candidate.y) < entity.radius + candidate.radius);
		if (!pickup) continue;
		physics.pickups = physics.pickups.filter((candidate) => candidate.id !== pickup.id);
		physics.pickupEvents?.push({ id: physics.nextPickupEventId ?? 1, side: entity.ownerSide, type: pickup.type, x: pickup.x, y: pickup.y });
		physics.nextPickupEventId = (physics.nextPickupEventId ?? 1) + 1;
		physics.pickupEvents = physics.pickupEvents?.slice(-16);
		entity.power = pickup.type; entity.alpha = pickup.type === "phantom" ? 0.52 : 1; applyPower(physics, entity, pickup.type);
	}
}

function createPickup(physics: KameKnockPhysicsState) {
	const type = ACTIVE_POWERS[Math.floor(Math.random() * ACTIVE_POWERS.length)] ?? "heavy";
	for (let attempt = 0; attempt < 80; attempt++) {
		const angle = Math.random() * Math.PI * 2; const radius = Math.sqrt(Math.random()); const x = Math.cos(angle) * (ARENA_RX - PICKUP_RADIUS) * radius; const y = Math.sin(angle) * (ARENA_RY - PICKUP_RADIUS) * radius;
		if (Math.hypot(x, y) > BALL_RADIUS + PICKUP_RADIUS + 14) return { id: physics.nextPickupId++, type, x, y, radius: PICKUP_RADIUS };
	}
	return { id: physics.nextPickupId++, type, x: ARENA_RX * 0.5, y: 0, radius: PICKUP_RADIUS };
}

function bump(physics: KameKnockPhysicsState, elapsedMs = 0): void { physics.physicsSeq += 1; physics.serverTime += elapsedMs; }
