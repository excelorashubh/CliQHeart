import { z } from 'zod';
import {
  professionalAccountTypes,
  professionalCategories,
} from './professional.fields';

const httpUrlSchema = z.string().trim().max(2048).refine((value) => {
  if (!value) return true;
  try {
    new URL(value);
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
});

export const professionalProfileInputSchema = z.object({
  businessEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]).optional(),
  contactPhone: z.union([z.literal(''), z.string().trim().regex(/^\+[1-9]\d{7,14}$/)]).optional(),
  website: httpUrlSchema.optional(),
  businessAddress: z.string().trim().max(300).optional(),
  displayContactInfo: z.boolean().optional(),
  showProfessionalLabel: z.boolean().optional(),
}).strict();

export const onboardingStepSchema = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('type'),
    accountType: z.enum(professionalAccountTypes),
  }).strict(),
  z.object({
    step: z.literal('category'),
    category: z.enum(professionalCategories),
  }).strict(),
  z.object({
    step: z.literal('profile'),
    profile: professionalProfileInputSchema,
  }).strict(),
  z.object({
    step: z.literal('confirmation'),
    confirmPublicProfile: z.boolean(),
  }).strict(),
]);

export const conversionSchema = z.object({
  confirmPublicProfile: z.literal(true),
}).strict();

const campaignFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  objective: z.enum(['AWARENESS', 'PROFILE_VISITS', 'ENGAGEMENT']),
  postId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  dailyBudgetMinor: z.number().int().min(100).max(100000000),
  currency: z.literal('USD').default('USD'),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).strict();

export const campaignInputSchema = campaignFieldsSchema.refine((value) => value.endsAt > value.startsAt, {
  path: ['endsAt'],
  message: 'Campaign end must be after its start.',
});

export const campaignUpdateSchema = campaignFieldsSchema.partial()
  .extend({ postId: z.union([z.string().regex(/^[a-f\d]{24}$/i), z.null()]).optional() })
  .refine((value) => value.startsAt === undefined || value.endsAt === undefined || value.endsAt > value.startsAt, {
    path: ['endsAt'],
    message: 'Campaign end must be after its start.',
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one campaign field is required.');

export const analyticsRangeSchema = z.enum(['7', '30', '90']).default('30');
