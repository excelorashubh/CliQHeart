import { z } from 'zod';

const phoneNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[()\s.-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be in international E.164 format'));

export const userProfileInputSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9._]+$/),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: phoneNumberSchema.optional(),
    displayName: z.string().trim().min(1).max(80),
    bio: z.string().trim().max(500).optional(),
    avatarUrl: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === 'https:' || protocol === 'http:';
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .strict();

export const userProfileUpdateSchema = z
  .object({
    username: userProfileInputSchema.shape.username.optional(),
    displayName: userProfileInputSchema.shape.displayName.optional(),
    bio: z.string().trim().max(500).optional(),
    avatarUrl: userProfileInputSchema.shape.avatarUrl,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one profile field is required.');

export type UserProfileInput = z.infer<typeof userProfileInputSchema>;
export type UserProfileUpdate = z.infer<typeof userProfileUpdateSchema>;
