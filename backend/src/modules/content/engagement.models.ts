import { Schema, model, type InferSchemaType } from 'mongoose';

const contentType = {
  type: String,
  enum: ['post', 'reel'],
  required: true,
} as const;

const likeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contentId: { type: Schema.Types.ObjectId, required: true },
    contentType,
  },
  { timestamps: true, strict: 'throw' },
);
likeSchema.index(
  { userId: 1, contentType: 1, contentId: 1 },
  { unique: true, name: 'like_user_content_unique' },
);
likeSchema.index({ contentType: 1, contentId: 1, createdAt: -1 }, { name: 'like_content_page' });

const commentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contentId: { type: Schema.Types.ObjectId, required: true },
    contentType,
    text: { type: String, trim: true, required: true, maxlength: 2200 },
    parentCommentId: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
  },
  { timestamps: true, strict: 'throw' },
);
commentSchema.index(
  { contentType: 1, contentId: 1, parentCommentId: 1, createdAt: 1, _id: 1 },
  { name: 'comment_content_thread_page' },
);
commentSchema.index({ userId: 1, createdAt: -1 }, { name: 'comment_user_page' });

const commentLikeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    commentId: { type: Schema.Types.ObjectId, ref: 'Comment', required: true },
  },
  { timestamps: true, strict: 'throw' },
);
commentLikeSchema.index(
  { userId: 1, commentId: 1 },
  { unique: true, name: 'comment_like_user_comment_unique' },
);
commentLikeSchema.index({ commentId: 1, createdAt: -1 }, { name: 'comment_like_comment_page' });

const repostSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contentId: { type: Schema.Types.ObjectId, required: true },
    contentType,
  },
  { timestamps: true, strict: 'throw' },
);
repostSchema.index(
  { userId: 1, contentType: 1, contentId: 1 },
  { unique: true, name: 'repost_user_content_unique' },
);
repostSchema.index({ contentType: 1, contentId: 1, createdAt: -1 }, { name: 'repost_content_page' });
repostSchema.index({ userId: 1, createdAt: -1 }, { name: 'repost_user_page' });

export type Like = InferSchemaType<typeof likeSchema>;
export type Comment = InferSchemaType<typeof commentSchema>;
export type CommentLike = InferSchemaType<typeof commentLikeSchema>;
export type Repost = InferSchemaType<typeof repostSchema>;

export const LikeModel = model<Like>('Like', likeSchema);
export const CommentModel = model<Comment>('Comment', commentSchema);
export const CommentLikeModel = model<CommentLike>('CommentLike', commentLikeSchema);
export const RepostModel = model<Repost>('Repost', repostSchema);
