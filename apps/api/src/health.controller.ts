import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './db/prisma.service';
import { type ChromaHealth } from './health/chroma-health';
import { ChromaHealthService } from './health/chroma-health.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chromaHealth: ChromaHealthService,
  ) {}

  /** Liveness/readiness: verifies the DB answers a trivial query. */
  @Public()
  @Get()
  async check(): Promise<{ status: string; ts: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Database unreachable',
      });
    }
    return { status: 'ok', ts: new Date().toISOString() };
  }

  /**
   * Non-fatal vector-store probe (PLAN §15). Always returns 200: the API can
   * serve catalog/cart/orders without Chroma; `/help` later reports the
   * degraded state itself. Never mutates the collection.
   */
  @Public()
  @Get('chroma')
  chroma(): Promise<ChromaHealth> {
    return this.chromaHealth.check();
  }
}
