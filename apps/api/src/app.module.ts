import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CatalogModule } from './catalog/catalog.module';
import { requestContextMiddleware } from './common/context/request-context';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { originCheckMiddleware } from './common/middleware/origin-check.middleware';
import { getEnv, validateEnv } from './config/env';
import { PrismaModule } from './db/prisma.module';
import { HealthController } from './health.controller';
import { pinoOptions } from './logging/pino.options';
import { ModelGatewayModule } from './model-gateway/model-gateway.module';
import { OrdersModule } from './orders/orders.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Load the package-local .env first, then the repo-root .env (Phase 1 keeps
    // a single root .env; dotenv never overrides values already present).
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    // Lazy so env is read at module init (after validateEnv in main.ts),
    // not at import time.
    LoggerModule.forRootAsync({ useFactory: () => ({ pinoHttp: pinoOptions(getEnv()) }) }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    CartModule,
    OrdersModule,
    ModelGatewayModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global guard: everything is authenticated unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(requestContextMiddleware, originCheckMiddleware([getEnv().WEB_ORIGIN]))
      .forRoutes('*');
  }
}
