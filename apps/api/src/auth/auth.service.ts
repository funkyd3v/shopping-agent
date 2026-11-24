import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import {
  type AddressInput,
  addressSchema,
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
} from '@shopping-agent/shared';
import * as argon2 from 'argon2';
import { ulid } from 'ulid';
import type { PrismaService } from '../db/prisma.service';
import type { User } from '../generated/prisma/client';

export interface JwtPayload {
  sub: string;
  sid: string;
  iat?: number;
  exp?: number;
}

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    region?: string | null;
    postalCode: string;
    country: string;
  } | null;
};

const JWT_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(raw: RegisterInput): Promise<PublicUser> {
    const input = registerSchema.parse(raw);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing)
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        id: ulid(),
        email: input.email,
        name: input.name,
        passwordHash,
        address:
          input.address !== undefined ? { create: { id: ulid(), ...input.address } } : undefined,
      },
      include: { address: true },
    });
    return toPublicUser(user);
  }

  async login(raw: LoginInput): Promise<PublicUser> {
    const input = loginSchema.parse(raw);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { address: true },
    });
    if (!user)
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok)
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    return toPublicUser(user);
  }

  /** Sign a JWT with a per-login session id (sid) so future revocation is possible. */
  issueToken(userId: string): { token: string; maxAgeSec: number } {
    const payload: JwtPayload = { sub: userId, sid: ulid() };
    const token = this.jwt.sign(payload, { expiresIn: JWT_TTL_SEC });
    return { token, maxAgeSec: JWT_TTL_SEC };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Invalid or expired token',
      });
    }
  }

  async getUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { address: true },
    });
    if (!user)
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'User not found' });
    return toPublicUser(user);
  }

  /** Create-or-update the user's single address row (idempotent). */
  async updateAddress(userId: string, address: AddressInput): Promise<void> {
    const input = addressSchema.parse(address);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        address: {
          upsert: { create: { id: ulid(), ...input }, update: input },
        },
      },
    });
  }
}

function toPublicUser(
  user: User & {
    address: {
      line1: string;
      line2: string | null;
      city: string;
      region: string | null;
      postalCode: string;
      country: string;
    } | null;
  },
): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    address: user.address
      ? {
          line1: user.address.line1,
          line2: user.address.line2,
          city: user.address.city,
          region: user.address.region,
          postalCode: user.address.postalCode,
          country: user.address.country,
        }
      : null,
  };
}
