import { describe, expect, it, vi } from "vitest";

vi.mock("./ShellCurlView", () => ({
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
});
