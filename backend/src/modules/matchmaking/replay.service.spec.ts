import {
	MatchReplayFrame,
	ReplayMetadataV2,
	REPLAY_CONTRACT_VERSION,
} from "./entities/match-replay.entity";
import { MatchRoom } from "./matchmaking.types";
import { ReplayImportInput, ReplayService } from "./replay.service";

type ReplayServiceProbe = Pick<
	ReplayService,
	"validateImportedReplay" | "captureFrame"
>;

function makeService(): ReplayServiceProbe {
	return new ReplayService({} as never, {} as never, {} as never);
}

function metadata(powerupsEnabled: false = false): ReplayMetadataV2 {
	return {
		contractVersion: REPLAY_CONTRACT_VERSION,
		origin: "local",
		gameId: "kame-knock",
		mode: "singleplayer",
		participants: [{ side: 0, userId: 1, username: "A" }],
		durationMs: 100,
		sampleHz: 20,
		keyframeIntervalMs: 1000,
		preRollMs: 3000,
		statistics: {},
		powerupsEnabled,
	};
}

function frame(
	seq: number,
	tMs: number,
	state: MatchReplayFrame["state"],
): MatchReplayFrame {
	return {
		seq,
		tMs,
		round: 1,
		state,
		type: seq === 0 ? "keyframe" : "delta",
		changes:
			seq === 0
				? {
						phase: "active",
						players: [{ side: 0, userId: 1, username: "A" }],
						score: [0],
					}
				: { score: [1] },
		removals: [],
	};
}

function replayInput(): ReplayImportInput {
	return {
		gameId: "kame-knock",
		mode: "singleplayer",
		status: "finished",
		winnerSide: 0,
		metadata: metadata(),
		durationMs: 100,
		frames: [frame(0, 0, "active"), frame(1, 100, "finished")],
		events: [
			{ seq: 0, tMs: 50, round: 1, type: "action:start", payload: {} },
		],
	};
}

describe("ReplayService replay v2", () => {
	it("accepts a monotonic, power-up-free v2 import", () => {
		expect(() =>
			makeService().validateImportedReplay(replayInput()),
		).not.toThrow();
	});

	it("rejects imports that do not explicitly disable power-ups", () => {
		const input = replayInput();
		(
			input.metadata as unknown as { powerupsEnabled: boolean }
		).powerupsEnabled = true;
		expect(() => makeService().validateImportedReplay(input)).toThrow(
			"Replays are unavailable while power-ups are enabled",
		);
	});

	it("rejects non-monotonic frame timelines", () => {
		const input = replayInput();
		input.frames[1]!.tMs = -1;
		expect(() => makeService().validateImportedReplay(input)).toThrow(
			"invalid timeline",
		);
	});

	it("does not allocate frames for a power-up room", () => {
		const room = {
			replayEnabled: false,
			replayDisabledReason: "powerups-enabled",
			state: { powerupsEnabled: true },
			replayFrames: [],
		} as unknown as MatchRoom;
		makeService().captureFrame(room, true);
		expect(room.replayFrames).toHaveLength(0);
	});

	// The capture pipeline works on a single owned clone of the live state:
	// these invariants let it skip a second deep clone per frame safely.
	describe("captureFrame snapshot ownership", () => {
		function makeRoom(): MatchRoom {
			return {
				replayEnabled: true,
				replayDisabledReason: null,
				state: {
					powerupsEnabled: false,
					phase: "active",
					roundNumber: 1,
					score: [0, 0],
					objects: [
						{
							id: 1,
							side: 0,
							x: 0.5,
							y: 0.5,
							trail: [{ x: 0.1, y: 0.1 }],
						},
					],
				},
				replayFrames: [],
				replayEvents: [],
				replayStartedAt: null,
				replayLastSampleAt: null,
				replayLastKeyframeAt: null,
				replayLastSnapshot: null,
			} as unknown as MatchRoom;
		}

		it("strips entity trails from the keyframe without touching the live state", () => {
			const room = makeRoom();
			makeService().captureFrame(room, true);

			expect(room.replayFrames).toHaveLength(1);
			const recorded = room.replayFrames[0].changes.objects as Array<
				Record<string, unknown>
			>;
			expect(recorded[0].trail).toBeUndefined();
			// The live snapshot keeps its trail — only the recorded clone is bare.
			const live = (room.state as unknown as Record<string, unknown>)
				.objects as Array<Record<string, unknown>>;
			expect(live[0].trail).toEqual([{ x: 0.1, y: 0.1 }]);
		});

		it("records delta frames that later live-state mutations cannot alter", () => {
			const room = makeRoom();
			const service = makeService();
			service.captureFrame(room, true, 0);

			const state = room.state as unknown as { score: number[] };
			state.score = [3, 0];
			service.captureFrame(room, false, 50);

			const delta = room.replayFrames[1];
			expect(delta.type).toBe("delta");
			expect(delta.changes.score).toEqual([3, 0]);
			expect(delta.changes.objects).toBeUndefined();

			// Mutating the live state afterwards must not rewrite history.
			state.score[0] = 99;
			expect(delta.changes.score).toEqual([3, 0]);
		});
	});

	it("bounds the live frame buffer by trimming the oldest whole round (R3)", () => {
		const room = {
			replayEnabled: true,
			state: {
				powerupsEnabled: false,
				roundNumber: 0,
				players: [{ side: 0, userId: 1, username: "A" }],
				score: [0],
				entities: [{ id: "a", x: 0, y: 0 }],
			},
			replayFrames: [],
			replayEvents: [],
			replayStartedAt: null,
			replayLastSampleAt: null,
			replayLastSnapshot: null,
			replayLastKeyframeAt: null,
		} as unknown as MatchRoom;
		const service = makeService();
		// Two rounds of 2,000 forced frames each (4,000 > MAX_LIVE_REPLAY_FRAMES).
		for (let index = 0; index < 4_000; index += 1) {
			(room.state as unknown as { roundNumber: number }).roundNumber =
				index < 2_000 ? 0 : 1;
			service.captureFrame(room, true, 50);
		}
		// The oldest complete round is dropped; only the in-progress round remains.
		expect(room.replayFrames.length).toBeLessThanOrEqual(3_000);
		expect(room.replayFrames.every((frame) => frame.round === 1)).toBe(true);
		expect(room.replayFrames[0].type).toBe("keyframe");
		// Sequence numbers stay contiguous from zero after trimming.
		room.replayFrames.forEach((frame, index) =>
			expect(frame.seq).toBe(index),
		);
	});
});
