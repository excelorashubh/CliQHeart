import assert from 'node:assert/strict';
import test from 'node:test';
import { UserService } from './user.service';
import { userProfileUpdateSchema } from './user.validation';

test('user service builds a validated, normalized draft without saving it', () => {
  const draft = new UserService().buildDraft({
    username: ' CliQ.Heart ',
    email: ' PERSON@EXAMPLE.COM ',
    phone: ' +1 (415) 555-2671 ',
    displayName: ' CliQ Heart ',
  });

  test('profile updates accept only permitted, validated profile fields', () => {
    assert.deepEqual(
      userProfileUpdateSchema.parse({
        displayName: '  CliQ Heart ',
        bio: '  Hello  ',
      }),
      {
        displayName: 'CliQ Heart',
        bio: 'Hello',
      },
    );
    assert.throws(() => userProfileUpdateSchema.parse({ email: 'private@example.com' }));
    assert.throws(() => userProfileUpdateSchema.parse({ username: 'no spaces' }));
  });

  assert.equal(draft.username, 'cliq.heart');
  assert.equal(draft.email, 'person@example.com');
  assert.equal(draft.phone, '+14155552671');
  assert.equal(draft.displayName, 'CliQ Heart');
  assert.equal(draft.accountStatus, 'active');
  assert.equal(draft.get('isEmailVerified'), undefined);
  assert.equal(draft.get('isPhoneVerified'), undefined);
  assert.equal(draft.isNew, true);
});

test('user service rejects invalid and unknown fields without accepting password hashes', () => {
  assert.throws(
    () =>
      new UserService().buildDraft({
        username: 'a',
        displayName: '',
        passwordHash: 'not-allowed',
      }),
  );
});
