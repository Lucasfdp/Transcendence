import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import { mkdirSync } from "fs";
import { join } from "path";
import { AppModule } from "./app.module";
import { MetricsInterceptor } from "./modules/metrics/metrics.interceptor";
import { MetricsService } from "./modules/metrics/metrics.service";
import { isAllowedOrigin } from "./cors.util";

/**
 * Rankings Bug Audit §3.3 (2026-07-20): Node kills the process on any
 * unhandled promise rejection from v16 onward, and `main.ts` registered no
 * handlers — Nest catches HTTP-path errors, but background timers/listeners
 * (e.g. `BotPlayerService`'s `setInterval`) are not on that path. A floating
 * rejection there silently took the whole backend down; nginx then served
 * 502/503 for every request, which the hub misread as an "authentication
 * issue" until `make re` restarted the container. These handlers log the
 * failure — with a stack where available — so the next incident is
 * diagnosable from `make logs SERVICE=backend` instead of leaving no trace.
 * Logging only (no `process.exit`): keeping the process alive is strictly
 * better than a silent Node-default crash for a bug we want to catch and fix
 * at the source, not paper over by restarting.
 */
function registerProcessSafetyNets(): void {
	const logger = new Logger("Process");
	process.on("unhandledRejection", (reason) => {
		logger.error(
			`Unhandled promise rejection: ${
				reason instanceof Error ? reason.message : String(reason)
			}`,
			reason instanceof Error ? reason.stack : undefined,
		);
	});
	process.on("uncaughtException", (err) => {
		logger.error(`Uncaught exception: ${err.message}`, err.stack);
	});
}

async function bootstrap() {
	registerProcessSafetyNets();
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		bodyParser: false,
	});
	app.set("trust proxy", 1);
	app.use(json({ limit: "10mb" }));
	app.use(urlencoded({ extended: true, limit: "10mb" }));
	const uploadsDirectory =
		process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");
	mkdirSync(join(uploadsDirectory, "avatars"), { recursive: true });
	app.useStaticAssets(uploadsDirectory, { prefix: "/api/uploads/" });

	// Global validation pipe
	app.useGlobalPipes(
		new ValidationPipe({ whitelist: true, transform: true }),
	);

	// Global HTTP metrics interceptor — records http_requests_total + duration histogram
	const metricsService = app.get(MetricsService);
	app.useGlobalInterceptors(new MetricsInterceptor(metricsService));

	// CORS — frontend reaches backend via nginx proxy
	app.enableCors({
		origin(origin, callback) {
			if (!origin) return callback(null, true);
			const allowed = process.env.ALLOWED_ORIGINS?.split(",") ?? [];
			if (isAllowedOrigin(origin, allowed)) return callback(null, true);
			if (process.env.NODE_ENV !== "production") return callback(null, true);
			callback(new Error("Not allowed by CORS"));
		},
		credentials: true,
	});

	// API prefix
	app.setGlobalPrefix("api");

	// Swagger docs (disable in production if needed)
	if (process.env.NODE_ENV !== "production") {
		const config = new DocumentBuilder()
			.setTitle("Transcendence API")
			.setDescription("Gaming hub API")
			.setVersion("1.0")
			.addBearerAuth()
			.addApiKey(
				{ type: "apiKey", name: "X-API-Key", in: "header" },
				"x-api-key",
			)
			.build();
		const document = SwaggerModule.createDocument(app, config);
		SwaggerModule.setup("api/docs", app, document);
	}

	const logger = new Logger("Bootstrap");
	const port = process.env.BACKEND_PORT ?? 8000;
	await app.listen(port);
	logger.log(`Running on port ${port}`);
}
bootstrap();
