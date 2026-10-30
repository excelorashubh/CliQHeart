import { NotificationModel } from './notification.model';

export type NotificationType = 'follow' | 'tag' | 'message' | 'like' | 'comment' | 'reply' | 'repost';

export async function createNotificationSafely(input: {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  postId?: string;
  reelId?: string;
  commentId?: string;
  conversationId?: string;
  deduplicationKey: string;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  try {
    await NotificationModel.updateOne(
      { deduplicationKey: input.deduplicationKey },
      { $setOnInsert: input },
      { upsert: true },
    );
  } catch (error) {
    console.error('Could not persist a notification.', error);
  }
}
