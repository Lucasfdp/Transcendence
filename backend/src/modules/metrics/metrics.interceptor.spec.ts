import { BadRequestException, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable, of, throwError, lastValueFrom } from "rxjs";
import { MetricsInterceptor } from "./metrics.interceptor";
import { MetricsService } from "./metrics.service";

describe("MetricsInterceptor", () => {
	let interceptor: MetricsInterceptor;
	let metricsService: {
		httpRequestsTotal: { inc: jest.Mock };
		httpRequestDurationSeconds: { observe: jest.Mock };
	};

	const buildContext = (
		overrides: { type?: string; req?: unknown; res?: unknown } = {},
	): ExecutionContext => {
		const req = overrides.req ?? { method: "GET", route: { path: "/users/:id" } };
		const res = overrides.res ?? { statusCode: 200 };

		return {
			getType: () => overrides.type ?? "http",
			switchToHttp: () => ({
				getRequest: () => req,
				getResponse: () => res,
			}),
		} as unknown as ExecutionContext;
	};

	const buildHandler = (observable: Observable<unknown>): CallHandler => ({
		handle: () => observable,
	});

	beforeEach(() => {
		metricsService = {
			httpRequestsTotal: { inc: jest.fn() },
			httpRequestDurationSeconds: { observe: jest.fn() },
		};
		interceptor = new MetricsInterceptor(
			metricsService as unknown as MetricsService,
		);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("skips recording for non-http execution contexts (e.g. WebSocket)", async () => {
		const context = buildContext({ type: "ws" });
		const handler = buildHandler(of("payload"));

		const result = await lastValueFrom(interceptor.intercept(context, handler));

		expect(result).toBe("payload");
		expect(metricsService.httpRequestsTotal.inc).not.toHaveBeenCalled();
	});

	it("records the matched route template, not the raw request path", async () => {
		const req = { method: "GET", route: { path: "/users/:id" }, path: "/users/42" };
		const res = { statusCode: 200 };
		const context = buildContext({ req, res });
		const handler = buildHandler(of("ok"));

		await lastValueFrom(interceptor.intercept(context, handler));

		expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith({
			method: "GET",
			route: "/users/:id",
			status_code: "200",
		});
	});

	it('uses the "unmatched" label when Express has no matched route (D8 — avoids unbounded label cardinality)', async () => {
		const req = { method: "GET", route: undefined, path: "/some/random/unmatched/path" };
		const res = { statusCode: 404 };
		const context = buildContext({ req, res });
		const handler = buildHandler(of("ok"));

		await lastValueFrom(interceptor.intercept(context, handler));

		expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
			expect.objectContaining({ route: "unmatched" }),
		);
	});

	it("records the status code from a thrown HttpException, not the stale res.statusCode (D2 regression)", async () => {
		const req = { method: "POST", route: { path: "/auth/login" } };
		// res.statusCode is still 200 here because NestJS's exception filter
		// has not run yet at the point the interceptor observes the error —
		// this is exactly the bug D2 fixes.
		const res = { statusCode: 200 };
		const context = buildContext({ req, res });
		const handler = buildHandler(
			throwError(() => new BadRequestException("invalid body")),
		);

		await expect(
			lastValueFrom(interceptor.intercept(context, handler)),
		).rejects.toThrow(BadRequestException);

		expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
			expect.objectContaining({ status_code: "400" }),
		);
	});

	it("records status 500 for a thrown error that is not an HttpException", async () => {
		const req = { method: "GET", route: { path: "/crashy" } };
		const res = { statusCode: 200 };
		const context = buildContext({ req, res });
		const handler = buildHandler(throwError(() => new Error("boom")));

		await expect(
			lastValueFrom(interceptor.intercept(context, handler)),
		).rejects.toThrow("boom");

		expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
			expect.objectContaining({ status_code: "500" }),
		);
	});

	it("records request duration for successful requests", async () => {
		const context = buildContext();
		const handler = buildHandler(of("ok"));

		await lastValueFrom(interceptor.intercept(context, handler));

		expect(metricsService.httpRequestDurationSeconds.observe).toHaveBeenCalledWith(
			{ method: "GET", route: "/users/:id" },
			expect.any(Number),
		);
	});
});
