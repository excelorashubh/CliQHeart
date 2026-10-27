import { Schema, model, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9._]+$/,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    phone: {
      type: String,
      trim: true,
      match: /^\+[1-9]\d{7,14}$/,
      set: (value: string | undefined) => value?.replace(/[()\s.-]/g, ''),
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    avatarUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      validate: {
        validator: (value: string | undefined) => {
          if (value === undefined || value.length === 0) {
            return true;
          }
          try {
            const url = new URL(value);
            return url.protocol === 'http:' || url.protocol === 'https:';
          } catch {
            return false;
          }
        },
        message: 'avatarUrl must be an HTTP or HTTPS URL',
      },
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    accountStatus: {
      type: String,
      enum: ['pending', 'active', 'suspended', 'deleted'],
      default: 'pending',
      required: true,
    },
    passwordHash: {
      type: String,
      select: false,
    },
  },
  {
    timestamps: true,
    strict: 'throw',
    toJSON: {
      transform: (_document, result) => {
        const safeResult: Record<string, unknown> = { ...result };
        delete safeResult.passwordHash;
        delete safeResult.__v;
        if (safeResult._id) {
          safeResult.id = String(safeResult._id);
          delete safeResult._id;
        }
        return safeResult;
      },
    },
    toObject: {
      transform: (_document, result) => {
        const safeResult: Record<string, unknown> = { ...result };
        delete safeResult.passwordHash;
        delete safeResult.__v;
        if (safeResult._id) {
          safeResult.id = String(safeResult._id);
          delete safeResult._id;
        }
        return safeResult;
      },
    },
  },
);

userSchema.index({ username: 1 }, { unique: true, name: 'user_username_unique' });
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } },
    name: 'user_email_unique',
  },
);
userSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string' } },
    name: 'user_phone_unique',
  },
);
userSchema.index({ createdAt: -1 }, { name: 'user_created_at' });

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model<User>('User', userSchema);
