import { Schema, model, type InferSchemaType } from 'mongoose';

const bookmarkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
  },
  { timestamps: true, strict: 'throw' },
);

bookmarkSchema.index({ userId: 1, postId: 1 }, { unique: true, name: 'bookmark_user_post_unique' });
bookmarkSchema.index({ userId: 1, _id: -1 }, { name: 'bookmark_user_page' });

export type Bookmark = InferSchemaType<typeof bookmarkSchema>;
export const BookmarkModel = model<Bookmark>('Bookmark', bookmarkSchema);
