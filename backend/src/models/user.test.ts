import assert from 'node:assert/strict';
import test from 'node:test';
import { UserModel } from './user';

const validUser = {
  username: '  Example_User ',
  displayName: ' Example User ',
};

test('user schema defines unique username, optional contact, and creation-time indexes', () => {
  const indexes = UserModel.schema.indexes();

  assert.ok(
    indexes.some(
      ([keys, options]) =>
        keys.username === 1 && options.unique === true && options.name === 'user_username_unique',
    ),
  );
  assert.ok(
    indexes.some(
      ([keys, options]) =>
          keys.email === 1 &&
          options.unique === true &&
          options.partialFilterExpression !== undefined,
    ),
  );
  assert.ok(
    indexes.some(
      ([keys, options]) =>
          keys.phone === 1 &&
          options.unique === true &&
          options.partialFilterExpression !== undefined,
    ),
  );
  assert.ok(indexes.some(([keys]) => keys.createdAt === -1));
});

test('normalizes username, email, and phone and applies profile defaults', () => {
  const user = new UserModel({
    ...validUser,
    username: '  CliQ.Heart_User ',
    email: ' PERSON@EXAMPLE.COM ',
    phone: ' +1 (415) 555-2671 ',
  });

  assert.equal(user.username, 'cliq.heart_user');
  assert.equal(user.displayName, 'Example User');
  assert.equal(user.email, 'person@example.com');
  assert.equal(user.phone, '+14155552671');
  assert.equal(user.accountStatus, 'active');
  assert.equal(UserModel.schema.path('isEmailVerified'), undefined);
  assert.equal(UserModel.schema.path('isPhoneVerified'), undefined);
  assert.equal(UserModel.schema.options.timestamps, true);
});

test('validates required fields, username, optional contacts, profile and account status', () => {
  const invalidUser = new UserModel({
    username: 'x',
    displayName: '',
    email: 'not-an-email',
    phone: '555',
    avatarUrl: 'javascript:alert(1)',
    accountStatus: 'unknown',
  });
  const error = invalidUser.validateSync();

  assert.ok(error);
  assert.ok(error.errors.username);
  assert.ok(error.errors.displayName);
  assert.ok(error.errors.email);
  assert.ok(error.errors.phone);
  assert.ok(error.errors.avatarUrl);
  assert.ok(error.errors.accountStatus);
});

test('password hash is optional, excluded from queries, and never serialized', () => {
  const withoutPassword = new UserModel(validUser);
  assert.equal(withoutPassword.validateSync(), undefined);
  assert.equal(UserModel.schema.path('passwordHash').options.select, false);

  const user = new UserModel({
    ...validUser,
    passwordHash: 'placeholder-hash-for-test-only',
  });
  const json = user.toJSON() as Record<string, unknown>;
  const object = user.toObject() as Record<string, unknown>;

  assert.equal('passwordHash' in json, false);
  assert.equal('__v' in json, false);
  assert.equal('passwordHash' in object, false);
  assert.equal('__v' in object, false);
  assert.equal(json.username, 'example_user');
});
