import assert from 'node:assert/strict';
import test from 'node:test';
import {
  campaignInputSchema,
  campaignUpdateSchema,
  conversionSchema,
  onboardingStepSchema,
  professionalProfileInputSchema,
} from './professional.validation';

test('onboarding accepts only supported account types and steps', () => {
  assert.equal(onboardingStepSchema.safeParse({ step: 'type', accountType: 'CREATOR' }).success, true);
  assert.equal(onboardingStepSchema.safeParse({ step: 'type', accountType: 'ADMIN' }).success, false);
  assert.equal(onboardingStepSchema.safeParse({ step: 'type', accountType: 'BUSINESS', isAdmin: true }).success, false);
});

test('professional contact details validate safe URLs and normalized email values', () => {
  assert.deepEqual(
    professionalProfileInputSchema.parse({
      businessEmail: ' SALES@example.com ',
      website: 'https://example.com',
      displayContactInfo: true,
    }),
    {
      businessEmail: 'sales@example.com',
      website: 'https://example.com',
      displayContactInfo: true,
    },
  );
  assert.equal(professionalProfileInputSchema.safeParse({ website: 'javascript:alert(1)' }).success, false);
  assert.equal(professionalProfileInputSchema.safeParse({ unknown: 'value' }).success, false);
});

test('conversion requires explicit confirmation', () => {
  assert.equal(conversionSchema.safeParse({ confirmPublicProfile: true }).success, true);
  assert.equal(conversionSchema.safeParse({ confirmPublicProfile: false }).success, false);
  assert.equal(conversionSchema.safeParse({ confirmPublicProfile: true, accountType: 'ADMIN' }).success, false);
});

test('campaign input and partial draft updates enforce dates without implying activation', () => {
  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  const campaign = {
    name: 'Spring launch',
    objective: 'AWARENESS',
    dailyBudgetMinor: 500,
    startsAt,
    endsAt,
  };
  assert.equal(campaignInputSchema.safeParse(campaign).success, true);
  assert.equal(campaignUpdateSchema.safeParse({ name: 'Updated draft' }).success, true);
  assert.equal(campaignUpdateSchema.safeParse({ startsAt, endsAt: startsAt }).success, false);
  assert.equal(campaignInputSchema.safeParse({ ...campaign, status: 'ACTIVE' }).success, false);
});
