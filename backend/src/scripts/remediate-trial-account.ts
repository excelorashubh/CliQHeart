import mongoose from 'mongoose';
import { loadConfig } from '../config/env';
import { closeDatabase, connectDatabase } from '../db/mongoose';
import { isEligibleLegacyVerificationAccount } from '../modules/auth/legacy-account-remediation';

const targetEmail = 'trial@gmail.com';
const applyChange = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-trial-account');
const verificationOnlyConfirmed = process.argv.includes('--confirm-verification-only');

async function remediateTrialAccount(): Promise<void> {
  const config = loadConfig();
  try {
    await connectDatabase(config.MONGODB_URI, config.MONGODB_DB_NAME);
    const users = mongoose.connection.collection('users');
    const account = await users.findOne(
      { email: targetEmail },
      {
        projection: {
          accountStatus: 1,
          isEmailVerified: 1,
          isPhoneVerified: 1,
          approvalStatus: 1,
          requiresAdminApproval: 1,
          adminApprovalRequired: 1,
          suspendedAt: 1,
          deletedAt: 1,
          pendingReason: 1,
        },
      },
    );

    if (!account) {
      console.info('Target account was not found; no changes made.');
      return;
    }

    const eligibilityFields = {
      accountStatus: account.accountStatus,
      isEmailVerified: account.isEmailVerified,
      isPhoneVerified: account.isPhoneVerified,
      approvalStatus: account.approvalStatus,
      requiresAdminApproval: account.requiresAdminApproval,
      adminApprovalRequired: account.adminApprovalRequired,
      suspendedAt: account.suspendedAt,
      deletedAt: account.deletedAt,
      pendingReason: account.pendingReason,
    };

    if (!isEligibleLegacyVerificationAccount(eligibilityFields)) {
      console.info('Target account is not eligible for automatic remediation; no changes made.');
      return;
    }

    if (!applyChange || !confirmed || !verificationOnlyConfirmed) {
      console.info('Target account is eligible. Dry run only; no changes made.');
      console.info(
        'To apply after confirming no separate approval restriction, pass --apply --confirm-trial-account --confirm-verification-only.',
      );
      return;
    }

    const result = await users.updateOne(
      {
        _id: account._id,
        email: targetEmail,
        accountStatus: 'pending',
        isEmailVerified: true,
        isPhoneVerified: true,
        requiresAdminApproval: { $ne: true },
        adminApprovalRequired: { $ne: true },
        suspendedAt: null,
        deletedAt: null,
        $or: [{ approvalStatus: null }, { approvalStatus: 'not_required' }],
        $and: [{ $or: [{ pendingReason: null }, { pendingReason: 'verification' }] }],
      },
      {
        $set: { accountStatus: 'active' },
        $unset: { isEmailVerified: '', isPhoneVerified: '', pendingReason: '' },
      },
    );

    if (result.modifiedCount !== 1) {
      console.info('Target changed or no longer matches the safety criteria; no changes made.');
      return;
    }

    const updated = await users.findOne(
      { _id: account._id, email: targetEmail },
      { projection: { accountStatus: 1 } },
    );
    console.info(`Target account remediation result: ${updated?.accountStatus === 'active' ? 'active' : 'unconfirmed'}.`);
  } finally {
    await closeDatabase();
  }
}

void remediateTrialAccount().catch(() => {
  console.error('Target account remediation failed; details suppressed.');
  process.exitCode = 1;
});