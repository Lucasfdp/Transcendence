import {
	advanceShellCurlPhysics,
	createShellCurlPhysicsState,
	launchShellCurlProjectile,
	resetShellCurlPhysicsEnd,
	syncShellCurlSnapshot,
} from "./shell-curl-physics";
import { CurlingSnapshot } from "./matchmaking.types";

function snapshot(): CurlingSnapshot {
	return {
		matchId: "curl-physics", seq: 0, gameId: "temple-curling", mode: "casual", powerupsEnabled: true,
		phase: "active", currentTurn: 0, turnNumber: 0, maxTurns: 18, currentEnd: 0, throwsInEnd: 0,
		ballsPerPlayer: 3, totalEnds: 3, score: [0, 0], endScores: [[null, null], [null, null], [null, null]],
		usedPowersBySide: [[], []], map: { gameId: "temple-curling", bumpers: [] }, players: [], objects: [], entities: [], activeBallId: null, winnerSide: null,
	};
}

describe("Temple Curling authoritative physics", () => {
	it("advances and projects server-owned shell positions", () => {
		const physics = createShellCurlPhysicsState("curl-physics");
		const state = snapshot();
		launchShellCurlProjectile(physics, 0, 300, 0, "none");
		const before = physics.entities[0].x;
		expect(advanceShellCurlPhysics(physics, state, 1000 / 30)).toBe(true);
		syncShellCurlSnapshot(state, physics);
		expect(physics.entities[0].x).toBeGreaterThan(before);
		expect(state.objects[0]).toMatchObject({ side: 0, moving: true });
	});

	it("uses the server map for bumper collisions", () => {
		const physics = createShellCurlPhysicsState("curl-physics");
		const state = snapshot();
		(state.map as { bumpers: Array<{ fx: number; fy: number }> }).bumpers = [{ fx: 0.07, fy: 0.5 }];
		launchShellCurlProjectile(physics, 0, 300, 0, "none");
		advanceShellCurlPhysics(physics, state, 1000 / 30);
		expect(physics.entities[0].vx).toBeLessThan(0);
		expect(physics.impactEvents).toEqual([{
			id: 1,
			kind: "bumper",
			entityId: physics.entities[0].id,
			side: 0,
			objectId: 0,
			x: 0.07 * 1570,
			y: 0.5 * 880,
		}]);
		advanceShellCurlPhysics(physics, state, 0);
		expect(physics.impactEvents).toHaveLength(1);
	});

	it("creates stable authoritative entities for splitter power", () => {
		const physics = createShellCurlPhysicsState("curl-physics");
		launchShellCurlProjectile(physics, 0, 300, 0, "splitter");
		expect(physics.entities).toHaveLength(3);
		expect(new Set(physics.entities.map((entity) => entity.id)).size).toBe(3);
	});

	it("collects and applies server-owned power pickups", () => {
		const physics = createShellCurlPhysicsState("curl-physics");
		const state = snapshot();
		physics.pickups = [
			{ id: 1, type: "heavy", x: 100, y: 440, radius: 18 },
		];
		launchShellCurlProjectile(physics, 0, 300, 0, "none");

		advanceShellCurlPhysics(physics, state, 1000 / 30);

		expect(physics.pickups).toEqual([]);
		expect(physics.entities[0]).toMatchObject({ power: "heavy" });
		expect(physics.pickupEvents[0]).toMatchObject({
			side: 0,
			type: "heavy",
		});
		expect(state.usedPowersBySide[0]).toContain("heavy");
	});

	it("publishes a newer empty projection when an end resets", () => {
		const physics = createShellCurlPhysicsState("curl-physics");
		launchShellCurlProjectile(physics, 0, 300, 0, "none");
		physics.nextImpactEventId = 4;
		const previousSeq = physics.physicsSeq;

		resetShellCurlPhysicsEnd(physics);

		expect(physics.entities).toEqual([]);
		expect(physics.impactEvents).toEqual([]);
		expect(physics.nextImpactEventId).toBe(4);
		expect(physics.physicsSeq).toBeGreaterThan(previousSeq);
	});
});
