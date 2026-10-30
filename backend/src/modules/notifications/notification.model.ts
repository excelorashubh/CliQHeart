import { Schema, model, type InferSchemaType } from 'mongoose';

const notificationSchema = new Schema(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['follow', 'tag', 'message', 'like', 'comment', 'reply', 'repost', 'story_like', 'story_reaction'], required: true },
    postId: { type: Schema.Types.ObjectId, ref: 'Post' },
    reelId: { type: Schema.Types.ObjectId, ref: 'Reel' },
    commentId: { type: Schema.Types.ObjectId, ref: 'Comment' },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation' },
    storyId: { type: Schema.Types.ObjectId, ref: 'Story' },
    deduplicationKey: { type: String },
    readAt: { type: Date },
  },
  { timestamps: true, strict: 'throw' },
);

notificationSchema.index(
  { deduplicationKey: 1 },
  { unique: true, sparse: true, name: 'notification_deduplication_unique' },
);
notificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 }, { name: 'notification_inbox_page' });

export type Notification = InferSchemaType<typeof notificationSchema>;
export const NotificationModel = model<Notification>('Notification', notificationSchema);
