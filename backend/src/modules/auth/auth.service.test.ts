import assert from 'node:assert/strict';
import test from 'node:test';
import argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { UserModel } from '../../models/user';
import { SessionModel } from './session.model';
import { AuthService, hashRefreshToken } from './auth.service';
import { loadConfig } from '../../config/env';

const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/cliqheart',
  JWT_ACCESS_SECRET: 'test-jwt-access-secret-at-least-32-chars-long',
  JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-at-least-32-chars-long',
});

const validInput = {
  displayName: 'Test User',
  username: 'test_user',
  email: 'test@example.com',
  password: 'Password123!',
  confirmPassword: 'Password123!',
  agreeToTerms: true,
};

type MockableUserModel = {
  findOne: (...args: unknown[]) => unknown;
  create: (...args: unknown[]) => Promise<unknown>;
};

type MockableSessionModel = {
  create: (...args: unknown[]) => Promise<unknown>;
  findOneAndUpdate: (...args: unknown[]) => unknown;
  updateOne: (...args: unknown[]) => Promise<unknown>;
  updateMany: (...args: unknown[]) => Promise<unknown>;
};

function mockUserModel(): MockableUserModel {
  return UserModel as unknown as MockableUserModel;
}

function mockSessionModel(): MockableSessionModel {
  return SessionModel as unknown as MockableSessionModel;
}

function makeUser(passwordHash: string, accountStatus = 'active', legacyFlags?: boolean) {
  const user: Record<string, unknown> = {
    id: 'user-id',
    _id: 'user-id',
    passwordHash,
    accountStatus,
    toJSON: () => ({ id: 'user-id', username: 'test_user', email: 'test@example.com', accountStatus }),
  };
  if (legacyFlags !== undefined) {
    user.isEmailVerified = legacyFlags;
    user.isPhoneVerified = legacyFlags;
  }
  return user;
}

function loginQuery(user: Record<string, unknown>) {
  return { select: async () => user };
}

test('registration persists an active user with an Argon2 hash and no verification fields', async (t) => {
  let createdUserData: Record<string, unknown> | undefined;
  let createdSessionData: Record<string, unknown> | undefined;
  const savedUser = {
    toJSON: () => ({ id: 'user-id', username: 'test_user', email: 'test@example.com', accountStatus: 'active' }),
  };
  t.mock.method(mockUserModel(), 'findOne', () => null);
  t.mock.method(mockUserModel(), 'create', async (data: Record<string, unknown>) => {
    createdUserData = data;
    return savedUser;
  });
  t.mock.method(mockSessionModel(), 'create', async (data: Record<string, unknown>) => {
    createdSessionData = data;
    return { _id: data._id };
  });

  const result = await new AuthService(config).register(validInput);

  assert.equal(createdUserData?.accountStatus, 'active');
  assert.equal('isEmailVerified' in (createdUserData ?? {}), false);
  assert.equal('isPhoneVerified' in (createdUserData ?? {}), false);
  assert.equal(await argon2.verify(String(createdUserData?.passwordHash), validInput.password), true);
  assert.equal('passwordHash' in result.user, false);
  assert.ok(result.accessToken);
  const accessPayload = jwt.verify(result.accessToken, config.JWT_ACCESS_SECRET!, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
  assert.equal(typeof accessPayload === 'string' ? undefined : accessPayload.exp! - accessPayload.iat!, 15 * 60);
  assert.match(result.refreshToken, /^[a-f\d]{24}\.[a-f\d]{64}$/i);
  const createdAt = createdSessionData?.lastUsedAt as Date;
  assert.equal(
    result.expiresAt.getTime() - createdAt.getTime(),
    365 * 24 * 60 * 60 * 1000,
  );
});

test('registration and immediate login work without email or SMS provider configuration', async (t) => {
  let lookupCount = 0;
  let savedData: Record<string, unknown> | undefined;
  const storedUser = makeUser('', 'active');
  t.mock.method(mockUserModel(), 'findOne', () => {
    lookupCount += 1;
    return lookupCount === 1 ? null : loginQuery(storedUser);
  });
  t.mock.method(mockUserModel(), 'create', async (data: Record<string, unknown>) => {
    savedData = data;
    storedUser.passwordHash = data.passwordHash;
    return { toJSON: () => ({ id: 'user-id', username: 'test_user', accountStatus: 'active' }) };
  });
  let sessionData: Record<string, unknown> | undefined;
  t.mock.method(mockSessionModel(), 'create', async (data: Record<string, unknown>) => {
    sessionData = data;
    return { _id: data._id };
  });

  const service = new AuthService(config);
  const registration = await service.register(validInput);
  const login = await service.login({ identifier: validInput.email, password: validInput.password });

  assert.equal(registration.user.accountStatus, 'active');
  assert.ok(login.accessToken.length > 0);
  assert.match(login.refreshToken, /^[a-f\d]{24}\.[a-f\d]{64}$/i);
  assert.equal(sessionData?.userId, 'user-id');
  assert.equal(typeof sessionData?.refreshTokenHash, 'string');
  assert.equal(sessionData?.refreshTokenHash, hashRefreshToken(login.refreshToken));
  assert.equal(
    (sessionData?.expiresAt as Date).getTime() - (sessionData?.lastUsedAt as Date).getTime(),
    365 * 24 * 60 * 60 * 1000,
  );
  assert.equal('passwordHash' in login.user, false);
  assert.equal('isEmailVerified' in (savedData ?? {}), false);
});

test('login accepts absent and false legacy verification flags', async (t) => {
  const passwordHash = await argon2.hash(validInput.password);
  let currentUser = makeUser(passwordHash, 'active', false);
  t.mock.method(mockUserModel(), 'findOne', () => loginQuery(currentUser));
  t.mock.method(mockSessionModel(), 'create', async () => ({}));
  const service = new AuthService(config);

  const falseFlagsLogin = await service.login({ identifier: validInput.username, password: validInput.password });
  currentUser = makeUser(passwordHash, 'active');
  const absentFlagsLogin = await service.login({ identifier: validInput.username, password: validInput.password });

  assert.ok(falseFlagsLogin.accessToken);
  assert.ok(absentFlagsLogin.accessToken);
});

test('refresh rotates the token hash and keeps the original absolute expiry', async (t) => {
  const passwordHash = await argon2.hash(validInput.password);
  const user = makeUser(passwordHash);
  let sessionData: Record<string, unknown> | undefined;
  t.mock.method(mockUserModel(), 'findOne', (query: Record<string, unknown>) => {
    if ('accountStatus' in query) {
      return { select: () => ({ lean: async () => ({ _id: '0123456789abcdef01234567', username: 'test_user', displayName: 'Test User', accountStatus: 'active' }) }) };
    }
    return loginQuery(user);
  });
  t.mock.method(mockSessionModel(), 'create', async (data: Record<string, unknown>) => {
    sessionData = data;
    return { _id: data._id };
  });
  const service = new AuthService(config);
  const login = await service.login({ identifier: validInput.email, password: validInput.password });
  const expiresAt = sessionData?.expiresAt as Date;
  const createdAt = sessionData?.lastUsedAt as Date;
  let storedHash = String(sessionData?.refreshTokenHash);
  let capturedFilter: Record<string, unknown> | undefined;
  let capturedUpdate: Record<string, unknown> | undefined;
  let capturedExpiryFilter: Date | undefined;
  t.mock.method(mockSessionModel(), 'findOneAndUpdate', async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => {
    capturedFilter = filter;
    capturedUpdate = update;
    if (filter.refreshTokenHash !== storedHash) return null;
    capturedExpiryFilter = (filter.expiresAt as { $gt: Date }).$gt;
    storedHash = String((update.$set as Record<string, unknown>).refreshTokenHash);
    return { _id: (filter._id as { toString(): string }).toString(), userId: 'user-id', expiresAt };
  });
  const firstRefresh = await service.refresh(login.refreshToken);

  assert.notEqual(firstRefresh.refreshToken, login.refreshToken);
  assert.equal(capturedFilter?.refreshTokenHash, hashRefreshToken(login.refreshToken));
  assert.equal(capturedUpdate && (capturedUpdate.$set as Record<string, unknown>).refreshTokenHash, hashRefreshToken(firstRefresh.refreshToken));
  assert.ok(capturedExpiryFilter instanceof Date);
  assert.ok(capturedExpiryFilter < expiresAt);
  assert.equal(expiresAt.getTime() - createdAt.getTime(), 365 * 24 * 60 * 60 * 1000);
  await assert.rejects(service.refresh(login.refreshToken), { message: 'Invalid refresh session.' });
});

test('an expired refresh session is rejected using the absolute expiry filter', async (t) => {
  let expiryFilter: Date | undefined;
  t.mock.method(mockSessionModel(), 'findOneAndUpdate', async (filter: Record<string, unknown>) => {
    expiryFilter = (filter.expiresAt as { $gt: Date }).$gt;
    return null;
  });

  await assert.rejects(
    new AuthService(config).refresh('0123456789abcdef01234567.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
    { message: 'Invalid refresh session.' },
  );
  assert.ok(expiryFilter instanceof Date);
});

test('logout revokes the active session and logout-all revokes a user’s sessions', async (t) => {
  let revokedId: string | undefined;
  let revokedUser: string | undefined;
  t.mock.method(mockSessionModel(), 'updateOne', async (filter: Record<string, unknown>) => {
    revokedId = String(filter._id);
    return {};
  });
  t.mock.method(mockSessionModel(), 'updateMany', async (filter: Record<string, unknown>) => {
    revokedUser = String(filter.userId);
    return {};
  });

  const service = new AuthService(config);
  await service.logout('0123456789abcdef01234567.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  await service.logoutAll('user-id');
  assert.equal(revokedId, '0123456789abcdef01234567');
  assert.equal(revokedUser, 'user-id');
});

test('invalid passwords are rejected without creating a session', async (t) => {
  const user = makeUser(await argon2.hash(validInput.password));
  t.mock.method(mockUserModel(), 'findOne', () => loginQuery(user));
  let sessionCreated = false;
  t.mock.method(mockSessionModel(), 'create', async () => {
    sessionCreated = true;
    return {};
  });

  await assert.rejects(
    new AuthService(config).login({ identifier: validInput.email, password: 'WrongPassword123' }),
    { message: 'Invalid credentials.' },
  );
  assert.equal(sessionCreated, false);
});

test('pending, suspended, and deleted accounts are blocked after password validation', async (t) => {
  const passwordHash = await argon2.hash(validInput.password);
  let currentUser = makeUser(passwordHash, 'pending');
  t.mock.method(mockUserModel(), 'findOne', () => loginQuery(currentUser));
  for (const [status, message] of [
    ['pending', 'Account is pending approval.'],
    ['suspended', 'Account is suspended.'],
    ['deleted', 'Account is deleted.'],
  ]) {
    currentUser = makeUser(passwordHash, status);
    await assert.rejects(
      new AuthService(config).login({ identifier: validInput.email, password: validInput.password }),
      { message },
    );
  }
});

test('duplicate usernames are rejected before hashing or creating another user', async (t) => {
  t.mock.method(mockUserModel(), 'findOne', () => ({ id: 'existing-user', username: validInput.username }));
  let created = false;
  t.mock.method(mockUserModel(), 'create', async () => {
    created = true;
    return {};
  });

  await assert.rejects(new AuthService(config).register(validInput), { message: 'Username already exists.' });
  assert.equal(created, false);
});

test('duplicate username index races return a username-specific registration error', async (t) => {
  t.mock.method(mockUserModel(), 'findOne', () => null);
  t.mock.method(mockUserModel(), 'create', async () => {
    throw Object.assign(new Error('Duplicate key'), {
      code: 11000,
      keyPattern: { username: 1 },
    });
  });

  await assert.rejects(new AuthService(config).register(validInput), {
    message: 'Username already exists.',
  });
});
