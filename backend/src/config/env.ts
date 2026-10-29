import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const optionalSecretSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(32, 'must be at least 32 characters').optional(),
);

const productionFrontendOrigin = 'https://cliqhearts.onrender.com';
const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const originListSchema = z
  .string()
  .default(`${productionFrontendOrigin},http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173`)
  .transform((value) => [
    ...new Set([
      ...value.split(',').map((origin) => origin.trim()).filter(Boolean),
      ...developmentOrigins,
    ]),
  ])
  .refine(
    (origins) =>
      origins.every((origin) => {
        try {
          const parsed = new URL(origin);
          return (
            (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            parsed.origin === origin
          );
        } catch {
          return false;
        }
      }),
    'ALLOWED_ORIGINS must contain comma-separated HTTP or HTTPS origins without paths',
  );

const optionalOriginSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .refine((origin) => {
      try {
        const parsed = new URL(origin);
        return (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          parsed.origin === origin
        );
      } catch {
        return false;
      }
    }, 'FRONTEND_URL must be an HTTP or HTTPS origin without a path')
    .optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_NAME: z.string().trim().min(1).default('CliQHeart'),
    APP_VERSION: z.string().trim().min(1).default('0.1.0'),
    MONGODB_URI: z
      .string({
        error: (issue) =>
          issue.input === undefined ? 'MONGODB_URI is required' : 'MONGODB_URI must be a string',
      })
      .min(1, 'MONGODB_URI is required')
      .refine(
        (value) => /^mongodb(?:\+srv)?:\/\/\S+$/i.test(value),
        'MONGODB_URI must be a MongoDB connection URI',
      ),
    MONGODB_DB_NAME: z.string().trim().min(1).default('cliqheart'),
    ANDROID_DEV_ORIGIN: optionalOriginSchema,
    FRONTEND_URL: optionalOriginSchema.default(productionFrontendOrigin),
    ALLOWED_ORIGINS: originListSchema,
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    JWT_ACCESS_SECRET: optionalSecretSchema,
    JWT_REFRESH_SECRET: optionalSecretSchema,
    JWT_ISSUER: z.string().trim().min(1).default('cliqheart'),
    JWT_AUDIENCE: z.string().trim().min(1).default('cliqheart-mobile'),
    ACCESS_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/).default('15m'),
    REFRESH_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/).default('365d'),
    CLOUDINARY_CLOUD_NAME: z.string().trim().min(1).default('dlfvdqs3'),
    CLOUDINARY_API_KEY: z.string().trim().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.JWT_ACCESS_SECRET !== undefined &&
      config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT access and refresh secrets must be different',
      });
    }
    const cloudinarySettings = [
      config.CLOUDINARY_API_KEY,
      config.CLOUDINARY_API_SECRET,
    ];
    if (cloudinarySettings.some(Boolean) && cloudinarySettings.some((value) => !value)) {
      context.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_API_KEY'],
        message: 'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be configured together',
      });
    }
  })
  .transform(({ ALLOWED_ORIGINS, FRONTEND_URL, ...config }) => ({
    ...config,
    FRONTEND_URL,
    CORS_ORIGINS: [...new Set([...ALLOWED_ORIGINS, FRONTEND_URL])],
  }));

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse({
    NODE_ENV: environment.NODE_ENV,
    HOST: environment.HOST,
    PORT: environment.PORT,
    APP_NAME: environment.APP_NAME,
    APP_VERSION: environment.APP_VERSION,
    MONGODB_URI: environment.MONGODB_URI,
    MONGODB_DB_NAME: environment.MONGODB_DB_NAME,
    ANDROID_DEV_ORIGIN: environment.ANDROID_DEV_ORIGIN,
    FRONTEND_URL: environment.FRONTEND_URL,
    ALLOWED_ORIGINS: environment.ALLOWED_ORIGINS ?? environment.CORS_ORIGINS,
    LOG_LEVEL: environment.LOG_LEVEL,
    JWT_ACCESS_SECRET: environment.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: environment.JWT_REFRESH_SECRET,
    JWT_ISSUER: environment.JWT_ISSUER,
    JWT_AUDIENCE: environment.JWT_AUDIENCE,
    ACCESS_TOKEN_TTL: environment.ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL: environment.REFRESH_TOKEN_TTL,
    CLOUDINARY_CLOUD_NAME: environment.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: environment.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: environment.CLOUDINARY_API_SECRET,
  });

  if (!result.success) {
    const details = result.error.issues
      .map(({ path, message }) => `${path.join('.') || 'environment'}: ${message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
