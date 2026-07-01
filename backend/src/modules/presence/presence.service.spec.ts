import { PresenceService, SocketUser } from "./presence.service";

const user = (id: number): SocketUser => ({
	id,
	username: `u${id}`,
	isGuest: false,
});

describe("PresenceService — presence status", () => {
	let presence: PresenceService;

	beforeEach(() => {
		presence = new PresenceService();
	});

	it("should report offline for a user with no active sockets", () => {
		expect(presence.getStatus(1)).toBe("offline");
		expect(presence.getGameId(1)).toBeNull();
	});

	it("should report online for a connected user not in a game", () => {
		presence.connect("s1", user(1));
		expect(presence.getStatus(1)).toBe("online");
		expect(presence.getGameId(1)).toBeNull();
	});

	it("should report in-game with the gameId once marked in a game", () => {
		presence.connect("s1", user(1));
		presence.setInGame(1, "bamboo-bash");
		expect(presence.getStatus(1)).toBe("in-game");
		expect(presence.getGameId(1)).toBe("bamboo-bash");
	});

	it("should return to online when in-game is cleared", () => {
		presence.connect("s1", user(1));
		presence.setInGame(1, "bamboo-bash");
		presence.clearInGame(1);
		expect(presence.getStatus(1)).toBe("online");
		expect(presence.getGameId(1)).toBeNull();
	});

	it("should clear in-game state when the user's last socket disconnects", () => {
		presence.connect("s1", user(1));
		presence.setInGame(1, "bamboo-bash");
		presence.disconnect("s1");
		expect(presence.getStatus(1)).toBe("offline");
		expect(presence.getGameId(1)).toBeNull();
	});

	it("should keep the user online while at least one socket remains", () => {
		presence.connect("s1", user(1));
		presence.connect("s2", user(1));
		presence.disconnect("s1");
		expect(presence.getStatus(1)).toBe("online");
		expect(presence.isOnline(1)).toBe(true);
	});
});
