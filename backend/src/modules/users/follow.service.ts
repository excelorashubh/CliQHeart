import mongoose, { type ClientSession } from 'mongoose';
import { UserModel } from '../../models/user';
import { NotificationModel } from '../notifications/notification.model';
import { FollowModel } from './follow.model';

export interface FollowMutationDependencies {
  startSession: () => Promise<ClientSession>;
  lockActiveUsers: (userIds: string[], session: ClientSession) => Promise<boolean>;
  createFollow: (
    followerId: string,
    followedId: string,
    session: ClientSession,
  ) => Promise<{ createdId?: string }>;
  deleteFollow: (followerId: string, followedId: string, session: ClientSession) => Promise<void>;
  createFollowNotification: (
    recipientId: string,
    actorId: string,
    createdId: string,
    session: ClientSession,
  ) => Promise<void>;
}

const defaultDependencies: FollowMutationDependencies = {
  startSession: () => mongoose.startSession(),
  lockActiveUsers: async (userIds, session) => {
    for (const userId of userIds) {
      const result = await UserModel.updateOne(
        { _id: userId, accountStatus: 'active' },
        { $inc: { relationshipRevision: 1 } },
        { session, timestamps: false },
      );
      if (result.matchedCount !== 1) return false;
    }
    return true;
  },
  createFollow: async (followerId, followedId, session) => {
    const result = await FollowModel.updateOne(
      { followerId, followedId },
      { $setOnInsert: { followerId, followedId } },
      { upsert: true, session },
    );
    return result.upsertedCount > 0 ? { createdId: String(result.upsertedId) } : {};
  },
  deleteFollow: async (followerId, followedId, session) => {
    await FollowModel.deleteOne({ followerId, followedId }, { session });
  },
  createFollowNotification: async (recipientId, actorId, createdId, session) => {
    await NotificationModel.updateOne(
      { deduplicationKey: `follow:${createdId}` },
      {
        $setOnInsert: {
          recipientId,
          actorId,
          type: 'follow',
          deduplicationKey: `follow:${createdId}`,
        },
      },
      { upsert: true, session },
    );
  },
};

export class FollowAccountUnavailableError extends Error {
  constructor() {
    super('A follow account is no longer available.');
    this.name = 'FollowAccountUnavailableError';
  }
}

export async function changeFollowRelationship(
  followerId: string,
  followedId: string,
  following: boolean,
  dependencies: FollowMutationDependencies = defaultDependencies,
): Promise<void> {
  const session = await dependencies.startSession();
  try {
    await session.withTransaction(async () => {
      const userIds = [followerId, followedId].sort();
      if (!await dependencies.lockActiveUsers(userIds, session)) {
        throw new FollowAccountUnavailableError();
      }
      if (following) {
        const result = await dependencies.createFollow(followerId, followedId, session);
        if (result.createdId) {
          await dependencies.createFollowNotification(followedId, followerId, result.createdId, session);
        }
      } else {
        await dependencies.deleteFollow(followerId, followedId, session);
      }
    });
  } finally {
    await session.endSession();
  }
}
