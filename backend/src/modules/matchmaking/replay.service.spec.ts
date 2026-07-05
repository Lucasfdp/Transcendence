import {
	MatchReplayFrame,
	REPLAY_CONTRACT_VERSION,
} from "./entities/match-replay.entity";
import { ReplayImportInput, ReplayService } from "./replay.service";

type ReplayServiceProbe = {
	validateImportedReplay: (input: ReplayImportInput) => void;
	validateImportedReplayContract: (
		input: ReplayImportInput,
		frames: MatchReplayFrame[],
	) => void;
	normalizeImportedFrames: (frames: MatchReplayFrame[]) => MatchReplayFrame[];
};

function makeService(): ReplayServiceProbe {
	const service = new ReplayService(
		{} as never,
		{} as never,
		{} as never,
	);
	return service as unknown as ReplayServiceProbe;
}

function baseFrame(
	gameId: ReplayImportInput["gameId"],
	snapshot: MatchReplayFrame["snapshot"],
	index = 0,
): MatchReplayFrame {
	const recordedAtMs = Date.UTC(2026, 6, 4, 10, 0, 0, index * 100);
	return {
		replayVersion: REPLAY_CONTRACT_VERSION,
		seq: index,
		recordedAt: new Date(recordedAtMs).toISOString(),
		recordedAtMs,
		tickTs: index * 100,
		deltaMs: index === 0 ? 0 : 100,
		snapshot: {
			gameId,
			phase: "finished",
			players: [
				{ side: 0, userId: 1, username: "A" },
				{ side: 1, userId: null, username: "B" },
			],
			score: [1, 0],
			winnerSide: 0,
			...snapshot,
		},
	};
}

function makeImport(
	gameId: ReplayImportInput["gameId"],
	frames: MatchReplayFrame[],
): ReplayImportInput {
	return {
		gameId,
		mode: "casual",
		status: "finished",
		winnerSide: 0,
		frames,
		events: [],
	};
}

describe("ReplayService import contract validation", () => {
	it("normalises imported frame timing and sequence before validation", () => {
		const service = makeService();
		const frames = service.normalizeImportedFrames([
			{
				seq: 99,
				recordedAt: "2026-07-04T10:00:00.000Z",
				snapshot: {
					gameId: "kame-knock",
					phase: "finished",
					players: [{ side: 0, userId: 1, username: "A" }],
					score: [1],
					targets: [],
					currentTurn: 0,
					balls: [],
					entities: [],
					activeBallIdBySide: [],
					nextBallId: 1,
				},
			},
		]);

		expect(frames[0]).toMatchObject({
			replayVersion: REPLAY_CONTRACT_VERSION,
			seq: 0,
			recordedAtMs: Date.UTC(2026, 6, 4, 10, 0, 0, 0),
			tickTs: 0,
			deltaMs: 0,
		});
	});

	const validContracts: Array<[string, MatchReplayFrame["snapshot"]]> = [
		[
			"temple-curling",
			{
				currentTurn: 0,
				objects: [{ id: 1, type: "stone", side: 0, x: 0.4, y: 0.5 }],
				entities: [{ id: 1, type: "stone", side: 0, x: 0.4, y: 0.5 }],
			},
		],
		[
			"bamboo-bash",
			{
				bamboos: [],
				powerPickups: [],
				balls: [],
				entities: [],
				activeBallIdBySide: [],
				nextBallId: 1,
			},
		],
		[
			"kame-knock",
			{
				targets: [],
				currentTurn: 0,
				balls: [],
				entities: [],
				activeBallIdBySide: [],
				nextBallId: 1,
			},
		],
		[
			"bell-clash",
			{
				zones: [],
				balls: [],
				entities: [],
				activeBallIdBySide: [],
				nextBallId: 1,
			},
		],
	];

	it.each(validContracts)("accepts a valid %s import contract", (gameId, snapshot) => {
		const service = makeService();
		const frames = [baseFrame(gameId, snapshot)];
		const input = makeImport(gameId, frames);

		expect(() => service.validateImportedReplay(input)).not.toThrow();
		expect(() =>
			service.validateImportedReplayContract(input, frames),
		).not.toThrow();
	});

	it("rejects imported projectile games without entities", () => {
		const service = makeService();
		const frames = [
			baseFrame("kame-knock", {
				targets: [],
				currentTurn: 0,
				balls: [],
				activeBallIdBySide: [],
				nextBallId: 1,
			}),
		];
		const input = makeImport("kame-knock", frames);

		expect(() => service.validateImportedReplayContract(input, frames)).toThrow(
			"balls/entities",
		);
	});

	it("rejects imports whose winner does not exist in snapshot players", () => {
		const service = makeService();
		const frames = [
			baseFrame("bell-clash", {
				zones: [],
				balls: [],
				entities: [],
				activeBallIdBySide: [],
				nextBallId: 1,
			}),
		];
		const input = { ...makeImport("bell-clash", frames), winnerSide: 9 };

		expect(() => service.validateImportedReplayContract(input, frames)).toThrow(
			"winnerSide",
		);
	});
});
