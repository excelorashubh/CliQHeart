import { Schema, model, type InferSchemaType } from 'mongoose';

const postSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', required: true, unique: true },
    caption: { type: String, trim: true, maxlength: 2200, default: '' },
    hashtags: { type: [String], default: [] },
    location: { type: String, trim: true, maxlength: 120 },
    altText: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, strict: 'throw' },
);

postSchema.index({ createdAt: -1 }, { name: 'post_feed_created' });
postSchema.index({ ownerId: 1, createdAt: -1 }, { name: 'post_owner_created' });
postSchema.index({ hashtags: 1, createdAt: -1, _id: -1 }, { name: 'post_hashtags_created' });

export type Post = InferSchemaType<typeof postSchema>;
export const PostModel = model<Post>('Post', postSchema);
