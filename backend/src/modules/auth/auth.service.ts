import { randomUUID, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { sign, type SignOptions } from 'jsonwebtoken';
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
    let created;
    try {
      created = await UserModel.create({
        username,
        email,
        displayName,
        passwordHash,
        accountStatus: 'active',
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new Error('User already exists.');
      }
      throw error;
    }

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

    switch (user.accountStatus) {
      case 'active':
        break;
      case 'pending':
        throw new Error('Account is pending approval.');
      case 'suspended':
        throw new Error('Account is suspended.');
      case 'deleted':
        throw new Error('Account is deleted.');
      default:
        console.warn(JSON.stringify({ event: 'unknown_account_status', status: user.accountStatus }));
        throw new Error('Account status is invalid.');
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

    return sign(
      {
        sub: subjectId,
        tokenType: 'access',
      },
      secret,
      {
        expiresIn: this.config.ACCESS_TOKEN_TTL as NonNullable<SignOptions['expiresIn']>,
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
        jwtid: randomUUID(),
      },
    );
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
