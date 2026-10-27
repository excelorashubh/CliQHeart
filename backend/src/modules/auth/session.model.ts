import { Schema, model, type InferSchemaType } from 'mongoose';

const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },
    tokenFamily: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    strict: 'throw',
  },
);

sessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model<Session>('Session', sessionSchema);
