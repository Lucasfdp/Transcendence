import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Global so MetricsService (and MetricsInterceptor via main.ts) can be
 * injected anywhere without explicitly importing this module.
 */
@Global()
@Module({
  providers:   [MetricsService],
  controllers: [MetricsController],
  exports:     [MetricsService],
})
export class MetricsModule {}
