import { Schema, model, type InferSchemaType } from 'mongoose';

const storyViewSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, ref: 'Story', required: true },
    viewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    viewedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false, strict: 'throw' },
);
storyViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true, name: 'story_view_unique' });
storyViewSchema.index({ storyId: 1, _id: -1 }, { name: 'story_viewer_page' });

const storyLikeSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, ref: 'Story', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw' },
);
storyLikeSchema.index({ storyId: 1, userId: 1 }, { unique: true, name: 'story_like_unique' });
storyLikeSchema.index({ storyId: 1, _id: -1 }, { name: 'story_like_count' });

const storyReactionSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, ref: 'Story', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, enum: ['❤️', '😂', '😮', '😢', '🔥', '👏', '🥰', '😍'], required: true },
  },
  { timestamps: true, strict: 'throw' },
);
storyReactionSchema.index(
  { storyId: 1, senderId: 1, emoji: 1 },
  { unique: true, name: 'story_reaction_unique' },
);
storyReactionSchema.index({ receiverId: 1, createdAt: -1 }, { name: 'story_reaction_inbox' });

const storyReportSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, ref: 'Story', required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true, strict: 'throw' },
);
storyReportSchema.index(
  { storyId: 1, reporterId: 1 },
  { unique: true, name: 'story_report_unique' },
);

export type StoryView = InferSchemaType<typeof storyViewSchema>;
export type StoryLike = InferSchemaType<typeof storyLikeSchema>;
export type StoryReaction = InferSchemaType<typeof storyReactionSchema>;
export type StoryReport = InferSchemaType<typeof storyReportSchema>;
export const StoryViewModel = model<StoryView>('StoryView', storyViewSchema);
export const StoryLikeModel = model<StoryLike>('StoryLike', storyLikeSchema);
export const StoryReactionModel = model<StoryReaction>('StoryReaction', storyReactionSchema);
export const StoryReportModel = model<StoryReport>('StoryReport', storyReportSchema);
