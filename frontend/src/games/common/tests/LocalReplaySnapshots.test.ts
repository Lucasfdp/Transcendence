import { describe, expect, it } from "vitest";

import type { ArenaPixels } from "../../../shared/arenas/arena";
import type { StoneState } from "../../../shared/mechanics/ball";
import { PowerType } from "../../../shared/mechanics/power-system";
import type { RectArenaPixels } from "../../../shared/mechanics/rect-arena";
import {
	buildArenaReplayProjectileSnapshot,
	buildBambooReplayObjects,
	buildBellClashReplayZones,
	buildBellClashScoreZoneDescriptor,
	buildBumperReplayObjects,
	buildCurlingReplayStoneSnapshot,
	buildKameKnockLocalReplaySnapshot,
	buildTimedTargetReplayObjects,
} from "../replay/LocalReplaySnapshots";

const arena: ArenaPixels = {
	cx: 100,
	cy: 200,
	rx: 50,
	ry: 100,
	scale: 2,
};

const rectArena: RectArenaPixels = {
	sheetX: 10,
	sheetY: 20,
	sheetW: 200,
	sheetH: 400,
	houseFarCX: 0,
	houseFarCY: 0,
	houseNearCX: 0,
	houseNearCY: 0,
	houseRadii: [1, 2, 3, 4],
	deliveryX: 0,
	deliveryY: 0,
	hogX: 0,
	hogY: 0,
	orientation: "vertical",
	scale: 2,
};

const players = [
	{
		side: 0,
		userId: 7,
		username: "Player",
		connected: true,
		ready: true,
		reconnectExpiresAt: null,
	},
];

describe("LocalReplaySnapshots", () => {
	it("normalises arena projectile state for replay snapshots", () => {
		expect(
			buildArenaReplayProjectileSnapshot({
				ball: { x: 125, y: 250, vx: 20, vy: -10, r: 52 },
				arena,
				id: "local-shell",
				side: 0,
				moving: true,
				power: "ghost",
				spriteKey: "shell",
				sourceRadius: 52,
				trail: [{ x: 0.1, y: 0.2 }],
			}),
		).toEqual(
			expect.objectContaining({
				x: 0.5,
				y: 0.5,
				vx: 10,
				vy: -5,
				alpha: 0.52,
				scale: 0.5,
				stateFlags: ["moving", "power:ghost"],
				trail: [{ x: 0.1, y: 0.2 }],
			}),
		);
	});

	it("builds a Kame Knock replay snapshot with entity mapping", () => {
		const snapshot = buildKameKnockLocalReplaySnapshot({
			matchId: "local:kame",
			seq: 2,
			powerupsEnabled: true,
			phase: "finished",
			arena,
			sourceRadius: 52,
			ball: { x: 100, y: 200, vx: 0, vy: 0, r: 104 },
			ballMoving: false,
			activeSide: 0,
			replayPower: PowerType.GIANT,
			trail: [],
			localTurnNumber: 3,
			currentBallIndex: 1,
			totalRounds: 3,
			launchedThisBall: true,
			localScores: [10],
			targets: [],
			nextTargetId: 4,
			localPlayerCount: 1,
			players,
			winnerSide: null,
		});

		expect(snapshot).toEqual(
			expect.objectContaining({
				gameId: "kame-knock",
				phase: "finished",
				balls: [expect.objectContaining({ power: "giant" })],
				entities: [
					expect.objectContaining({
						type: "projectile",
						scale: 2,
					}),
				],
			}),
		);
	});

	it("serialises obstacle descriptors into replay world objects", () => {
		expect(
			buildBambooReplayObjects([
				{
					id: "7",
					type: "bamboo",
					position: { mode: "normalised", x: 0.2, y: -0.3 },
					geometry: { shape: "circle", radius: 10 },
					rendering: { stage: 2, ageMs: 500 },
				},
			]),
		).toEqual([{ id: 7, nx: 0.2, ny: -0.3, stage: 2, ageMs: 500 }]);

		expect(
			buildTimedTargetReplayObjects([
				{
					id: 4,
					type: "timed-target",
					position: { mode: "normalised", x: -0.1, y: 0.4 },
					geometry: { shape: "circle", radius: 24 },
					scoreValue: 150,
					rendering: {
						kind: "crate",
						breakable: true,
						ageMs: 100,
						lifetimeMs: 2000,
					},
				},
			]),
		).toEqual([
			{
				id: 4,
				kind: "crate",
				breakable: true,
				nx: -0.1,
				ny: 0.4,
				ageMs: 100,
				lifetimeMs: 2000,
				radiusSrc: 24,
				points: 150,
			},
		]);

		expect(
			buildBumperReplayObjects([
				{
					id: "bumper",
					type: "bumper",
					position: { mode: "absolute", x: 10, y: 20 },
					geometry: { shape: "circle", radius: 8 },
					rendering: { fx: 0.25, fy: 0.75 },
				},
			]),
		).toEqual([{ fx: 0.25, fy: 0.75 }]);
	});

	it("serialises Bell Clash score-zone regions through replay descriptors", () => {
		const descriptor = buildBellClashScoreZoneDescriptor(
			{ kind: "green", start: 0.25, end: 1.25 },
			2,
		);

		expect(descriptor).toEqual({
			id: "zone:2:green",
			type: "score-zone",
			kind: "green",
			range: { unit: "radians", start: 0.25, end: 1.25 },
		});
		expect(buildBellClashReplayZones([descriptor])).toEqual([
			{ kind: "green", start: 0.25, end: 1.25 },
		]);
	});

	it("normalises curling stone state for replay snapshots", () => {
		const stone: StoneState = {
			id: 3,
			teamId: 1,
			x: 110,
			y: 220,
			vx: 12,
			vy: -6,
			r: 56,
			power: PowerType.GHOST,
			stopped: true,
			curlBias: 0,
		};

		expect(
			buildCurlingReplayStoneSnapshot({
				stone,
				arena: rectArena,
				trail: [{ x: 0.1, y: 0.2 }],
			}),
		).toEqual(
			expect.objectContaining({
				id: 3,
				side: 1,
				x: 0.5,
				y: 0.5,
				vx: 6,
				vy: -3,
				alpha: 0.52,
				scale: 1,
				stateFlags: ["settled", "power:ghost"],
			}),
		);
	});
});
