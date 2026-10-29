import { createHash, randomUUID, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { sign, type SignOptions } from 'jsonwebtoken';
import { Types } from 'mongoose';
import { UserModel } from '../../models/user';
import type { AppConfig } from '../../config/env';
import { SessionModel } from './session.model';
import type { LoginInput, RegisterInput } from './auth.validation';
import { disconnectSessionSockets, disconnectUserSockets } from '../messages/realtime';

type UserWithPasswordHash = {
  id?: string;
  _id: unknown;
  passwordHash?: string;
  accountStatus?: string;
  professionalOnboardingCompletedAt?: Date | null;
  toJSON: () => Record<string, unknown>;
};

const maximumSessionLifetimeMs = 365 * 24 * 60 * 60 * 1000;

export class AuthService {
  constructor(private readonly config: AppConfig) {}

  async register(input: RegisterInput): Promise<AuthSessionResult> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();

    const existingUser = await UserModel.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      if (existingUser.username === username) throw new Error('Username already exists.');
      throw new Error('Email already exists.');
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
        throw new Error(duplicateKeyField(error) === 'username'
          ? 'Username already exists.'
          : 'Email already exists.');
      }
      throw error;
    }

    return this.createSession(created as UserWithPasswordHash);
  }

  async login(input: LoginInput): Promise<AuthSessionResult> {
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

    return this.createSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthSessionResult> {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret || !/^[a-f\d]{24}$/i.test(sessionId) || !/^[a-f\d]{64}$/i.test(secret)) {
      throw new Error('Invalid refresh session.');
    }

    const now = new Date();
    const nextRefreshToken = createRefreshToken(sessionId);
    const session = await SessionModel.findOneAndUpdate(
      {
        _id: sessionId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          refreshTokenHash: hashRefreshToken(nextRefreshToken),
          lastUsedAt: now,
        },
      },
      { new: true },
    );
    if (!session) throw new Error('Invalid refresh session.');

    const user = await UserModel.findOne({ _id: session.userId, accountStatus: 'active' })
      .select('username displayName email bio avatarUrl accountStatus accountType professionalCategory professionalOnboardingCompletedAt')
      .lean();
    if (!user) {
      await SessionModel.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt: now } });
      disconnectSessionSockets(String(session._id));
      throw new Error('Account is not available.');
    }

    const safeUser = UserModel.hydrate(user) as unknown as UserWithPasswordHash;
    const accessToken = this.createAccessToken(String(session.userId), String(session._id));
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      user: authUserResponse(safeUser),
      expiresAt: session.expiresAt,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    const sessionId = refreshToken?.split('.')[0];
    if (!sessionId || !/^[a-f\d]{24}$/i.test(sessionId)) return;
    const result = await SessionModel.updateOne(
      { _id: sessionId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    if (result.modifiedCount > 0) disconnectSessionSockets(sessionId);
  }

  async logoutAll(userId: string): Promise<void> {
    await SessionModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    disconnectUserSockets(userId);
  }

  private async createSession(user: UserWithPasswordHash): Promise<AuthSessionResult> {
    const sessionId = new Types.ObjectId();
    const refreshToken = createRefreshToken(String(sessionId));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + getSessionLifetimeMs(this.config.REFRESH_TOKEN_TTL));
    await SessionModel.create({
      _id: sessionId,
      userId: user._id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      tokenFamily: randomUUID(),
      expiresAt,
      lastUsedAt: now,
    });

    return {
      accessToken: this.createAccessToken(user.id ?? String(user._id), String(sessionId)),
      refreshToken,
      user: authUserResponse(user),
      expiresAt,
    };
  }

  private createAccessToken(subjectId: string, sessionId: string): string {
    const secret = this.config.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new Error('JWT access secret is not configured.');
    }

    return sign(
      {
        sub: subjectId,
        sid: sessionId,
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

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  user: Record<string, unknown>;
  expiresAt: Date;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createRefreshToken(sessionId: string): string {
  return `${sessionId}.${randomBytes(32).toString('hex')}`;
}

function getSessionLifetimeMs(configuredTtl: string): number {
  const [, amount, unit] = /^(\d+)([smhd])$/.exec(configuredTtl) ?? [];
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
  return Math.min(Number(amount) * multiplier, maximumSessionLifetimeMs);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

function duplicateKeyField(error: unknown): 'username' | 'email' {
  if (typeof error === 'object' && error !== null && 'keyPattern' in error &&
      typeof error.keyPattern === 'object' && error.keyPattern !== null && 'username' in error.keyPattern) {
    return 'username';
  }
  return 'email';
}

function authUserResponse(user: UserWithPasswordHash): Record<string, unknown> {
  return {
    ...user.toJSON(),
    professionalOnboardingCompletedAt: user.professionalOnboardingCompletedAt ?? null,
  };
}
