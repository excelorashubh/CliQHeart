import assert from 'node:assert/strict';
import test from 'node:test';
import { registerSchema, loginSchema } from './auth.validation';

test('register validation requires password matching and agreement terms', () => {
  assert.throws(() => registerSchema.parse({
    displayName: 'Test User',
    username: 'test_user',
    email: 'test@example.com',
    password: 'Password123!',
    confirmPassword: 'WrongPass123!',
    agreeToTerms: true,
  }));

  assert.throws(() => registerSchema.parse({
    displayName: 'Test User',
    username: 'test_user',
    email: 'test@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
    agreeToTerms: false,
  }));
});

test('login validation requires identifier and password', () => {
  const result = loginSchema.parse({
    identifier: 'test@example.com',
    password: 'Password123!',
  });

  assert.equal(result.identifier, 'test@example.com');
  assert.equal(result.password, 'Password123!');
});
