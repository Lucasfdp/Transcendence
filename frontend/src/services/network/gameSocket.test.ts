import { beforeEach, describe, expect, it, vi } from "vitest";
import { io } from "socket.io-client";
import { disconnectGameSocket, getGameSocket } from "./gameSocket";

vi.mock("socket.io-client", () => ({
	io: vi.fn(() => ({ disconnect: vi.fn() })),
}));

describe("gameSocket", () => {
	beforeEach(() => {
		disconnectGameSocket();
		vi.mocked(io).mockClear();
	});

	it("waits through a normal backend restart before reconnecting", () => {
		getGameSocket();

		expect(io).toHaveBeenCalledWith(
			"/",
			expect.objectContaining({
				reconnectionDelay: 6_000,
				reconnectionDelayMax: 6_000,
				randomizationFactor: 0,
			}),
		);
	});
});
