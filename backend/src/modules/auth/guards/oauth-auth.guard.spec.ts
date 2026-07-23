import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FortyTwoAuthGuard } from "./ft-auth.guard";

function contextWithState(state: unknown): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({
				headers: {
					host: "attacker.example",
					"x-forwarded-proto": "http",
				},
				query: { state },
			}),
		}),
	} as unknown as ExecutionContext;
}

describe("OAuth authentication guards", () => {
	const config = new ConfigService({
		FORTYTWO_CALLBACK_URL:
			"https://10.12.19.3:42424/api/auth/42/callback",
	});

	it("uses the configured 42 callback instead of request headers", () => {
		const guard = new FortyTwoAuthGuard(config);

		expect(guard.getAuthenticateOptions(contextWithState("42-state"))).toEqual({
			callbackURL: "https://10.12.19.3:42424/api/auth/42/callback",
			state: "42-state",
		});
	});

	it("does not forward a non-string state value", () => {
		const guard = new FortyTwoAuthGuard(config);

		expect(guard.getAuthenticateOptions(contextWithState(["unsafe"]))).toEqual({
			callbackURL: "https://10.12.19.3:42424/api/auth/42/callback",
			state: "",
		});
	});
});
