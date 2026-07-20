import {
	CurlingSnapshot,
	ShellCurlPhysicsEntity,
	ShellCurlPhysicsState,
} from "./matchmaking.types";

const SHEET_W = 1570;
const SHEET_H = 880;
const BALL_RADIUS = 28;
const BUMPER_RADIUS = 28;
const FRICTION = 0.99;
const MIN_SPEED = 8;
const WALL_DAMPING = 0.55;
const BALL_DAMPING = 0.92;
const BUMPER_BOOST = 1.1;
const DELIVERY_X = 90;
const DELIVERY_Y = SHEET_H / 2;
const DELIVERY_CLEARANCE = 10;
const MAX_TRAIL_POINTS = 40;
const PICKUP_RADIUS = 18;
const PICKUP_COUNT = 3;
const ACTIVE_POWERS = [
	"heavy", "splitter", "spinning", "rocket", "giant", "tiny", "mirror", "phantom",
] as const;

export function createShellCurlPhysicsState(matchId: string): ShellCurlPhysicsState {
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
		nextPickupEventId: 1,
		nextImpactEventId: 1,
	};
}

export function launchShellCurlProjectile(
	physics: ShellCurlPhysicsState,
	side: number,
	vx: number,
	vy: number,
	power: string,
): ShellCurlPhysicsEntity {
	physics.serverTime = Math.max(physics.serverTime, Date.now());
	const entity = createEntity(physics, side, DELIVERY_X, DELIVERY_Y, vx, vy, power);
	physics.entities.push(entity);
	applyPower(physics, entity);
	bump(physics);
	return entity;
}

/**
 * Nudge any stopped stone sitting on the delivery hack out of the way — the
 * authoritative twin of the client's `resolveDeliverySpawnBlockers` (see
 * ShellCurlScene.ts). Positions here are server truth, so unless this runs
 * server-side too, the client's own local nudge just gets overwritten by the
 * next physics snapshot and the "blocked" stone visually snaps back.
 * Returns true if anything moved (caller should re-sync the snapshot).
 */
export function resolveShellCurlSpawnBlockers(
	physics: ShellCurlPhysicsState,
): boolean {
	let moved = false;
	let slot = 0;
	for (const entity of physics.entities) {
		if (!entity.stopped) continue;
		const minDistance = entity.radius + BALL_RADIUS + DELIVERY_CLEARANCE;
		if (Math.hypot(entity.x - DELIVERY_X, entity.y - DELIVERY_Y) >= minDistance)
			continue;
		const pad = 18;
		const offset = slot++ * entity.radius * 0.45;
		entity.x = entity.radius + pad + offset;
		entity.y = SHEET_H - entity.radius - pad - offset;
		entity.vx = 0;
		entity.vy = 0;
		entity.trail = [{ x: entity.x, y: entity.y }];
		moved = true;
	}
	if (moved) bump(physics);
	return moved;
}

export function resetShellCurlPhysicsEnd(
	physics: ShellCurlPhysicsState,
	powerupsEnabled = false,
): void {
	physics.entities = [];
	physics.pickups = powerupsEnabled
		? Array.from({ length: PICKUP_COUNT }, () => createPickup(physics))
		: [];
	physics.pickupEvents = [];
	physics.impactEvents = [];
	bump(physics);
}

export function advanceShellCurlPhysics(
	physics: ShellCurlPhysicsState,
	snapshot: CurlingSnapshot,
	deltaMs: number,
): boolean {
	if (!physics.entities.some((entity) => !entity.stopped)) return false;
	const maxSpeed = Math.max(0, ...physics.entities.map((entity) => Math.hypot(entity.vx, entity.vy)));
	const minRadius = Math.max(8, Math.min(...physics.entities.map((entity) => entity.radius)));
	const substeps = Math.max(1, Math.ceil((maxSpeed * deltaMs / 1000) / (minRadius * 0.5)));
	for (let index = 0; index < substeps; index++) {
		const stepMs = deltaMs / substeps;
		for (const entity of physics.entities) {
			if (entity.stopped) continue;
			stepEntity(entity, stepMs);
			resolveBumpers(physics, entity, snapshot);
		}
		resolveEntityCollisions(physics.entities);
		collectPickups(physics, snapshot);
		applyStoppedPowers(physics);
	}
	bump(physics, deltaMs);
	return true;
}

export function syncShellCurlSnapshot(
	snapshot: CurlingSnapshot,
	physics: ShellCurlPhysicsState,
): void {
	snapshot.objects = physics.entities.map((entity) => ({
		id: entity.id,
		side: entity.ownerSide,
		type: "ball",
		ownerSide: entity.ownerSide,
		x: entity.x / SHEET_W,
		y: entity.y / SHEET_H,
		vx: entity.vx,
		vy: entity.vy,
		rotation: 0,
		angularVelocity: 0,
		moving: !entity.stopped,
		scale: entity.radius / BALL_RADIUS,
		visible: true,
		alpha: entity.power === "phantom" ? 0.52 : 1,
		spriteKey: "temple-curling-ball",
		stateFlags: [entity.stopped ? "settled" : "sliding"],
		createdAt: physics.serverTime,
		updatedAt: physics.serverTime,
		stopped: entity.stopped,
		power: entity.power,
		// R8: the per-ball trail is deliberately NOT shipped in the lifecycle
		// snapshot. It is legacy — clients rebuild trails from interpolated
		// positions (the 30 Hz physics channel already strips it), and every
		// `game:state` emit previously carried up to 40 trail points per ball to
		// every player and spectator, then deep-cloned them into replay capture.
		// Trails are absent from the `entities` copy below too.
	}));
	snapshot.entities = snapshot.objects.map((object) => ({
		...object,
		vx: object.vx ?? 0,
		vy: object.vy ?? 0,
	}));
	snapshot.activeBallId = physics.entities.find((entity) => !entity.stopped)?.id ?? null;
}

function createEntity(physics: ShellCurlPhysicsState, ownerSide: number, x: number, y: number, vx: number, vy: number, power: string): ShellCurlPhysicsEntity {
	return {
		id: physics.nextEntityId++, shotNumber: 0, primary: true, ownerSide, x, y, vx, vy, radius: BALL_RADIUS,
		rotation: 0, angularVelocity: 0, power, stopped: false, alpha: power === "phantom" ? 0.52 : 1,
		ghostCollisionAvailable: power === "ghost", frozen: false, ghostAvailable: power === "ghost", phantomHidden: power === "phantom",
		stopPowerApplied: false, boomerangTravel: 0, boomerangLimit: Math.hypot(vx, vy) * 2,
		boomerangFlipped: false, trail: [{ x, y }],
	};
}

function applyPower(physics: ShellCurlPhysicsState, entity: ShellCurlPhysicsEntity): void {
	switch (entity.power) {
		case "heavy": entity.vx *= 0.75; entity.vy *= 0.75; break;
		case "spinning": break;
		case "rocket": entity.vx *= 2; entity.vy *= 2; break;
		case "giant": entity.radius *= 2; break;
		case "tiny": entity.radius *= 0.5; entity.vx *= 1.35; entity.vy *= 1.35; break;
		case "splitter": splitEntity(physics, entity); break;
		case "mirror": physics.entities.push(createEntity(physics, entity.ownerSide, entity.x, SHEET_H - entity.y, entity.vx, -entity.vy, "none")); break;
	}
}

function collectPickups(physics: ShellCurlPhysicsState, snapshot: CurlingSnapshot): void {
	for (const entity of [...physics.entities]) {
		if (entity.stopped || entity.power !== "none") continue;
		const pickup = physics.pickups.find((candidate) =>
			Math.hypot(entity.x - candidate.x, entity.y - candidate.y) <= entity.radius + candidate.radius,
		);
		if (!pickup) continue;
		physics.pickups = physics.pickups.filter((candidate) => candidate.id !== pickup.id);
		entity.power = pickup.type;
		entity.alpha = pickup.type === "phantom" ? 0.52 : 1;
		applyPower(physics, entity);
		const used = (snapshot.usedPowersBySide[entity.ownerSide] ??= []);
		if (!used.includes(pickup.type)) used.push(pickup.type);
		physics.pickupEvents.push({
			id: physics.nextPickupEventId++, side: entity.ownerSide, type: pickup.type, x: pickup.x, y: pickup.y,
		});
		physics.pickupEvents = physics.pickupEvents.slice(-16);
	}
}

function createPickup(physics: ShellCurlPhysicsState) {
	const id = physics.nextPickupId++;
	const slot = (id - 1) % PICKUP_COUNT;
	return {
		id,
		type: ACTIVE_POWERS[(id - 1) % ACTIVE_POWERS.length],
		x: SHEET_W * (0.62 + slot * 0.04),
		y: SHEET_H * (0.25 + slot * 0.25),
		radius: PICKUP_RADIUS,
	};
}

function splitEntity(physics: ShellCurlPhysicsState, entity: ShellCurlPhysicsEntity): void {
	const speed = Math.hypot(entity.vx, entity.vy);
	const angle = Math.atan2(entity.vy, entity.vx);
	physics.entities = physics.entities.filter((candidate) => candidate !== entity);
	for (const spread of [-Math.PI / 12, 0, Math.PI / 12]) {
		const child = createEntity(physics, entity.ownerSide, entity.x, entity.y, Math.cos(angle + spread) * speed * 0.7, Math.sin(angle + spread) * speed * 0.7, "none");
		child.radius = entity.radius * 0.75;
		child.x += Math.cos(angle + spread) * child.radius * 0.45;
		child.y += Math.sin(angle + spread) * child.radius * 0.45;
		child.trail = [{ x: child.x, y: child.y }];
		physics.entities.push(child);
	}
}

function stepEntity(entity: ShellCurlPhysicsEntity, deltaMs: number): void {
	const dt = deltaMs / 1000;
	const speed = Math.hypot(entity.vx, entity.vy);
	if (entity.power === "spinning" && speed > 0.001) {
		entity.vx += (-entity.vy / speed) * 2 * speed * dt;
		entity.vy += (entity.vx / speed) * 2 * speed * dt;
	}
	if (entity.power === "vortex") {
		const dx = 1190 - entity.x;
		const dy = 440 - entity.y;
		const distance = Math.hypot(dx, dy);
		if (distance < 180 && distance > 0.001) { entity.vx += dx / distance * 40 * dt; entity.vy += dy / distance * 40 * dt; }
	}
	entity.x += entity.vx * dt;
	entity.y += entity.vy * dt;
	entity.boomerangTravel = (entity.boomerangTravel ?? 0) + speed * dt;
	if (entity.power === "boomerang" && !entity.boomerangFlipped && entity.boomerangTravel >= (entity.boomerangLimit ?? 0) * 0.6) {
		entity.boomerangFlipped = true;
		entity.vx *= -0.55;
		entity.vy *= -0.55;
	}
	resolveWall(entity);
	const friction = entity.power === "slick" ? 0.994 : entity.power === "spinning" || entity.power === "bouncer" ? 0.984 : entity.power === "giant" ? 0.982 : FRICTION;
	const factor = Math.pow(friction, deltaMs / 16.67);
	entity.vx *= factor;
	entity.vy *= factor;
	if (Math.hypot(entity.vx, entity.vy) < MIN_SPEED) { entity.vx = 0; entity.vy = 0; entity.stopped = true; entity.phantomHidden = false; }
	appendTrail(entity);
}

function resolveWall(entity: ShellCurlPhysicsEntity): void {
	const left = entity.radius, right = SHEET_W - entity.radius, top = entity.radius, bottom = SHEET_H - entity.radius;
	const damping = entity.power === "bouncer" ? 1 : WALL_DAMPING;
	if (entity.x < left) { entity.x = left; entity.vx = -entity.vx * damping; }
	else if (entity.x > right) { entity.x = right; entity.vx = -entity.vx * damping; }
	if (entity.y < top) { entity.y = top; entity.vy = -entity.vy * damping; }
	else if (entity.y > bottom) { entity.y = bottom; entity.vy = -entity.vy * damping; }
}

function resolveBumpers(physics: ShellCurlPhysicsState, entity: ShellCurlPhysicsEntity, snapshot: CurlingSnapshot): void {
	const bumpers = (snapshot.map as { bumpers?: Array<{ fx: number; fy: number }> }).bumpers ?? [];
	for (const [bumperIndex, bumper] of bumpers.entries()) {
		const x = bumper.fx * SHEET_W, y = bumper.fy * SHEET_H;
		const dx = entity.x - x, dy = entity.y - y, distance = Math.max(0.001, Math.hypot(dx, dy));
		const minimum = entity.radius + BUMPER_RADIUS;
		if (distance >= minimum) continue;
		const nx = dx / distance, ny = dy / distance;
		entity.x = x + nx * minimum; entity.y = y + ny * minimum;
		const dot = entity.vx * nx + entity.vy * ny;
		if (dot < 0) {
			entity.vx = (entity.vx - 2 * dot * nx) * BUMPER_BOOST; entity.vy = (entity.vy - 2 * dot * ny) * BUMPER_BOOST; entity.stopped = false;
			physics.impactEvents.push({ id: physics.nextImpactEventId++, kind: "bumper", entityId: entity.id, side: entity.ownerSide, objectId: bumperIndex, x, y });
			physics.impactEvents = physics.impactEvents.slice(-16);
		}
	}
}

function resolveEntityCollisions(entities: ShellCurlPhysicsEntity[]): void {
	for (let i = 0; i < entities.length; i++) for (let j = i + 1; j < entities.length; j++) {
		const a = entities[i], b = entities[j];
		if ((a.stopped && b.stopped) || a.phantomHidden || b.phantomHidden) continue;
		if (a.ghostAvailable) { a.ghostAvailable = false; continue; }
		if (b.ghostAvailable) { b.ghostAvailable = false; continue; }
		const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(0.001, Math.hypot(dx, dy)), minimum = a.radius + b.radius;
		if (distance >= minimum) continue;
		const nx = dx / distance, ny = dy / distance, overlap = minimum - distance;
		const aShare = a.frozen ? 0 : b.frozen ? 1 : 0.5, bShare = b.frozen ? 0 : a.frozen ? 1 : 0.5;
		a.x -= nx * overlap * aShare; a.y -= ny * overlap * aShare; b.x += nx * overlap * bShare; b.y += ny * overlap * bShare;
		if (a.power === "freeze") freeze(a, b);
		if (b.power === "freeze") freeze(b, a);
		const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
		if (relative > 0 || a.frozen || b.frozen) continue;
		const massA = a.power === "heavy" ? 2.5 : 1, massB = b.power === "heavy" ? 2.5 : 1;
		const impulse = 2 * relative / (massA + massB) * BALL_DAMPING;
		a.vx += impulse * massB * nx; a.vy += impulse * massB * ny; b.vx -= impulse * massA * nx; b.vy -= impulse * massA * ny;
		a.stopped = false; b.stopped = false;
	}
}

function freeze(source: ShellCurlPhysicsEntity, target: ShellCurlPhysicsEntity): void {
	if (source.ownerSide === target.ownerSide || target.frozen) return;
	target.vx = 0; target.vy = 0; target.stopped = true; target.frozen = true;
}

function applyStoppedPowers(physics: ShellCurlPhysicsState): void {
	for (const entity of physics.entities) {
		if (!entity.stopped || entity.stopPowerApplied) continue;
		entity.stopPowerApplied = true;
		if (entity.power === "shield" && Math.hypot(entity.x - 1190, entity.y - 440) <= 220) entity.power = "heavy";
		if (entity.power === "lightning") {
			const target = physics.entities.filter((candidate) => candidate.ownerSide !== entity.ownerSide).sort((a, b) => Math.hypot(a.x - entity.x, a.y - entity.y) - Math.hypot(b.x - entity.x, b.y - entity.y))[0];
			if (target) physics.entities = physics.entities.filter((candidate) => candidate !== target);
		}
		const radius = entity.power === "bomb" ? 160 : entity.power === "repel" ? 200 : entity.power === "magnet" ? 220 : 0;
		if (!radius) continue;
		for (const other of physics.entities) {
			if (other === entity || (entity.power === "magnet" && other.stopped)) continue;
			const dx = other.x - entity.x, dy = other.y - entity.y, distance = Math.hypot(dx, dy);
			if (distance >= radius || distance < 0.001) continue;
			const direction = entity.power === "magnet" ? -1 : 1;
			const impulse = (entity.power === "magnet" ? 55 : entity.power === "bomb" ? 380 : 300) * (entity.power === "magnet" ? 1 : 1 - distance / radius);
			other.vx += direction * dx / distance * impulse; other.vy += direction * dy / distance * impulse; other.stopped = false;
		}
	}
}

function appendTrail(entity: ShellCurlPhysicsEntity): void {
	const trail = (entity.trail ??= []);
	const previous = trail[trail.length - 1];
	if (!previous || Math.hypot(previous.x - entity.x, previous.y - entity.y) >= 8) trail.push({ x: entity.x, y: entity.y });
	if (trail.length > MAX_TRAIL_POINTS) trail.splice(0, trail.length - MAX_TRAIL_POINTS);
}

function bump(physics: ShellCurlPhysicsState, elapsedMs = 0): void { physics.physicsSeq += 1; physics.serverTime += elapsedMs; }
