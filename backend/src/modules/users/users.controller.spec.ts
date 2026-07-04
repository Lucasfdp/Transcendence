import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { PresenceService } from "../presence/presence.service";
import { FriendsService } from "../friends/friends.service";

describe("UsersController — getLeaderboard period filtering (Bug Audit H2)", () => {
	let controller: UsersController;
	let queryMock: jest.Mock;
	let usersService: jest.Mocked<UsersService>;
	let presence: jest.Mocked<PresenceService>;
	let friendsService: jest.Mocked<FriendsService>;

	beforeEach(() => {
		queryMock = jest.fn().mockResolvedValue([]);
		usersService = {
			getLeaderboardAllTime: jest.fn().mockResolvedValue([]),
			getDataSource: jest.fn().mockReturnValue({ query: queryMock }),
		} as unknown as jest.Mocked<UsersService>;
		presence = {
			isOnline: jest.fn().mockReturnValue(false),
		} as unknown as jest.Mocked<PresenceService>;
		friendsService = {
			getFriendIds: jest.fn().mockResolvedValue([]),
		} as unknown as jest.Mocked<FriendsService>;

		controller = new UsersController(usersService, presence, friendsService);
	});

	it("scopes both wins and gamesPlayed to matches inside the requested window", async () => {
		await controller.getLeaderboard(
			{ user: { id: 1, isGuest: false } },
			"weekly",
			"global",
		);

		expect(queryMock).toHaveBeenCalledTimes(1);
		const [sql] = queryMock.mock.calls[0] as [string, unknown[]];

		// The period cutoff lives in the `matches` JOIN condition, so a plain
		// `COUNT(mp.id)` / unconditional win SUM would still count rows whose
		// match falls outside the window (m = NULL). Both aggregates must
		// gate on `m.id` so weekly/monthly stop silently degrading to all-time.
		expect(sql).toMatch(/COUNT\(m\.id\)/);
		expect(sql).toMatch(/mp\.outcome = 'win' AND m\.id IS NOT NULL/);
		expect(sql).not.toMatch(/COUNT\(mp\.id\)/);
	});

	it("applies the same window-scoped aggregation for monthly", async () => {
		await controller.getLeaderboard(
			{ user: { id: 1, isGuest: false } },
			"monthly",
			"global",
		);

		const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
		expect(sql).toMatch(/COUNT\(m\.id\)/);
		expect(sql).toMatch(/mp\.outcome = 'win' AND m\.id IS NOT NULL/);
	});

	it("falls back to the fast all-time path without touching match_players", async () => {
		await controller.getLeaderboard(
			{ user: { id: 1, isGuest: false } },
			"all",
			"global",
		);

		expect(usersService.getLeaderboardAllTime).toHaveBeenCalledTimes(1);
		expect(queryMock).not.toHaveBeenCalled();
	});
});
