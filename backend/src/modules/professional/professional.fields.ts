import { Schema } from 'mongoose';

export const professionalAccountTypes = ['CREATOR', 'BUSINESS'] as const;
export const professionalCategories = [
  'DIGITAL_CREATOR',
  'GAMING_CREATOR',
  'ARTIST',
  'MUSICIAN',
  'BLOGGER',
  'PUBLIC_FIGURE',
  'EDUCATION',
  'CLOTHING_BRAND',
  'RETAIL',
  'RESTAURANT',
  'TECHNOLOGY',
  'BEAUTY_WELLNESS',
  'PROFESSIONAL_SERVICES',
  'OTHER',
] as const;

export const professionalProfileSchema = new Schema(
  {
    businessEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    contactPhone: { type: String, trim: true, maxlength: 20 },
    website: { type: String, trim: true, maxlength: 2048 },
    businessAddress: { type: String, trim: true, maxlength: 300 },
    displayContactInfo: { type: Boolean, default: false },
    showProfessionalLabel: { type: Boolean, default: true },
  },
  { _id: false, strict: 'throw' },
);

export const professionalOnboardingDraftSchema = new Schema(
  {
    accountType: { type: String, enum: professionalAccountTypes },
    category: { type: String, enum: professionalCategories },
    profile: { type: professionalProfileSchema },
    confirmPublicProfile: { type: Boolean },
  },
  { _id: false, strict: 'throw' },
);
