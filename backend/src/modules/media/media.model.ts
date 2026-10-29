import { Schema, model, type InferSchemaType } from 'mongoose';

const mediaSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['profile', 'post', 'story', 'reel'],
      required: true,
    },
    resourceType: {
      type: String,
      enum: ['image', 'video'],
      required: true,
    },
    publicId: { type: String, required: true, unique: true },
    assetId: { type: String, sparse: true, unique: true },
    folder: { type: String, required: true, index: true },
    secureUrl: { type: String },
    format: { type: String },
    bytes: { type: Number },
    width: { type: Number },
    height: { type: Number },
    duration: { type: Number },
    thumbnailUrl: { type: String },
    attachedTo: {
      type: String,
      enum: ['profile', 'post', 'story', 'reel'],
    },
    attachedId: { type: Schema.Types.ObjectId },
    status: {
      type: String,
      enum: ['uploading', 'ready', 'failed', 'deleting', 'deleted'],
      default: 'uploading',
      required: true,
      index: true,
    },
    signatureExpiresAt: { type: Date, required: true },
  },
  { timestamps: true, strict: 'throw' },
);

mediaSchema.index({ ownerId: 1, createdAt: -1 }, { name: 'media_owner_created' });
mediaSchema.index({ ownerId: 1, status: 1, createdAt: -1 }, { name: 'media_owner_status' });
mediaSchema.index({ resourceType: 1, status: 1 }, { name: 'media_resource_status' });
mediaSchema.index({ ownerId: 1, attachedTo: 1, attachedId: 1 }, { name: 'media_attachment' });

export type Media = InferSchemaType<typeof mediaSchema>;
export const MediaModel = model<Media>('Media', mediaSchema);
