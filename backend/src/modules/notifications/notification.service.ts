import { NotificationModel } from './notification.model';
import { emitNotificationUnreadCount } from '../messages/realtime';

export type NotificationType = 'follow' | 'tag' | 'message' | 'like' | 'comment' | 'reply' | 'repost' | 'story_like' | 'story_reaction';

export async function createNotificationSafely(input: {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  postId?: string;
  reelId?: string;
  commentId?: string;
  conversationId?: string;
  storyId?: string;
  deduplicationKey: string;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  try {
    const result = await NotificationModel.updateOne(
      { deduplicationKey: input.deduplicationKey },
      { $setOnInsert: input },
      { upsert: true },
    );
    if (result.upsertedCount > 0) {
      const unreadCount = await NotificationModel.countDocuments({
        recipientId: input.recipientId,
        readAt: { $exists: false },
      });
      emitNotificationUnreadCount(input.recipientId, unreadCount);
    }
  } catch (error) {
    console.error('Could not persist or publish a notification.', error);
  }
}
