import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { OAuthStateService } from "./oauth-state.service";

describe("OAuthStateService", () => {
	const makeService = () =>
		new OAuthStateService({
			get: jest.fn((_key: string, fallback: unknown) => fallback),
		} as unknown as ConfigService);

	it("stores 256 bits of random state with a ten-minute expiry", async () => {
		const service = makeService();
		const command = jest
			.spyOn(
				service as unknown as {
					command(args: string[]): Promise<string | null>;
				},
				"command",
			)
			.mockResolvedValue("OK");
		const state = await service.create({
			provider: "google",
			initiatorUserId: 12,
			returnTo: "/",
		});
		expect(Buffer.from(state, "base64url")).toHaveLength(32);
		expect(command).toHaveBeenCalledWith([
			"SET",
			`oauth_state:${state}`,
			expect.stringContaining('"initiatorUserId":12'),
			"EX",
			"600",
			"NX",
		]);
	});

	it("consumes state atomically and rejects a missing value", async () => {
		const service = makeService();
		const command = jest.spyOn(
			service as unknown as {
				command(args: string[]): Promise<string | null>;
			},
			"command",
		);
		command.mockResolvedValueOnce(
			JSON.stringify({
				provider: "forty_two",
				initiatorUserId: null,
				returnTo: "/",
			}),
		);
		await expect(service.consume("valid-state")).resolves.toEqual(
			expect.objectContaining({ provider: "forty_two" }),
		);
		expect(command).toHaveBeenCalledWith([
			"GETDEL",
			"oauth_state:valid-state",
		]);
		command.mockResolvedValueOnce(null);
		await expect(service.consume("expired-state")).rejects.toThrow(
			UnauthorizedException,
		);
	});
});
