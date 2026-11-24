import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { getEnv, validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Fail fast BEFORE any module reads env (PLAN §15/§18).
  validateEnv(process.env as Record<string, unknown>);
  const env = getEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());

  // No global prefix: the web app proxies /api/* → this server (PLAN §2.2).
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  await app.listen(env.PORT);
  // Log after listen so the line is visible in the app's own logger.
  app.get(Logger).log(`API listening on http://localhost:${env.PORT} (LLM_MODE=${env.LLM_MODE})`);
}

bootstrap().catch((err: unknown) => {
  // Ensure boot failures are visible even before the logger exists.
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
