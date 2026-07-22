import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { PublicApiGuard } from "./public-api.guard";

function context(method: string, key?: string): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				method,
				headers: key === undefined ? {} : { "x-api-key": key },
			}),
		}),
	} as ExecutionContext;
}

describe("PublicApiGuard", () => {
	const config = { get: jest.fn() } as unknown as ConfigService;
	const guard = new PublicApiGuard(config);

	beforeEach(() => jest.clearAllMocks());

	it.each(["GET", "HEAD", "OPTIONS"])(
		"allows safe %s requests without an API key",
		(method) => {
			expect(guard.canActivate(context(method))).toBe(true);
			expect(config.get).not.toHaveBeenCalled();
		},
	);

	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"requires a configured key for %s requests",
		(method) => {
			(config.get as jest.Mock).mockReturnValue(undefined);
			expect(() => guard.canActivate(context(method))).toThrow(
				ServiceUnavailableException,
			);
		},
	);

	it("rejects a missing key", () => {
		(config.get as jest.Mock).mockReturnValue("correct-key");
		expect(() => guard.canActivate(context("POST"))).toThrow(
			UnauthorizedException,
		);
	});

	it("rejects an incorrect key", () => {
		(config.get as jest.Mock).mockReturnValue("correct-key");
		expect(() => guard.canActivate(context("PUT", "wrong-key"))).toThrow(
			UnauthorizedException,
		);
	});

	it("accepts a correct key using a constant-time comparison", () => {
		(config.get as jest.Mock).mockReturnValue("correct-key");
		const comparison = jest.spyOn(crypto, "timingSafeEqual");
		expect(guard.canActivate(context("DELETE", "correct-key"))).toBe(true);
		expect(comparison).toHaveBeenCalledTimes(1);
	});
});
