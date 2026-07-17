import { NotFoundException } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { PresenceService } from "../presence/presence.service";
import { FriendsService } from "../friends/friends.service";
import { User } from "./entities/user.entity";

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

		controller = new UsersController(
			usersService,
			presence,
			friendsService,
		);
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

describe("UsersController — getUser public whitelist (Bug Audit H2)", () => {
	let controller: UsersController;
	let usersService: jest.Mocked<UsersService>;
	let presence: jest.Mocked<PresenceService>;

	const fullUser = Object.assign(new User(), {
		id: 7,
		username: "kame",
		email: "secret@example.com",
		fortyTwoId: "42-1234",
		googleId: "google-9",
		passwordHash: "salt:hash",
		coins: 999,
		xp: 4200,
		turtleName: "KameMaster",
		shellSkin: "dragon",
		avatar: "a.png",
		level: 12,
		isGuest: false,
		lastSeenAt: new Date("2026-07-01T00:00:00Z"),
		profile: Object.assign(
			{},
			{
				totalWins: 10,
				totalLosses: 3,
				gamesPlayed: 13,
				totalCoinsEarned: 500,
				tag: "brawler",
				showcasedAchievements: ["first_win"],
			},
		),
	});

	beforeEach(() => {
		usersService = {
			findByUsername: jest.fn().mockResolvedValue(fullUser),
			getMostPlayedGame: jest
				.fn()
				.mockResolvedValue({ gameName: "Bamboo Bash", winRate: 77 }),
		} as unknown as jest.Mocked<UsersService>;
		presence = {
			isOnline: jest.fn().mockReturnValue(true),
		} as unknown as jest.Mocked<PresenceService>;

		controller = new UsersController(
			usersService,
			presence,
			{} as unknown as FriendsService,
		);
	});

	it("returns only whitelisted public fields and never PII / balances", async () => {
		const result = (await controller.getUser("kame")) as unknown as Record<
			string,
			unknown
		>;

		expect(result).toEqual({
			id: 7,
			username: "kame",
			turtleName: "KameMaster",
			shellSkin: "dragon",
			avatar: "a.png",
			level: 12,
			isOnline: true,
			mostPlayedGame: { gameName: "Bamboo Bash", winRate: 77 },
			profile: {
				totalWins: 10,
				totalLosses: 3,
				gamesPlayed: 13,
				tag: "brawler",
				showcasedAchievements: ["first_win"],
			},
		});
		// Explicitly assert the sensitive fields are gone.
		for (const leaked of [
			"email",
			"fortyTwoId",
			"googleId",
			"passwordHash",
			"coins",
			"xp",
			"lastSeenAt",
			"isGuest",
		]) {
			expect(result).not.toHaveProperty(leaked);
		}
	});

	it("throws NotFoundException instead of returning null for a missing user", async () => {
		usersService.findByUsername.mockResolvedValue(null);

		await expect(controller.getUser("ghost")).rejects.toThrow(
			NotFoundException,
		);
	});
});

describe("UsersController — current user avatar", () => {
	it("clears the authenticated user's uploaded avatar", async () => {
		const usersService = {
			clearAvatar: jest.fn().mockResolvedValue({ ok: true }),
		} as unknown as jest.Mocked<UsersService>;
		const controller = new UsersController(
			usersService,
			{} as PresenceService,
			{} as FriendsService,
		);

		await expect(
			controller.clearAvatar({ user: { id: 7 } }),
		).resolves.toEqual({
			ok: true,
		});
		expect(usersService.clearAvatar).toHaveBeenCalledWith(7);
	});
});
