import { Body, Controller, Get, HttpException, Post } from '@nestjs/common';
import type { ErrorCode } from '@shopping-agent/shared';
import { z } from 'zod';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { GatewayError, type ModelGatewayService } from './model-gateway.service';
import { gatewayConfigSnapshot } from './models.config';

/** Gateway-internal codes → shared REST error codes (PLAN §13). */
function mapGatewayCode(code: string): ErrorCode {
  switch (code) {
    case 'NO_CASSETTE':
      return 'LLM_MODE_NO_CASSETTE';
    case 'BAD_REQUEST':
      return 'VALIDATION_ERROR';
    case 'NO_MODEL_AVAILABLE':
    case 'PROVIDER_QUOTA':
    case 'TIMEOUT':
    case 'UPSTREAM_ERROR':
    case 'ALL_MODELS_FAILED':
      return 'PROVIDER_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

const gatewayTestSchema = z.object({
  provider: z.enum(['groq', 'gemini']).optional(),
  model: z.string().min(1).max(200).optional(),
  prompt: z.string().min(1).max(4_000),
});

/**
 * Authenticated smoke endpoint for Phase 1 acceptance (PLAN §16):
 * POST /gateway/test picks an explicit provider+model when both are given,
 * otherwise runs the default `router` chain with fallback.
 */
@Controller('gateway')
export class GatewayController {
  constructor(private readonly gateway: ModelGatewayService) {}

  @Post('test')
  async test(
    @CurrentUser() ctx: { userId: string } | null,
    @Body(new ZodValidationPipe(gatewayTestSchema)) body: z.infer<typeof gatewayTestSchema>,
  ) {
    // Identity is injected from the JWT context, never from the body.
    const userId = ctx?.userId ?? null;
    const messages = [{ role: 'user' as const, content: body.prompt }];
    const explicit =
      body.provider && body.model ? { provider: body.provider, model: body.model } : undefined;

    try {
      const result = await this.gateway.generate(
        explicit ? { chain: 'router', messages, explicit } : { chain: 'router', messages },
      );
      return { ...result, userId, requested: explicit ?? null };
    } catch (err) {
      if (err instanceof GatewayError) {
        // Normalize gateway failures onto the shared error envelope (PLAN §13).
        throw new HttpException(
          { code: mapGatewayCode(err.code), message: err.message },
          err.status,
        );
      }
      throw err;
    }
  }

  @Get('config')
  config() {
    return {
      ...gatewayConfigSnapshot(),
      providers: this.gateway.providerHealth(),
    };
  }
}
