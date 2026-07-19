import { describe, expect, it, vi } from "vitest";

vi.mock("./ShellCurlView", () => ({
	BUMPER_FLASH_MS: 130,
	drawShellCurlBallTrails: vi.fn(),
	drawShellCurlBumpers: vi.fn(),
}));
vi.mock("../../shared/mechanics/player-renderer", () => ({
	destroyIngamePlayerTexture: vi.fn(),
}));

import { ShellCurlOnlineController } from "./ShellCurlOnline";

describe("ShellCurlOnlineController", () => {
	it("restores the local aiming stone after a late empty initial projection", () => {
		const snapshot = {
			matchId: "curl-match",
			seq: 1,
			gameId: "temple-curling",
			mode: "casual",
			powerupsEnabled: true,
			phase: "active",
			currentTurn: 0,
			turnNumber: 0,
			maxTurns: 18,
			currentEnd: 0,
			throwsInEnd: 0,
			ballsPerPlayer: 3,
			totalEnds: 3,
			score: [0, 0],
			endScores: [
				[null, null],
				[null, null],
				[null, null],
			],
			usedPowersBySide: [[], []],
			map: { gameId: "temple-curling", bumpers: [] },
			players: [],
			objects: [],
			entities: [],
			activeBallId: null,
			winnerSide: null,
		} as const;
		const beginTurn = vi.fn();
		const scene = {
			registry: {
				get: vi.fn(() => ({
					matchId: snapshot.matchId,
					side: 0,
					snapshot,
				})),
			},
			activeBall: null,
			clearAllBallGfx: vi.fn(),
			clearActiveRing: vi.fn(),
			updateSidePanels: vi.fn(),
			syncOnlinePowerPickups: vi.fn(),
			beginTurn,
		};
		const controller = new ShellCurlOnlineController(scene as never);
		controller.bindFromRegistry();

		(
			controller as unknown as {
				applyPhysicsState(state: Record<string, unknown>): void;
			}
		).applyPhysicsState({
			matchId: snapshot.matchId,
			physicsSeq: 0,
			serverTime: 100,
			entities: [],
			pickups: [],
			scoreEvents: [],
			pickupEvents: [],
			nextEntityId: 1,
		});

		expect(scene.clearAllBallGfx).toHaveBeenCalledOnce();
		expect(beginTurn).toHaveBeenCalledOnce();
	});

	it("ignores historical bumper impacts and flashes only new ones", () => {
		const snapshot = {
			matchId: "curl-match",
			seq: 1,
			gameId: "temple-curling",
			mode: "casual",
			powerupsEnabled: true,
			phase: "active",
			currentTurn: 1,
			currentEnd: 0,
			ballsPerPlayer: 3,
			score: [0, 0],
			usedPowersBySide: [[], []],
			map: { gameId: "temple-curling", bumpers: [{ fx: 0.3, fy: 0.4 }] },
			players: [],
			objects: [],
			entities: [],
			activeBallId: null,
			winnerSide: null,
		} as const;
		const bumper = { x: 0, y: 0, r: 20, fx: 0.3, fy: 0.4, flashTimer: 0 };
		const scene = {
			registry: { get: vi.fn(() => ({ matchId: snapshot.matchId, side: 0, snapshot })) },
			bumpers: [bumper],
			ballTrails: { clear: vi.fn() },
			activeBall: null,
			clearAllBallGfx: vi.fn(),
			clearActiveRing: vi.fn(),
			updateSidePanels: vi.fn(),
			syncOnlinePowerPickups: vi.fn(),
			beginTurn: vi.fn(),
		};
		const controller = new ShellCurlOnlineController(scene as never);
		controller.bindFromRegistry();
		const apply = (
			controller as unknown as {
				applyPhysicsState(state: Record<string, unknown>): void;
			}
		).applyPhysicsState.bind(controller);
		const impact = {
			kind: "bumper",
			entityId: 1,
			side: 0,
			objectId: 0,
			x: 300,
			y: 400,
		};

		apply({
			matchId: snapshot.matchId,
			physicsSeq: 1,
			serverTime: 100,
			entities: [],
			pickups: [],
			impactEvents: [{ id: 1, ...impact }],
		});
		expect(bumper.flashTimer).toBe(0);

		apply({
			matchId: snapshot.matchId,
			physicsSeq: 2,
			serverTime: 150,
			entities: [],
			pickups: [],
			impactEvents: [{ id: 1, ...impact }, { id: 2, ...impact }],
		});
		expect(bumper.flashTimer).toBe(130);
	});
});
