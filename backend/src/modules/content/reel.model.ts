import { Schema, model, type InferSchemaType } from 'mongoose';

const reelSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', required: true, unique: true },
    caption: { type: String, trim: true, maxlength: 2200, default: '' },
    location: { type: String, trim: true, maxlength: 120 },
    aiDisclosure: { type: Boolean, default: false },
  },
  { timestamps: true, strict: 'throw' },
);

reelSchema.index({ createdAt: -1 }, { name: 'reel_feed_created' });
reelSchema.index({ ownerId: 1, createdAt: -1 }, { name: 'reel_owner_created' });

export type Reel = InferSchemaType<typeof reelSchema>;
export const ReelModel = model<Reel>('Reel', reelSchema);
