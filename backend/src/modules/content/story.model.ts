import { Schema, model, type InferSchemaType } from 'mongoose';

const storySchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', required: true, unique: true },
    caption: { type: String, trim: true, maxlength: 500, default: '' },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, strict: 'throw' },
);

storySchema.index({ ownerId: 1, expiresAt: 1, createdAt: -1 }, { name: 'story_owner_expiration' });

export type Story = InferSchemaType<typeof storySchema>;
export const StoryModel = model<Story>('Story', storySchema);
