import assert from 'node:assert/strict';
import test from 'node:test';
import argon2 from 'argon2';
import { UserModel } from '../../models/user';
import { SessionModel } from './session.model';
import { AuthService } from './auth.service';
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
  const savedUser = {
    toJSON: () => ({ id: 'user-id', username: 'test_user', email: 'test@example.com', accountStatus: 'active' }),
  };
  t.mock.method(mockUserModel(), 'findOne', () => null);
  t.mock.method(mockUserModel(), 'create', async (data: Record<string, unknown>) => {
    createdUserData = data;
    return savedUser;
  });

  const result = await new AuthService(config).register(validInput);

  assert.equal(createdUserData?.accountStatus, 'active');
  assert.equal('isEmailVerified' in (createdUserData ?? {}), false);
  assert.equal('isPhoneVerified' in (createdUserData ?? {}), false);
  assert.equal(await argon2.verify(String(createdUserData?.passwordHash), validInput.password), true);
  assert.equal('passwordHash' in result.user, false);
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
    return {};
  });

  const service = new AuthService(config);
  const registration = await service.register(validInput);
  const login = await service.login({ identifier: validInput.email, password: validInput.password });

  assert.equal(registration.user.accountStatus, 'active');
  assert.ok(login.accessToken.length > 0);
  assert.match(login.refreshToken, /^[a-f0-9]{64}$/);
  assert.equal(sessionData?.userId, 'user-id');
  assert.equal(typeof sessionData?.refreshTokenHash, 'string');
  assert.equal(await argon2.verify(String(sessionData?.refreshTokenHash), login.refreshToken), true);
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

test('duplicate username or email is rejected before hashing or creating another user', async (t) => {
  t.mock.method(mockUserModel(), 'findOne', () => ({ id: 'existing-user' }));
  let created = false;
  t.mock.method(mockUserModel(), 'create', async () => {
    created = true;
    return {};
  });

  await assert.rejects(new AuthService(config).register(validInput), { message: 'User already exists.' });
  assert.equal(created, false);
});
