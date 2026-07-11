import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { getDataSourceToken } from "@nestjs/typeorm";
import { Logger } from "@nestjs/common";
import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
	let service: MetricsService;
	let dataSource: { query: jest.Mock };
	let configService: { get: jest.Mock };

	beforeEach(async () => {
		dataSource = { query: jest.fn() };
		configService = { get: jest.fn() };

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MetricsService,
				{ provide: ConfigService, useValue: configService },
				{ provide: getDataSourceToken(), useValue: dataSource },
			],
		}).compile();

		service = module.get(MetricsService);
	});

	afterEach(() => {
		service.onModuleDestroy();
		jest.restoreAllMocks();
		jest.useRealTimers();
	});

	describe("getMetricsToken", () => {
		it("returns the configured METRICS_TOKEN", () => {
			configService.get.mockReturnValue("abc123");
			expect(service.getMetricsToken()).toBe("abc123");
		});

		it("returns undefined when METRICS_TOKEN is empty", () => {
			configService.get.mockReturnValue("");
			expect(service.getMetricsToken()).toBeUndefined();
		});
	});

	describe("guest session gauge", () => {
		it("sets the gauge from the DB guest count", async () => {
			dataSource.query.mockResolvedValue([{ count: "5" }]);

			await (service as unknown as { pollGuestSessions(): Promise<void> }).pollGuestSessions();

			const metrics = await service.getMetrics();
			expect(metrics).toMatch(/shellsmash_guest_sessions 5/);
			// D9 regression: must not regress back to the "_total" name, which
			// promtool lint flags on a Gauge.
			expect(metrics).not.toMatch(/shellsmash_guest_sessions_total/);
		});

		it("does not throw and logs a warning when the DB query fails", async () => {
			const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
			dataSource.query.mockRejectedValue(new Error("connection refused"));

			await expect(
				(service as unknown as { pollGuestSessions(): Promise<void> }).pollGuestSessions(),
			).resolves.toBeUndefined();

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Guest session poll failed"),
			);
		});

		it("clears the poll timer on destroy (no open-handle leak)", async () => {
			jest.useFakeTimers();
			dataSource.query.mockResolvedValue([{ count: "0" }]);

			service.onModuleInit();
			expect(jest.getTimerCount()).toBeGreaterThan(0);

			service.onModuleDestroy();
			expect(jest.getTimerCount()).toBe(0);
		});
	});

	describe("getContentType", () => {
		it("returns the Prometheus registry content type", () => {
			expect(service.getContentType()).toMatch(/^text\/plain/);
		});
	});
});
