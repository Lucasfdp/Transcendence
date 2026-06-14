import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { MetricsService } from './metrics/metrics.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Global HTTP metrics interceptor — records http_requests_total + duration histogram
  const metricsService = app.get(MetricsService);
  app.useGlobalInterceptors(new MetricsInterceptor(metricsService));

  // CORS — frontend reaches backend via nginx proxy
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['https://localhost'],
    credentials: true,
  });

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger docs (disable in production if needed)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Transcendence API')
      .setDescription('Gaming hub API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.BACKEND_PORT ?? 8000;
  await app.listen(port);
  console.log(`[backend] Running on port ${port}`);
}
bootstrap();
