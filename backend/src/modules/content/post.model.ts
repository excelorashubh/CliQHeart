import { Schema, model, type InferSchemaType } from 'mongoose';

const postSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', required: true, unique: true },
    caption: { type: String, trim: true, maxlength: 2200, default: '' },
  },
  { timestamps: true, strict: 'throw' },
);

postSchema.index({ createdAt: -1 }, { name: 'post_feed_created' });
postSchema.index({ ownerId: 1, createdAt: -1 }, { name: 'post_owner_created' });

export type Post = InferSchemaType<typeof postSchema>;
export const PostModel = model<Post>('Post', postSchema);
