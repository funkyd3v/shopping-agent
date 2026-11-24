import { Body, Controller, Get, Post, Res, UnauthorizedException } from '@nestjs/common';
import {
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
} from '@shopping-agent/shared';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { clearAuthCookie, setAuthCookie } from './auth.cookies';
import type { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.register(body);
    const { token, maxAgeSec } = this.auth.issueToken(user.id);
    setAuthCookie(res, token, maxAgeSec);
    return { user };
  }

  @Public()
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(body);
    const { token, maxAgeSec } = this.auth.issueToken(user.id);
    setAuthCookie(res, token, maxAgeSec);
    return { user };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() ctx: { userId: string } | null) {
    if (!ctx)
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Not authenticated' });
    const user = await this.auth.getUser(ctx.userId);
    return { user };
  }
}
