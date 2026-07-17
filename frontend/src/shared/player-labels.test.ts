import { describe, expect, it } from "vitest";
import {
	accountDisplayName,
	displayUsername,
	playerDisplayName,
} from "./player-labels";

describe("player labels", () => {
	it("shortens generated guest usernames to four visible suffix characters", () => {
		expect(displayUsername("guest_42a3bc9d127e")).toBe("guest_42a3");
	});

	it("does not shorten normal usernames that merely start with guest", () => {
		expect(displayUsername("guest_player")).toBe("guest_player");
		expect(displayUsername("guest_42a3")).toBe("guest_42a3");
	});

	it("prefers a turtle name over the shortened account username", () => {
		expect(
			accountDisplayName({
				username: "guest_42a3bc9d127e",
				turtleName: "  Kame  ",
			}),
		).toBe("Kame");
	});

	it("uses shortened guest usernames in player labels", () => {
		expect(playerDisplayName({ username: "guest_42a3bc9d127e" })).toBe(
			"guest_42a3",
		);
	});
});
