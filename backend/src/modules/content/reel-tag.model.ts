import { Schema, model, type InferSchemaType } from 'mongoose';

const reelTagSchema = new Schema(
  {
    reelId: { type: Schema.Types.ObjectId, ref: 'Reel', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taggedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw' },
);

reelTagSchema.index({ reelId: 1, userId: 1 }, { unique: true, name: 'reel_tag_pair_unique' });
reelTagSchema.index({ userId: 1, _id: -1 }, { name: 'reel_tag_user_page' });

export type ReelTag = InferSchemaType<typeof reelTagSchema>;
export const ReelTagModel = model<ReelTag>('ReelTag', reelTagSchema);
