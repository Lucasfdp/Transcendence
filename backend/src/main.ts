import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { MetricsInterceptor } from "./modules/metrics/metrics.interceptor";
import { MetricsService } from "./modules/metrics/metrics.service";

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);
	app.set("trust proxy", 1);

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
			if (allowed.some((o) => origin.startsWith(o.trim()))) return callback(null, true);
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
