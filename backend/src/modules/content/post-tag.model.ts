import { Schema, model, type InferSchemaType } from 'mongoose';

const postTagSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taggedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw' },
);

postTagSchema.index({ postId: 1, userId: 1 }, { unique: true, name: 'post_tag_pair_unique' });
postTagSchema.index({ userId: 1, _id: -1 }, { name: 'post_tag_user_page' });

export type PostTag = InferSchemaType<typeof postTagSchema>;
export const PostTagModel = model<PostTag>('PostTag', postTagSchema);
