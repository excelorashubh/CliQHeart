import { z } from 'zod';

const usernamePattern = /^(?!\.)(?!.*\.\.)[a-z0-9._]{3,30}(?<!\.)$/i;
const reservedUsernames = new Set(['admin', 'root', 'support', 'staff', 'system', 'cliqheart']);
export const isValidUsername = (username: string): boolean =>
  usernamePattern.test(username) && !reservedUsernames.has(username.trim().toLowerCase());

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(30)
      .regex(usernamePattern, 'Username must be 3-30 characters using letters, numbers, periods, or underscores, without leading/trailing or repeated periods.'),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z
      .string()
      .min(8)
      .max(128)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).*$/, 'Password must contain at least one letter and one number.'),
    confirmPassword: z.string().min(8),
    agreeToTerms: z.boolean().refine((value) => value === true, 'You must agree to the terms and privacy policy.'),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match.',
      });
    }

    if (reservedUsernames.has(value.username)) {
      ctx.addIssue({
        code: 'custom',
        path: ['username'],
        message: 'This username is reserved.',
      });
    }
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Identifier is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(256),
}).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
