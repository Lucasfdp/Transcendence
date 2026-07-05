import { MatchmakingService } from "./matchmaking.service";
import { RoomService } from "./room.service";
import { ShellsService } from "../shells/shells.service";
import { SocketUser } from "./matchmaking.types";

function makeUser(id: number, isGuest = false): SocketUser {
	return { id, username: `user-${id}`, isGuest };
}

describe("MatchmakingService.joinQueue — powerupsEnabled resolution (Bug Audit M1)", () => {
	let service: MatchmakingService;
	let shellsService: jest.Mocked<ShellsService>;
	let roomService: jest.Mocked<RoomService>;
	let matchRepo: { save: jest.Mock; create: jest.Mock };
	let matchPlayerRepo: { save: jest.Mock; create: jest.Mock };

	beforeEach(() => {
		shellsService = {
			validateSelection: jest.fn(),
		} as unknown as jest.Mocked<ShellsService>;
		roomService = {
			hasActiveRoom: jest.fn().mockReturnValue(false),
			createRoom: jest.fn().mockReturnValue({
				players: [],
			}),
		} as unknown as jest.Mocked<RoomService>;
		matchRepo = {
			save: jest.fn(async (m) => ({ ...m, id: "match-1" })),
			create: jest.fn((m) => m),
		};
		matchPlayerRepo = { save: jest.fn(), create: jest.fn((p) => p) };

		service = new MatchmakingService(
			shellsService,
			roomService,
			matchRepo as never,
			matchPlayerRepo as never,
		);
	});

	it("resolves the room's powerupsEnabled from the first-in-queue player, not a hard-coded true", async () => {
		// First player queues with powerups OFF.
		await service.joinQueue("socket-1", makeUser(1), {
			gameId: "temple-curling",
			mode: "casual",
			playerCount: 2,
			powerupsEnabled: false,
		});

		// Second player (different preference) completes the match.
		const result = await service.joinQueue("socket-2", makeUser(2), {
			gameId: "temple-curling",
			mode: "casual",
			playerCount: 2,
			powerupsEnabled: true,
		});

		expect(result.matched).toBe(true);
		expect(roomService.createRoom).toHaveBeenCalledTimes(1);
		expect(roomService.createRoom).toHaveBeenCalledWith(
			"match-1",
			"temple-curling",
			"casual",
			expect.any(Array),
			{ powerupsEnabled: false },
		);
	});

	it("honours a single queuer's own preference (powerups on)", async () => {
		await service.joinQueue("socket-1", makeUser(1), {
			gameId: "temple-curling",
			mode: "casual",
			playerCount: 2,
			powerupsEnabled: true,
		});
		await service.joinQueue("socket-2", makeUser(2), {
			gameId: "temple-curling",
			mode: "casual",
			playerCount: 2,
			powerupsEnabled: true,
		});

		expect(roomService.createRoom).toHaveBeenCalledWith(
			expect.anything(),
			"temple-curling",
			"casual",
			expect.any(Array),
			{ powerupsEnabled: true },
		);
	});

	it("defaults powerupsEnabled to true when the payload omits it", async () => {
		await service.joinQueue("socket-1", makeUser(1), {
			gameId: "temple-curling",
			mode: "casual",
			playerCount: 2,
		});
		await service.joinQueue("socket-2", makeUser(2), {
			gameId: "temple-curling",
			mode: "casual",
			playerCount: 2,
		});

		expect(roomService.createRoom).toHaveBeenCalledWith(
			expect.anything(),
			"temple-curling",
			"casual",
			expect.any(Array),
			{ powerupsEnabled: true },
		);
	});
});
