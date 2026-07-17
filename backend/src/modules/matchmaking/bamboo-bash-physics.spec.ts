import { BambooBashEngine } from "./engines/bamboo-bash.engine";
import {
	advanceBambooPhysics,
	createBambooPhysicsState,
	launchBambooProjectile,
	resetBambooPhysicsRound,
} from "./bamboo-bash-physics";
import { BambooBashSnapshot, RoomPlayer } from "./matchmaking.types";

function players(): RoomPlayer[] {
	return [0, 1].map((side) => ({
		socketId: `socket-${side}`,
		user: { id: side + 1, username: `player-${side}`, isGuest: false },
		side,
		shellSelection: [],
		ready: true,
		connected: true,
	}));
}

function snapshot(): BambooBashSnapshot {
	const roomPlayers = players();
	const engine = new BambooBashEngine();
	const state = engine.createInitialState(
		{
			matchId: "bamboo-physics",
			gameId: "bamboo-bash",
			mode: "casual",
			powerupsEnabled: true,
			players: roomPlayers.map((player) => ({
				socketId: player.socketId,
				user: player.user,
				shellSelection: player.shellSelection,
			})),
		},
		roomPlayers,
	);
	state.phase = "active";
	return state;
}

describe("Bamboo Bash authoritative physics", () => {
	it("keeps an authoritative idle shell for each player and publishes it", () => {
		const state = snapshot();
		const physics = createBambooPhysicsState(state.matchId);

		resetBambooPhysicsRound(physics, state);

		expect(physics.entities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ ownerSide: 0, primary: true, stopped: true }),
				expect.objectContaining({ ownerSide: 1, primary: true, stopped: true }),
			]),
		);
		expect(state.entities).toHaveLength(2);
		expect(state.balls).toHaveLength(2);
		expect(state.activeBallIdBySide).toEqual(
			physics.entities.map((entity) => entity.id),
		);
	});

	it("resolves a launch against an opponent that has not launched", () => {
		const state = snapshot();
		const physics = createBambooPhysicsState(state.matchId);
		resetBambooPhysicsRound(physics, state);
		state.bamboos = [];
		const [launcher, idleOpponent] = physics.entities;
		launcher.x = -51;
		launcher.y = 0;
		launcher.vx = 100;
		launcher.vy = 0;
		launcher.stopped = false;
		idleOpponent.x = 51;
		idleOpponent.y = 0;

		advanceBambooPhysics(physics, state, 0);

		expect(idleOpponent.stopped).toBe(false);
		expect(idleOpponent.vx).toBeGreaterThan(0);
		expect(launcher.vx).toBeLessThan(idleOpponent.vx);
	});

	it("awards server-defined bamboo points and exposes a score event", () => {
		const state = snapshot();
		const physics = createBambooPhysicsState(state.matchId);
		resetBambooPhysicsRound(physics, state);
		state.bamboos = [{ id: 7, nx: 0, ny: 0, stage: 3, ageMs: 10_000 }];
		const shell = physics.entities[0];
		shell.x = 0;
		shell.y = 0;
		shell.vx = 0;
		shell.vy = 0;
		shell.stopped = false;

		advanceBambooPhysics(physics, state, 0);

		expect(state.liveRoundScores[0]).toBe(250);
		expect(physics.scoreEvents).toEqual([
			expect.objectContaining({ id: 1, side: 0, points: 250, bambooId: 7 }),
		]);
		expect(state.bamboos).toEqual([]);
	});

	it("applies server-owned pickups without a client collection report", () => {
		const state = snapshot();
		const physics = createBambooPhysicsState(state.matchId);
		resetBambooPhysicsRound(physics, state);
		state.bamboos = [];
		const shell = physics.entities[0];
		shell.x = 0;
		shell.y = 0;
		shell.vx = 100;
		shell.vy = 0;
		shell.stopped = false;
		physics.pickups = [{ id: 9, type: "rocket", x: 0, y: 0, radius: 20 }];

		advanceBambooPhysics(physics, state, 0);

		expect(physics.pickups).toEqual([]);
		expect(shell.power).toBe("rocket");
		expect(shell.vx).toBe(200);
		expect(state.lastPowerBySide[0]).toBe("rocket");
		expect(physics.pickupEvents).toEqual([
			expect.objectContaining({ id: 1, side: 0, type: "rocket", x: 0, y: 0 }),
		]);
	});

	it("assigns stable identities to derived power projectiles", () => {
		const state = snapshot();
		const physics = createBambooPhysicsState(state.matchId);

		launchBambooProjectile(physics, state, 0, 0, 0, 100, 0, "splitter");

		expect(physics.entities).toHaveLength(3);
		expect(new Set(physics.entities.map((entity) => entity.id)).size).toBe(3);
		expect(physics.entities.filter((entity) => entity.primary)).toHaveLength(1);
		expect(state.entities).toHaveLength(3);
		expect(physics.physicsSeq).toBeGreaterThan(0);
	});
});
