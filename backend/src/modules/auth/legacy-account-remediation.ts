export interface LegacyPendingAccount {
  accountStatus?: unknown;
  isEmailVerified?: unknown;
  isPhoneVerified?: unknown;
  approvalStatus?: unknown;
  requiresAdminApproval?: unknown;
  adminApprovalRequired?: unknown;
  suspendedAt?: unknown;
  deletedAt?: unknown;
  pendingReason?: unknown;
}

export function isEligibleLegacyVerificationAccount(account: LegacyPendingAccount): boolean {
  if (
    account.accountStatus !== 'pending' ||
    account.isEmailVerified !== true ||
    account.isPhoneVerified !== true ||
    account.requiresAdminApproval === true ||
    account.adminApprovalRequired === true ||
    account.suspendedAt != null ||
    account.deletedAt != null
  ) {
    return false;
  }

  if (account.approvalStatus != null && account.approvalStatus !== 'not_required') {
    return false;
  }

  if (account.pendingReason != null && account.pendingReason !== 'verification') {
    return false;
  }

  return true;
}