export interface PowerPickupEntry {
	id: number;
	type: string;
	nx: number;
	ny: number;
}

export interface PowerPickupState {
	usedPowersBySide: string[][];
	lastPowerBySide: string[];
	lastPowerPickupIdBySide: Array<number | null>;
	powerPickups: PowerPickupEntry[];
	nextPowerPickupId: number;
	powerPickupAccMs: number;
}

const POWER_POOL = [
	"heavy",
	"splitter",
	"spinning",
	"rocket",
	"giant",
	"tiny",
	"mirror",
	"phantom",
];

const ALLOWED_POWERS = new Set(["none", ...POWER_POOL]);

export function initPowerPickups(
	playerCount: number,
	powerupsEnabled: boolean,
	spawnCount: number,
): PowerPickupState {
	const state: PowerPickupState = {
		usedPowersBySide: Array.from({ length: playerCount }, () => []),
		lastPowerBySide: Array.from({ length: playerCount }, () => "none"),
		lastPowerPickupIdBySide: Array.from(
			{ length: playerCount },
			() => null,
		),
		powerPickups: [],
		nextPowerPickupId: 1,
		powerPickupAccMs: 0,
	};
	if (powerupsEnabled) {
		for (let i = 0; i < spawnCount; i++) {
			const pickup = spawnOnePowerPickup(state);
			if (pickup) state.powerPickups.push(pickup);
		}
	}
	return state;
}

export function tickPowerPickups(
	pickups: PowerPickupEntry[],
	nextId: number,
	accMs: number,
	deltaMs: number,
	intervalMs: number,
): { pickups: PowerPickupEntry[]; nextId: number; accMs: number } {
	accMs += deltaMs;
	while (accMs >= intervalMs) {
		accMs -= intervalMs;
		const newPickup = createRandomPickup(nextId);
		if (newPickup) {
			pickups = [...pickups, newPickup];
			nextId++;
		}
	}
	return { pickups, nextId, accMs };
}

export function tryConsumePowerPickup(
	pickups: PowerPickupEntry[],
	side: number,
	pickupId: number,
	usedPowersBySide: string[][],
	lastPowerBySide: string[],
	lastPowerPickupIdBySide: Array<number | null>,
): {
	pickups: PowerPickupEntry[];
	usedPowersBySide: string[][];
	lastPowerBySide: string[];
	lastPowerPickupIdBySide: Array<number | null>;
	power: string | null;
} {
	const index = pickups.findIndex((p) => p.id === pickupId);
	if (index < 0) {
		return {
			pickups,
			usedPowersBySide,
			lastPowerBySide,
			lastPowerPickupIdBySide,
			power: null,
		};
	}
	const power = pickups[index].type;
	pickups = [...pickups];
	pickups.splice(index, 1);
	const newUsed = [...usedPowersBySide];
	newUsed[side] = [...(newUsed[side] ?? [])];
	newUsed[side].push(power);
	const newLastPower = [...lastPowerBySide];
	newLastPower[side] = power;
	const newLastId = [...lastPowerPickupIdBySide];
	newLastId[side] = pickupId;
	return {
		pickups,
		usedPowersBySide: newUsed,
		lastPowerBySide: newLastPower,
		lastPowerPickupIdBySide: newLastId,
		power,
	};
}

export function resetPowerPickups(playerCount: number): PowerPickupState {
	return {
		usedPowersBySide: Array.from({ length: playerCount }, () => []),
		lastPowerBySide: Array.from({ length: playerCount }, () => "none"),
		lastPowerPickupIdBySide: Array.from(
			{ length: playerCount },
			() => null,
		),
		powerPickups: [],
		nextPowerPickupId: 1,
		powerPickupAccMs: 0,
	};
}

export function randomPowerPickupType(): string {
	return POWER_POOL[Math.floor(Math.random() * POWER_POOL.length)] ?? "heavy";
}

export function randomPowerPickupSpot(
	existing: PowerPickupEntry[],
	blockers?: Array<{ nx: number; ny: number }>,
): { nx: number; ny: number } | null {
	const maxRadius = 0.88;
	const clearOfCentre = 0.14;
	const minPickupSep = 0.16;
	const minBlockerSep = 0.15;

	for (let attempt = 0; attempt < 80; attempt++) {
		const r = Math.sqrt(Math.random()) * maxRadius;
		const t = Math.random() * Math.PI * 2;
		const nx = r * Math.cos(t);
		const ny = r * Math.sin(t);
		if (Math.hypot(nx, ny) < clearOfCentre) continue;
		if (
			existing.some(
				(pickup) =>
					Math.hypot(pickup.nx - nx, pickup.ny - ny) < minPickupSep,
			)
		)
			continue;
		if (blockers) {
			if (
				blockers.some(
					(blocker) =>
						Math.hypot(blocker.nx - nx, blocker.ny - ny) <
						minBlockerSep,
				)
			)
				continue;
		}
		return { nx, ny };
	}
	return null;
}

export function createRandomPickup(
	id: number,
	blockers?: Array<{ nx: number; ny: number }>,
): PowerPickupEntry | null {
	const type = randomPowerPickupType();
	const spot = randomPowerPickupSpot([], blockers);
	if (!spot) return null;
	return { id, type, nx: spot.nx, ny: spot.ny };
}

function spawnOnePowerPickup(
	state: PowerPickupState,
): PowerPickupEntry | null {
	const spot = randomPowerPickupSpot(state.powerPickups);
	if (!spot) return null;
	return {
		id: state.nextPowerPickupId++,
		type: randomPowerPickupType(),
		nx: spot.nx,
		ny: spot.ny,
	};
}

export function isValidPower(power: string): boolean {
	return ALLOWED_POWERS.has(power);
}

export function consumePower(
	side: number,
	value: unknown,
	powerupsEnabled: boolean,
	usedPowersBySide: string[][],
): string {
	if (!powerupsEnabled) return "none";
	const power = String(value ?? "none");
	if (power === "none" || !ALLOWED_POWERS.has(power)) return "none";
	usedPowersBySide[side] ??= [];
	if (usedPowersBySide[side].includes(power)) return "none";
	usedPowersBySide[side].push(power);
	return power;
}
