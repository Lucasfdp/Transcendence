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
});
