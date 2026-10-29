import mongoose, { type ClientSession } from 'mongoose';
import { UserModel } from '../../models/user';
import { NotificationModel } from '../notifications/notification.model';
import { SessionModel } from '../auth/session.model';
import { FollowModel } from './follow.model';

export interface AccountDeletionDependencies {
  startSession: () => Promise<ClientSession>;
  markDeleted: (userId: string, session?: ClientSession) => Promise<unknown>;
  deleteFollowEdges: (userId: string, session?: ClientSession) => Promise<unknown>;
  revokeSessions: (userId: string, revokedAt: Date, session?: ClientSession) => Promise<unknown>;
  deleteNotifications: (userId: string, session?: ClientSession) => Promise<unknown>;
}

const defaultDependencies: AccountDeletionDependencies = {
  startSession: () => mongoose.startSession(),
  markDeleted: (userId, session) => UserModel.updateOne(
    { _id: userId, accountStatus: 'active' },
    { $set: { accountStatus: 'deleted' } },
    session ? { session } : {},
  ),
  deleteFollowEdges: (userId, session) => FollowModel.deleteMany(
    { $or: [{ followerId: userId }, { followedId: userId }] },
    session ? { session } : {},
  ),
  revokeSessions: (userId, revokedAt, session) => SessionModel.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt } },
    session ? { session } : {},
  ),
  deleteNotifications: (userId, session) => NotificationModel.deleteMany(
    { $or: [{ recipientId: userId }, { actorId: userId }] },
    session ? { session } : {},
  ),
};

export class AccountDeletionUnavailableError extends Error {
  constructor() {
    super('Account deletion could not be completed safely. Please try again later.');
    this.name = 'AccountDeletionUnavailableError';
  }
}

function transactionsUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : '';
  return code === 20 ||
    /transactions? (?:are|is) not supported|transaction numbers are only allowed on a replica set/i.test(message);
}

export async function deleteAccount(
  userId: string,
  dependencies: AccountDeletionDependencies = defaultDependencies,
): Promise<void> {
  const session = await dependencies.startSession();
  try {
    await session.withTransaction(async () => {
      const revokedAt = new Date();
      await dependencies.markDeleted(userId, session);
      await dependencies.deleteFollowEdges(userId, session);
      await dependencies.revokeSessions(userId, revokedAt, session);
      await dependencies.deleteNotifications(userId, session);
    });
  } catch (error) {
    if (transactionsUnavailable(error)) {
      try {
        await dependencies.deleteFollowEdges(userId);
        await dependencies.deleteNotifications(userId);
        await dependencies.revokeSessions(userId, new Date());
        await dependencies.markDeleted(userId);
        return;
      } catch (cleanupError) {
        console.error(JSON.stringify({
          event: 'account_deletion_retryable_cleanup_failed',
          errorName: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
        }));
        throw new AccountDeletionUnavailableError();
      }
    }
    console.error(JSON.stringify({
      event: 'account_deletion_transaction_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }));
    throw new AccountDeletionUnavailableError();
  } finally {
    await session.endSession();
  }
}
