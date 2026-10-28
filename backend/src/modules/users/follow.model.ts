import { Schema, model, type InferSchemaType } from 'mongoose';

const followSchema = new Schema(
  {
    followerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    followedId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw' },
);

followSchema.index({ followerId: 1, followedId: 1 }, { unique: true, name: 'follow_pair_unique' });
followSchema.index({ followedId: 1, _id: 1 }, { name: 'followers_page' });
followSchema.index({ followerId: 1, _id: 1 }, { name: 'following_page' });

export type Follow = InferSchemaType<typeof followSchema>;
export const FollowModel = model<Follow>('Follow', followSchema);
