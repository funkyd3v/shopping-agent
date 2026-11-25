import { Body, Controller, Get, Patch, UnauthorizedException } from '@nestjs/common';
import { type AddressInput, addressSchema } from '@shopping-agent/shared';
import { AuthService, type PublicUser } from '../auth/auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  async me(@CurrentUser() ctx: { userId: string } | null): Promise<{ user: PublicUser }> {
    if (!ctx)
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Not authenticated' });
    return { user: await this.auth.getUser(ctx.userId) };
  }

  @Patch('me/address')
  async updateAddress(
    @CurrentUser() ctx: { userId: string } | null,
    @Body(new ZodValidationPipe(addressSchema)) body: AddressInput,
  ): Promise<{ user: PublicUser }> {
    if (!ctx)
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Not authenticated' });
    await this.auth.updateAddress(ctx.userId, body);
    return { user: await this.auth.getUser(ctx.userId) };
  }
}
