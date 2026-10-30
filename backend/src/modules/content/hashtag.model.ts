import { Schema, model, type InferSchemaType } from 'mongoose';

const hashtagSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    normalizedName: { type: String, required: true, trim: true, lowercase: true, maxlength: 50 },
    usageCount: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true, strict: 'throw' },
);

hashtagSchema.index({ normalizedName: 1 }, { unique: true, name: 'hashtag_normalized_unique' });
hashtagSchema.index({ usageCount: -1, normalizedName: 1 }, { name: 'hashtag_popularity' });

export type Hashtag = InferSchemaType<typeof hashtagSchema>;
export const HashtagModel = model<Hashtag>('Hashtag', hashtagSchema);
