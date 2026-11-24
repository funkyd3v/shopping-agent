import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getEnv } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        // The secret is only ever read from validated env, never a default.
        secret: getEnv().JWT_SECRET,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  // JwtModule is re-exported so the global APP_GUARD in AppModule can inject JwtService.
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
