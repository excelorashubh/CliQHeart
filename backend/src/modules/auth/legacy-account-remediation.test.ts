import assert from 'node:assert/strict';
import test from 'node:test';
import { isEligibleLegacyVerificationAccount } from './legacy-account-remediation';

const eligibleLegacyAccount = {
  accountStatus: 'pending',
  isEmailVerified: true,
  isPhoneVerified: true,
};

test('verified legacy pending account is eligible for targeted remediation', () => {
  assert.equal(isEligibleLegacyVerificationAccount(eligibleLegacyAccount), true);
});

test('remediation rejects accounts with approval, suspension, or deletion markers', () => {
  assert.equal(
    isEligibleLegacyVerificationAccount({ ...eligibleLegacyAccount, approvalStatus: 'pending' }),
    false,
  );
  assert.equal(
    isEligibleLegacyVerificationAccount({ ...eligibleLegacyAccount, requiresAdminApproval: true }),
    false,
  );
  assert.equal(
    isEligibleLegacyVerificationAccount({ ...eligibleLegacyAccount, suspendedAt: new Date() }),
    false,
  );
  assert.equal(
    isEligibleLegacyVerificationAccount({ ...eligibleLegacyAccount, deletedAt: new Date() }),
    false,
  );
  assert.equal(
    isEligibleLegacyVerificationAccount({ ...eligibleLegacyAccount, isPhoneVerified: false }),
    false,
  );
});