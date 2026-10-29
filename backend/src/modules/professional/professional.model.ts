import { Schema, model, type InferSchemaType } from 'mongoose';
import type { professionalAccountTypes } from './professional.fields';

export const professionalEventTypes = [
  'profile_view',
  'post_view',
  'reel_view',
  'follow',
  'unfollow',
] as const;

const professionalEventSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    viewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    eventType: { type: String, enum: professionalEventTypes, required: true },
    deduplicationKey: { type: String, required: true, unique: true },
    eventDay: { type: String, required: true },
  },
  { timestamps: true, strict: 'throw' },
);

professionalEventSchema.index(
  { ownerId: 1, eventDay: 1, eventType: 1 },
  { name: 'professional_event_owner_day_type' },
);
professionalEventSchema.index(
  { ownerId: 1, targetId: 1, eventType: 1, eventDay: -1 },
  { name: 'professional_event_content_metrics' },
);
professionalEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 120 * 24 * 60 * 60, name: 'professional_event_retention_120d' },
);

const professionalCampaignSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    objective: { type: String, enum: ['AWARENESS', 'PROFILE_VISITS', 'ENGAGEMENT'], required: true },
    postId: { type: Schema.Types.ObjectId, ref: 'Post', default: null },
    dailyBudgetMinor: { type: Number, required: true, min: 100, max: 100000000 },
    currency: { type: String, enum: ['USD'], default: 'USD', required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: { type: String, enum: ['DRAFT'], default: 'DRAFT', required: true },
  },
  { timestamps: true, strict: 'throw' },
);

professionalCampaignSchema.index(
  { ownerId: 1, updatedAt: -1 },
  { name: 'professional_campaign_owner_updated' },
);

export type ProfessionalEvent = InferSchemaType<typeof professionalEventSchema>;
export type ProfessionalCampaign = InferSchemaType<typeof professionalCampaignSchema>;
export const ProfessionalEventModel = model<ProfessionalEvent>(
  'ProfessionalEvent',
  professionalEventSchema,
);
export const ProfessionalCampaignModel = model<ProfessionalCampaign>(
  'ProfessionalCampaign',
  professionalCampaignSchema,
);

export function isProfessionalType(
  accountType: unknown,
): accountType is typeof professionalAccountTypes[number] {
  return accountType === 'CREATOR' || accountType === 'BUSINESS';
}
