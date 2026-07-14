import {
	advanceBellPhysics,
	createBellPhysicsState,
	launchBellProjectile,
	resetBellPhysicsRound,
} from "./bell-clash-physics";
import { BellClashSnapshot } from "./matchmaking.types";

function snapshot(): BellClashSnapshot {
	return {
		matchId: "bell-physics",
		seq: 0,
		gameId: "bell-clash",
		mode: "casual",
		powerupsEnabled: false,
		phase: "active",
		roundNumber: 1,
		totalRounds: 3,
		shotsPerRound: 3,
		score: [0, 0],
		liveRoundScores: [0, 0],
		roundScores: [null, null],
		shotCounts: [1, 0],
		usedPowersBySide: [[], []],
		zones: [{ kind: "green", start: -0.2, end: 0.2 }],
		players: [],
		balls: [],
		activeBallIdBySide: [],
		nextBallId: 1,
		entities: [],
		winnerSide: null,
	};
}

describe("Bell Clash authoritative physics", () => {
	it("advances source-space entities with a monotonic physics sequence", () => {
		const physics = createBellPhysicsState("bell-physics");
		launchBellProjectile(physics, 0, 1, 300, 0, 400, 0, "none");
		const before = physics.physicsSeq;
		const x = physics.entities[0].x;

		const result = advanceBellPhysics(physics, snapshot(), 1000 / 30);

		expect(result.changed).toBe(true);
		expect(physics.physicsSeq).toBeGreaterThan(before);
		expect(physics.entities[0].x).toBeGreaterThan(x);
	});

	it("advances projection timestamps by fixed simulation time", () => {
		const physics = createBellPhysicsState("bell-physics");
		const state = snapshot();
		launchBellProjectile(physics, 0, 1, 300, 0, 400, 0, "none");
		const startTime = physics.serverTime;

		advanceBellPhysics(physics, state, 1000 / 30);
		advanceBellPhysics(physics, state, 1000 / 30);

		expect(physics.serverTime).toBeCloseTo(startTime + 2000 / 30, 3);
	});

	it("detects bell hits and awards the server-defined zone score", () => {
		const physics = createBellPhysicsState("bell-physics");
		const state = snapshot();
		launchBellProjectile(physics, 0, 1, 260, 0, -900, 0, "none");

		for (let step = 0; step < 30 && state.liveRoundScores[0] === 0; step++)
			advanceBellPhysics(physics, state, 1000 / 30);

		expect(state.liveRoundScores[0]).toBe(200);
		expect(physics.scoreEvents).toEqual([
			expect.objectContaining({ side: 0, points: 200, zoneKind: "green" }),
		]);
	});

	it("creates stable server identities for splitter projectiles", () => {
		const physics = createBellPhysicsState("bell-physics");
		launchBellProjectile(physics, 0, 1, 300, 0, 500, 0, "splitter");

		expect(physics.entities).toHaveLength(3);
		expect(new Set(physics.entities.map((entity) => entity.id)).size).toBe(3);
		expect(physics.entities.filter((entity) => entity.primary)).toHaveLength(1);
		expect(physics.entities.every((entity) => entity.ownerSide === 0)).toBe(true);
	});

	it("publishes an authoritative pickup layout when powers are enabled", () => {
		const physics = createBellPhysicsState("bell-physics");
		resetBellPhysicsRound(physics, true);

		expect(physics.pickups).toHaveLength(1);
		expect(Number.isFinite(physics.pickups[0].x)).toBe(true);
		expect(Number.isFinite(physics.pickups[0].y)).toBe(true);
	});

	it("emits a pickup event when the server applies a power", () => {
		const physics = createBellPhysicsState("bell-physics");
		const state = snapshot();
		physics.pickups = [{ id: 6, type: "rocket", x: 0, y: 0, radius: 20 }];
		launchBellProjectile(physics, 0, 1, 0, 0, 100, 0, "none");

		advanceBellPhysics(physics, state, 0);

		expect(physics.pickups).toEqual([]);
		expect(physics.pickupEvents).toEqual([
			expect.objectContaining({ id: 1, side: 0, type: "rocket", x: 0, y: 0 }),
		]);
	});
});
