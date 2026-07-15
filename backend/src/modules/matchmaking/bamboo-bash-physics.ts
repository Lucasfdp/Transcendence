import {
	BambooBashPhysicsEntity,
	BambooBashPhysicsState,
	BambooBashSnapshot,
} from "./matchmaking.types";

const ARENA_RX = 705;
const ARENA_RY = 491;
const BALL_RADIUS = 52;
const WALL_BOUNCE_DAMP = 0.8;
const FRICTION = 0.985;
const MIN_SPEED = 6;
const BAMBOO_RADIUS = 24;
const MAX_BAMBOO = 6;
const START_BAMBOO = 2;
const GROW_INTERVAL_MS = 5_000;
const SPAWN_EVERY_MS = 1_800;
const PICKUP_EVERY_MS = 7_000;
const PICKUP_RADIUS = 20;
const POWER_POOL = [
	"heavy",
	"splitter",
	"spinning",
	"rocket",
	"giant",
	"tiny",
	"mirror",
	"phantom",
] as const;
const STAGE_POINTS: Record<number, number> = { 1: 100, 2: 150, 3: 250 };

export function createBambooPhysicsState(matchId: string): BambooBashPhysicsState {
	return {
		matchId,
		physicsSeq: 0,
		serverTime: Date.now(),
		entities: [],
		pickups: [],
		scoreEvents: [],
		pickupEvents: [],
		nextEntityId: 1,
		nextPickupId: 1,
		nextScoreEventId: 1,
		nextPickupEventId: 1,
	};
}

export function resetBambooPhysicsRound(
	physics: BambooBashPhysicsState,
	state: BambooBashSnapshot,
): void {
	physics.entities = [];
	physics.pickups = [];
	physics.scoreEvents = [];
	physics.pickupEvents = [];
	state.bamboos = [];
	state.nextBambooId = 1;
	state.spawnAccMs = 0;
	state.powerPickupAccMs = 0;
	for (const player of state.players) {
		const position = playerSpawn(player.side, state.players.length);
		const entity = createEntity(
			physics,
			player.side,
			position.x,
			position.y,
			0,
			0,
			"none",
			true,
		);
		entity.stopped = true;
		physics.entities.push(entity);
	}
	for (let index = 0; index < START_BAMBOO; index++) spawnBamboo(state);
	if (state.powerupsEnabled)
		for (let index = 0; index < state.players.length; index++) spawnPickup(physics, state);
	syncPhysicsEntities(state, physics);
	bumpPhysics(physics);
}

export function launchBambooProjectile(
	physics: BambooBashPhysicsState,
	state: BambooBashSnapshot,
	ownerSide: number,
	x: number,
	y: number,
	vx: number,
	vy: number,
	power: string,
): void {
	physics.serverTime = Math.max(physics.serverTime, Date.now());
	physics.entities = physics.entities.filter((entity) => entity.ownerSide !== ownerSide);
	const entity = createEntity(physics, ownerSide, x, y, vx, vy, power, true);
	physics.entities.push(entity);
	applyPower(physics, entity, power);
	syncPhysicsEntities(state, physics);
	bumpPhysics(physics);
}

export function advanceBambooPhysics(
	physics: BambooBashPhysicsState,
	state: BambooBashSnapshot,
	deltaMs: number,
): boolean {
	if (state.phase !== "active") return false;
	advanceWorld(physics, state, deltaMs);
	const maximumSpeed = Math.max(0, ...physics.entities.map((entity) => Math.hypot(entity.vx, entity.vy)));
	const minimumRadius = Math.max(8, Math.min(BALL_RADIUS, ...physics.entities.map((entity) => entity.radius)));
	const substeps = Math.max(1, Math.ceil((maximumSpeed * deltaMs / 1000) / (minimumRadius * 0.5)));
	for (let index = 0; index < substeps; index++) {
		for (const entity of physics.entities) {
			if (entity.stopped) continue;
			stepEntity(entity, deltaMs / substeps);
			collectBamboos(physics, state, entity);
			collectPickups(physics, state, entity);
		}
		resolveEntityCollisions(physics.entities);
	}
	syncPhysicsEntities(state, physics);
	bumpPhysics(physics, deltaMs);
	return true;
}

export function syncPhysicsEntities(state: BambooBashSnapshot, physics: BambooBashPhysicsState): void {
	state.entities = physics.entities.map((entity) => ({
		id: entity.id, type: "projectile", side: entity.ownerSide, ownerSide: entity.ownerSide,
		x: entity.x / ARENA_RX, y: entity.y / ARENA_RY, vx: entity.vx, vy: entity.vy,
		rotation: entity.rotation, angularVelocity: entity.angularVelocity, r: entity.radius,
		power: entity.power, scale: entity.radius / BALL_RADIUS, visible: true, alpha: entity.alpha,
		spriteKey: "bamboo-bash-shell", stateFlags: [entity.stopped ? "settled" : "sliding"],
		createdAt: physics.serverTime, updatedAt: physics.serverTime, stopped: entity.stopped,
	}));
	state.balls = state.players.map((player) => state.entities.find((entity) => entity.ownerSide === player.side && physics.entities.find((candidate) => candidate.id === entity.id)?.primary)).filter((entity): entity is BambooBashSnapshot["balls"][number] => Boolean(entity));
	state.activeBallIdBySide = state.players.map((player) => physics.entities.find((entity) => entity.ownerSide === player.side && entity.primary)?.id ?? null);
	state.nextBallId = physics.nextEntityId;
	state.powerPickups = physics.pickups.map((pickup) => ({ id: pickup.id, type: pickup.type, nx: pickup.x / ARENA_RX, ny: pickup.y / ARENA_RY }));
}

function advanceWorld(physics: BambooBashPhysicsState, state: BambooBashSnapshot, deltaMs: number): void {
	for (const bamboo of state.bamboos) {
		bamboo.ageMs += deltaMs;
		bamboo.stage = Math.min(3, 1 + Math.floor(bamboo.ageMs / GROW_INTERVAL_MS));
	}
	state.spawnAccMs += deltaMs;
	while (state.spawnAccMs >= SPAWN_EVERY_MS) {
		state.spawnAccMs -= SPAWN_EVERY_MS;
		if (state.bamboos.length < MAX_BAMBOO) spawnBamboo(state);
	}
	if (!state.powerupsEnabled) return;
	state.powerPickupAccMs += deltaMs;
	while (state.powerPickupAccMs >= PICKUP_EVERY_MS) {
		state.powerPickupAccMs -= PICKUP_EVERY_MS;
		spawnPickup(physics, state);
	}
}

function createEntity(physics: BambooBashPhysicsState, ownerSide: number, x: number, y: number, vx: number, vy: number, power: string, primary: boolean): BambooBashPhysicsEntity {
	return { id: physics.nextEntityId++, ownerSide, shotNumber: 0, primary, x, y, vx, vy, radius: BALL_RADIUS, rotation: 0, angularVelocity: 0, power, stopped: false, alpha: power === "phantom" ? 0.52 : 1, ghostCollisionAvailable: power === "ghost" };
}

function applyPower(physics: BambooBashPhysicsState, entity: BambooBashPhysicsEntity, power: string): void {
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

function splitEntity(physics: BambooBashPhysicsState, entity: BambooBashPhysicsEntity): void {
	const speed = Math.hypot(entity.vx, entity.vy);
	const angle = Math.atan2(entity.vy, entity.vx);
	entity.radius *= 0.75;
	for (const spread of [-Math.PI / 12, Math.PI / 12]) {
		const nextAngle = angle + spread;
		physics.entities.push({ ...entity, id: physics.nextEntityId++, primary: false, x: entity.x + Math.cos(nextAngle) * entity.radius * 0.45, y: entity.y + Math.sin(nextAngle) * entity.radius * 0.45, vx: Math.cos(nextAngle) * speed * 0.85, vy: Math.sin(nextAngle) * speed * 0.85 });
	}
	entity.vx = Math.cos(angle) * speed * 0.85; entity.vy = Math.sin(angle) * speed * 0.85;
}

function stepEntity(entity: BambooBashPhysicsEntity, deltaMs: number): void {
	const dt = deltaMs / 1000;
	entity.x += entity.vx * dt; entity.y += entity.vy * dt;
	resolveWall(entity);
	const frictionBase = entity.power === "spinning" ? 0.984 : FRICTION;
	const friction = Math.pow(frictionBase, deltaMs / 16.67);
	entity.vx *= friction; entity.vy *= friction;
	if (entity.power === "spinning") {
		const speed = Math.hypot(entity.vx, entity.vy);
		if (speed > 0.001) { const curl = 2 * speed * dt; const vx = entity.vx; entity.vx += (-entity.vy / speed) * curl; entity.vy += (vx / speed) * curl; }
	}
	if (Math.hypot(entity.vx, entity.vy) < MIN_SPEED) { entity.vx = 0; entity.vy = 0; entity.stopped = true; }
}

function resolveWall(entity: BambooBashPhysicsEntity): void {
	const rx = Math.max(1, ARENA_RX - entity.radius); const ry = Math.max(1, ARENA_RY - entity.radius);
	const distanceSquared = (entity.x / rx) ** 2 + (entity.y / ry) ** 2;
	if (distanceSquared < 1) return;
	const inverse = 1 / Math.sqrt(distanceSquared); entity.x *= inverse; entity.y *= inverse;
	const rawX = entity.x / (rx * rx); const rawY = entity.y / (ry * ry); const length = Math.max(0.0001, Math.hypot(rawX, rawY));
	const nx = rawX / length; const ny = rawY / length; const dot = entity.vx * nx + entity.vy * ny;
	entity.vx = (entity.vx - 2 * dot * nx) * WALL_BOUNCE_DAMP; entity.vy = (entity.vy - 2 * dot * ny) * WALL_BOUNCE_DAMP;
}

function resolveEntityCollisions(entities: BambooBashPhysicsEntity[]): void {
	for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
		const a = entities[i]; const b = entities[j];
		if (a.power === "phantom" || b.power === "phantom" || (a.stopped && b.stopped)) continue;
		const dx = b.x - a.x; const dy = b.y - a.y; const distance = Math.max(0.001, Math.hypot(dx, dy)); const minimum = a.radius + b.radius;
		if (distance >= minimum) continue;
		if (a.ghostCollisionAvailable) { a.ghostCollisionAvailable = false; continue; }
		if (b.ghostCollisionAvailable) { b.ghostCollisionAvailable = false; continue; }
		const nx = dx / distance; const ny = dy / distance; const overlap = (minimum - distance) / 2;
		a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
		const speed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
		if (speed > 0) continue;
		a.vx += speed * nx; a.vy += speed * ny; b.vx -= speed * nx; b.vy -= speed * ny; a.stopped = false; b.stopped = false;
	}
}

function collectBamboos(physics: BambooBashPhysicsState, state: BambooBashSnapshot, entity: BambooBashPhysicsEntity): void {
	for (let index = state.bamboos.length - 1; index >= 0; index--) {
		const bamboo = state.bamboos[index]; const radius = BAMBOO_RADIUS * (0.7 + 0.35 * bamboo.stage);
		if (Math.hypot(entity.x - bamboo.nx * ARENA_RX, entity.y - bamboo.ny * ARENA_RY) >= entity.radius + radius) continue;
		if (entity.ghostCollisionAvailable) { entity.ghostCollisionAvailable = false; continue; }
		state.bamboos.splice(index, 1); const points = STAGE_POINTS[bamboo.stage] ?? 0;
		state.liveRoundScores[entity.ownerSide] = (state.liveRoundScores[entity.ownerSide] ?? 0) + points;
		physics.scoreEvents.push({ id: physics.nextScoreEventId++, side: entity.ownerSide, points, bambooId: bamboo.id });
		physics.scoreEvents = physics.scoreEvents.slice(-16);
	}
}

function collectPickups(physics: BambooBashPhysicsState, state: BambooBashSnapshot, entity: BambooBashPhysicsEntity): void {
	const pickup = physics.pickups.find((candidate) => Math.hypot(entity.x - candidate.x, entity.y - candidate.y) < entity.radius + candidate.radius);
	if (!pickup) return;
	physics.pickups = physics.pickups.filter((candidate) => candidate.id !== pickup.id);
	physics.pickupEvents ??= [];
	physics.pickupEvents.push({ id: physics.nextPickupEventId ?? 1, side: entity.ownerSide, type: pickup.type, x: pickup.x, y: pickup.y });
	physics.nextPickupEventId = (physics.nextPickupEventId ?? 1) + 1;
	physics.pickupEvents = physics.pickupEvents.slice(-16);
	entity.power = pickup.type; entity.alpha = pickup.type === "phantom" ? 0.52 : 1; applyPower(physics, entity, pickup.type);
	state.lastPowerBySide[entity.ownerSide] = pickup.type;
}

function spawnBamboo(state: BambooBashSnapshot): void {
	for (let attempt = 0; attempt < 24; attempt++) {
		const radius = Math.sqrt(Math.random()) * 0.82; const angle = Math.random() * Math.PI * 2; const nx = radius * Math.cos(angle); const ny = radius * Math.sin(angle);
		if (Math.hypot(nx, ny) < 0.22 || state.bamboos.some((bamboo) => Math.hypot(bamboo.nx - nx, bamboo.ny - ny) < 0.24)) continue;
		state.bamboos.push({ id: state.nextBambooId++, nx, ny, stage: 1, ageMs: 0 }); return;
	}
}

function spawnPickup(physics: BambooBashPhysicsState, state: BambooBashSnapshot): void {
	for (let attempt = 0; attempt < 80; attempt++) {
		const radius = Math.sqrt(Math.random()) * 0.88; const angle = Math.random() * Math.PI * 2; const x = radius * Math.cos(angle) * ARENA_RX; const y = radius * Math.sin(angle) * ARENA_RY;
		if (Math.hypot(x / ARENA_RX, y / ARENA_RY) < 0.14 || state.bamboos.some((bamboo) => Math.hypot(bamboo.nx * ARENA_RX - x, bamboo.ny * ARENA_RY - y) < 0.15 * ARENA_RX)) continue;
		physics.pickups.push({ id: physics.nextPickupId++, type: POWER_POOL[Math.floor(Math.random() * POWER_POOL.length)], x, y, radius: PICKUP_RADIUS }); return;
	}
}

function playerSpawn(side: number, playerCount: number): { x: number; y: number } {
	if (playerCount === 2)
		return { x: (side === 0 ? -0.22 : 0.22) * ARENA_RX, y: 0 };
	const angle = -Math.PI / 2 + (side / Math.max(1, playerCount)) * Math.PI * 2;
	return {
		x: Math.cos(angle) * ARENA_RX * 0.24,
		y: Math.sin(angle) * ARENA_RY * 0.24,
	};
}

function bumpPhysics(physics: BambooBashPhysicsState, elapsedMs = 0): void { physics.physicsSeq += 1; physics.serverTime += elapsedMs; }
