import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './db/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
}
