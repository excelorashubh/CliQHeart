import { randomUUID, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { UserModel } from '../../models/user';
import type { AppConfig } from '../../config/env';
import { SessionModel } from './session.model';
import type { LoginInput, RegisterInput } from './auth.validation';

type UserWithPasswordHash = {
  id?: string;
  _id: unknown;
  passwordHash?: string;
  accountStatus?: string;
  toJSON: () => Record<string, unknown>;
};

export class AuthService {
  constructor(private readonly config: AppConfig) {}

  async register(input: RegisterInput): Promise<{ user: Record<string, unknown> }> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();

    const existingUser = await UserModel.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      throw new Error('User already exists.');
    }

    const passwordHash = await argon2.hash(input.password);
    const created = await UserModel.create({
      username,
      email,
      displayName,
      passwordHash,
      accountStatus: 'pending',
      isEmailVerified: false,
    });

    const userData = created.toJSON() as Record<string, unknown>;
    return { user: userData };
  }

  async login(input: LoginInput): Promise<{ accessToken: string; refreshToken: string; user: Record<string, unknown> }> {
    const identifier = input.identifier.trim().toLowerCase();
    const user = (await UserModel.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    }).select('+passwordHash')) as UserWithPasswordHash | null;

    if (!user || !user.passwordHash) {
      throw new Error('Invalid credentials.');
    }

    const passwordMatches = await argon2.verify(user.passwordHash, input.password);
    if (!passwordMatches) {
      throw new Error('Invalid credentials.');
    }

    if (user.accountStatus !== 'active') {
      throw new Error('Account is not active.');
    }

    const accessToken = this.createAccessToken(user.id ?? String(user._id));
    const refreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = await argon2.hash(refreshToken);
    const tokenFamily = randomUUID();

    await SessionModel.create({
      userId: user._id,
      refreshTokenHash,
      tokenFamily,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const safeUser = user.toJSON() as Record<string, unknown>;
    return { accessToken, refreshToken, user: safeUser };
  }

  private createAccessToken(subjectId: string): string {
    const secret = this.config.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new Error('JWT access secret is not configured.');
    }

    const signToken = (jwt as any).sign as (...args: any[]) => string;
    return signToken(
      {
        sub: subjectId,
        tokenType: 'access',
      },
      secret,
      {
        expiresIn: this.config.ACCESS_TOKEN_TTL,
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
        jwtid: randomUUID(),
      },
    );
  }
}
