import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

describe("MetricsController", () => {
	let controller: MetricsController;
	let metricsService: {
		getMetricsToken: jest.Mock;
		getMetrics: jest.Mock;
		getContentType: jest.Mock;
	};
	let res: { setHeader: jest.Mock; end: jest.Mock };

	beforeEach(async () => {
		metricsService = {
			getMetricsToken: jest.fn(),
			getMetrics: jest.fn().mockResolvedValue("http_requests_total 1\n"),
			getContentType: jest.fn().mockReturnValue("text/plain; version=0.0.4"),
		};

		const module: TestingModule = await Test.createTestingModule({
			controllers: [MetricsController],
			providers: [{ provide: MetricsService, useValue: metricsService }],
		}).compile();

		controller = module.get(MetricsController);

		res = { setHeader: jest.fn().mockReturnThis(), end: jest.fn() };
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("serves metrics unauthenticated when METRICS_TOKEN is unset", async () => {
		metricsService.getMetricsToken.mockReturnValue(undefined);

		await controller.getMetrics(undefined, res as unknown as Response);

		expect(res.setHeader).toHaveBeenCalledWith(
			"Content-Type",
			"text/plain; version=0.0.4",
		);
		expect(res.end).toHaveBeenCalledWith("http_requests_total 1\n");
	});

	it("returns metrics with a valid Bearer token", async () => {
		metricsService.getMetricsToken.mockReturnValue("s3cr3t-token");

		await controller.getMetrics(
			"Bearer s3cr3t-token",
			res as unknown as Response,
		);

		expect(res.end).toHaveBeenCalledWith("http_requests_total 1\n");
	});

	it("throws UnauthorizedException when the Authorization header is missing", async () => {
		metricsService.getMetricsToken.mockReturnValue("s3cr3t-token");

		await expect(
			controller.getMetrics(undefined, res as unknown as Response),
		).rejects.toThrow(UnauthorizedException);
		expect(res.end).not.toHaveBeenCalled();
	});

	it("throws UnauthorizedException when the provided token is wrong", async () => {
		metricsService.getMetricsToken.mockReturnValue("s3cr3t-token");

		await expect(
			controller.getMetrics(
				"Bearer wrong-token",
				res as unknown as Response,
			),
		).rejects.toThrow(UnauthorizedException);
	});

	it("throws UnauthorizedException when the header is malformed (missing 'Bearer ' prefix)", async () => {
		metricsService.getMetricsToken.mockReturnValue("s3cr3t-token");

		await expect(
			controller.getMetrics(
				"s3cr3t-token",
				res as unknown as Response,
			),
		).rejects.toThrow(UnauthorizedException);
	});

	it("throws UnauthorizedException when the provided token has a different length than the real one (D7 regression)", async () => {
		metricsService.getMetricsToken.mockReturnValue("s3cr3t-token");

		await expect(
			controller.getMetrics(
				"Bearer short",
				res as unknown as Response,
			),
		).rejects.toThrow(UnauthorizedException);
	});

	it("sets the response content-type to the registry's content type", async () => {
		metricsService.getMetricsToken.mockReturnValue(undefined);
		metricsService.getContentType.mockReturnValue("text/plain; version=0.0.4; charset=utf-8");

		await controller.getMetrics(undefined, res as unknown as Response);

		expect(res.setHeader).toHaveBeenCalledWith(
			"Content-Type",
			"text/plain; version=0.0.4; charset=utf-8",
		);
	});
});
