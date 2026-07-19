import {
	advanceKamePhysics,
	createKamePhysicsState,
	launchKameProjectile,
	resetKamePhysicsTurn,
} from "./kame-knock-physics";
import { KameKnockSnapshot } from "./matchmaking.types";

function snapshot(): KameKnockSnapshot {
	return {
		matchId: "kame-physics",
		seq: 0,
		gameId: "kame-knock",
		mode: "casual",
		powerupsEnabled: false,
		phase: "active",
		currentTurn: 0,
		turnNumber: 0,
		roundNumber: 1,
		totalRounds: 1,
		activeTurnNumber: 0,
		score: [0, 0],
		roundScores: [0, 0],
		usedPowersBySide: [[], []],
		targets: [],
		nextTargetId: 1,
		players: [],
		balls: [],
		activeBallIdBySide: [],
		nextBallId: 1,
		entities: [],
		winnerSide: null,
	};
}

describe("Kame Knock authoritative physics", () => {
	it("advances source-space entities with a monotonic physics sequence", () => {
		const physics = createKamePhysicsState("kame-physics");
		const state = snapshot();
		launchKameProjectile(physics, 0, 0, 300, 0, "none");
		const before = physics.physicsSeq;
		const x = physics.entities[0].x;

		expect(advanceKamePhysics(physics, state, 1000 / 30)).toBe(true);
		expect(physics.physicsSeq).toBeGreaterThan(before);
		expect(physics.entities[0].x).toBeGreaterThan(x);
	});

	it("awards target scores from server-side collision detection", () => {
		const physics = createKamePhysicsState("kame-physics");
		const state = snapshot();
		state.targets = [{
			id: 1,
			kind: "daruma",
			breakable: true,
			nx: 0,
			ny: 0,
			ageMs: 0,
			lifetimeMs: Number.POSITIVE_INFINITY,
			radiusSrc: 30,
			points: 100,
		}];
		launchKameProjectile(physics, 0, 0, 100, 0, "none");

		advanceKamePhysics(physics, state, 0);

		expect(state.targets).toEqual([]);
		expect(state.score).toEqual([600, 0]);
		expect(state.roundScores).toEqual([600, 0]);
		expect(physics.scoreEvents).toEqual([
			expect.objectContaining({
				side: 0,
				points: 600,
				combo: 1,
				perfect: true,
			}),
		]);
	});

	it("publishes one monotonic event when a projectile bounces off a solid target", () => {
		const physics = createKamePhysicsState("kame-physics");
		const state = snapshot();
		state.targets = [{
			id: 9, kind: "drum", breakable: false, nx: 0.1, ny: 0,
			ageMs: 0, lifetimeMs: Number.POSITIVE_INFINITY, radiusSrc: 32, points: 150,
		}];
		launchKameProjectile(physics, 1, 0, 100, 0, "none");

		advanceKamePhysics(physics, state, 1000);

		expect(physics.entities[0].vx).toBeLessThan(0);
		expect(physics.impactEvents).toEqual([{
			id: 1,
			kind: "solid-target",
			entityId: physics.entities[0].id,
			side: 1,
			objectId: 9,
			x: 0.1 * 705,
			y: 0,
		}]);
		advanceKamePhysics(physics, state, 0);
		expect(physics.impactEvents).toHaveLength(1);
		resetKamePhysicsTurn(physics, false);
		expect(physics.impactEvents).toEqual([]);
		expect(physics.nextImpactEventId).toBe(2);
	});

	it("creates stable server identities for splitter projectiles", () => {
		const physics = createKamePhysicsState("kame-physics");

		launchKameProjectile(physics, 0, 0, 300, 0, "splitter");

		expect(physics.entities).toHaveLength(3);
		expect(new Set(physics.entities.map((entity) => entity.id)).size).toBe(3);
		expect(physics.entities.filter((entity) => entity.primary)).toHaveLength(1);
	});

	it("publishes and applies server-owned pickups", () => {
		const physics = createKamePhysicsState("kame-physics");
		const state = snapshot();
		resetKamePhysicsTurn(physics, true);
		expect(physics.pickups).toHaveLength(1);
		physics.pickups = [{ id: 1, type: "rocket", x: 0, y: 0, radius: 20 }];
		launchKameProjectile(physics, 0, 0, 100, 0, "none");

		advanceKamePhysics(physics, state, 0);

		expect(physics.pickups).toEqual([]);
		expect(physics.pickupEvents).toEqual([
			expect.objectContaining({ id: 1, side: 0, type: "rocket" }),
		]);
		expect(physics.entities[0].power).toBe("rocket");
	});
});
