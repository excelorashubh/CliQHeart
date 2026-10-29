import mongoose, { type ClientSession } from 'mongoose';
import { UserModel } from '../../models/user';
import { NotificationModel } from '../notifications/notification.model';
import { FollowModel } from './follow.model';
import { recordProfessionalEvent } from '../professional/professional.service';
import { ConversationModel } from '../messages/conversation.model';
import { emitConversationCreated } from '../messages/realtime';

export interface FollowMutationDependencies {
  startSession: () => Promise<ClientSession>;
  lockActiveUsers: (userIds: string[], session: ClientSession) => Promise<boolean>;
  createFollow: (
    followerId: string,
    followedId: string,
    session: ClientSession,
  ) => Promise<{ createdId?: string }>;
  deleteFollow: (followerId: string, followedId: string, session: ClientSession) => Promise<unknown>;
  createFollowNotification: (
    recipientId: string,
    actorId: string,
    createdId: string,
    session: ClientSession,
  ) => Promise<void>;
  recordRelationshipEvent?: (
    ownerId: string,
    viewerId: string,
    eventType: 'follow' | 'unfollow',
    mutationKey: string,
  ) => Promise<void>;
  ensureMutualConversation?: (
    firstUserId: string,
    secondUserId: string,
    session: ClientSession,
  ) => Promise<{ conversationId: string; created: boolean } | undefined>;
  publishConversationCreated?: (
    conversationId: string,
    firstUserId: string,
    secondUserId: string,
  ) => void;
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
    const deleted = await FollowModel.findOneAndDelete({ followerId, followedId }, { session }).select('_id').lean();
    return deleted ? String(deleted._id) : undefined;
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
  recordRelationshipEvent: (ownerId, viewerId, eventType, mutationKey) =>
    recordProfessionalEvent(ownerId, viewerId, eventType, undefined, mutationKey),
  ensureMutualConversation: async (firstUserId, secondUserId, session) => {
    const mutualFollow = await FollowModel.exists({
      followerId: secondUserId,
      followedId: firstUserId,
    }).session(session);
    if (!mutualFollow) return undefined;
    const participantPair = [firstUserId, secondUserId].sort().join(':');
    const existing = await ConversationModel.findOne({ participantPair }).select('_id').session(session);
    if (existing) return { conversationId: String(existing._id), created: false };
    const conversation = await ConversationModel.findOneAndUpdate(
      { participantPair },
      { $setOnInsert: { participantPair, participants: [firstUserId, secondUserId] } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true },
    );
    if (!conversation) throw new Error('Mutual-follow conversation could not be created.');
    return { conversationId: String(conversation._id), created: true };
  },
  publishConversationCreated: emitConversationCreated,
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
  let relationshipEvent:
    | { ownerId: string; viewerId: string; eventType: 'follow' | 'unfollow'; mutationKey: string }
    | undefined;
  let createdConversation:
    | { conversationId: string; firstUserId: string; secondUserId: string }
    | undefined;
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
          relationshipEvent = {
            ownerId: followedId,
            viewerId: followerId,
            eventType: 'follow',
            mutationKey: `follow:${result.createdId}`,
          };
        }
        const mutualConversation = await dependencies.ensureMutualConversation?.(
          followerId,
          followedId,
          session,
        );
        if (mutualConversation?.created) {
          createdConversation = {
            conversationId: mutualConversation.conversationId,
            firstUserId: followerId,
            secondUserId: followedId,
          };
        }
      } else {
        const deletedId = await dependencies.deleteFollow(followerId, followedId, session);
        if (typeof deletedId === 'string') {
          relationshipEvent = {
            ownerId: followedId,
            viewerId: followerId,
            eventType: 'unfollow',
            mutationKey: `unfollow:${deletedId}`,
          };
        }
      }
    });
    if (createdConversation) {
      dependencies.publishConversationCreated?.(
        createdConversation.conversationId,
        createdConversation.firstUserId,
        createdConversation.secondUserId,
      );
    }
    if (relationshipEvent && dependencies.recordRelationshipEvent) {
      try {
        await dependencies.recordRelationshipEvent(
          relationshipEvent.ownerId,
          relationshipEvent.viewerId,
          relationshipEvent.eventType,
          relationshipEvent.mutationKey,
        );
      } catch (error) {
        console.error(JSON.stringify({
          event: 'professional_analytics_write_failed',
          type: relationshipEvent.eventType,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }));
      }
    }
  } finally {
    await session.endSession();
  }
}
