import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { AuthenticatedCsrfGuard, CsrfGuard } from "./csrf.guard";

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

describe("AuthenticatedCsrfGuard", () => {
	const guard = new AuthenticatedCsrfGuard();
	const requestContext = (
		method: string,
		path: string,
		headers: Record<string, string> = {},
	): ExecutionContext =>
		({
			switchToHttp: () => ({ getRequest: () => ({ method, path, headers }) }),
		}) as unknown as ExecutionContext;

	it("allows safe requests and unauthenticated mutations", () => {
		expect(guard.canActivate(requestContext("GET", "/api/users/me"))).toBe(true);
		expect(guard.canActivate(requestContext("POST", "/api/users/me"))).toBe(true);
	});

	it("leaves public API and login mutations to their explicit policies", () => {
		const headers = { cookie: "auth_token=session" };
		expect(guard.canActivate(requestContext("PUT", "/api/public/users/a", headers))).toBe(true);
		expect(guard.canActivate(requestContext("POST", "/api/auth/login", headers))).toBe(true);
	});

	it("requires CSRF for authenticated cookie mutations", () => {
		const missing = requestContext("PATCH", "/api/users/me", {
			cookie: "auth_token=session",
		});
		expect(() => guard.canActivate(missing)).toThrow(UnauthorizedException);

		const valid = requestContext("PATCH", "/api/users/me", {
			cookie: "auth_token=session; csrf_token=fresh",
			"x-csrf-token": "fresh",
		});
		expect(guard.canActivate(valid)).toBe(true);
	});
});
