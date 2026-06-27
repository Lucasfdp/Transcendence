import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { CsrfGuard } from "./csrf.guard";

function contextWith(headers: Record<string, string>): ExecutionContext {
	return {
		switchToHttp: () => ({
			getRequest: () => ({ headers }),
		}),
	} as unknown as ExecutionContext;
}

describe("CsrfGuard", () => {
	const guard = new CsrfGuard();

	it("should allow the request when the header token matches the cookie token", () => {
		const ctx = contextWith({
			"x-csrf-token": "abc123",
			cookie: "csrf_token=abc123; other=1",
		});
		expect(guard.canActivate(ctx)).toBe(true);
	});

	it("should throw UnauthorizedException when the CSRF header is missing", () => {
		const ctx = contextWith({ cookie: "csrf_token=abc123" });
		expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
	});

	it("should throw UnauthorizedException when the CSRF cookie is missing", () => {
		const ctx = contextWith({ "x-csrf-token": "abc123" });
		expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
	});

	it("should throw UnauthorizedException when the header and cookie tokens differ", () => {
		const ctx = contextWith({
			"x-csrf-token": "abc123",
			cookie: "csrf_token=different",
		});
		expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
	});
});
