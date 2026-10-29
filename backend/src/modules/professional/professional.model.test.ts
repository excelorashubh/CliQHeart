import assert from 'node:assert/strict';
import test from 'node:test';
import { UserModel } from '../../models/user';
import { ProfessionalCampaignModel } from './professional.model';

test('existing personal accounts retain the personal default and private professional data stays out of JSON', () => {
  const legacyUser = new UserModel({ username: 'legacy_user', displayName: 'Legacy User' });
  assert.equal(legacyUser.accountType, 'PERSONAL');

  const professional = new UserModel({
    username: 'creator_user',
    displayName: 'Creator User',
    accountType: 'CREATOR',
    professionalCategory: 'ARTIST',
    professionalProfile: {
      businessEmail: 'private@example.com',
      displayContactInfo: false,
    },
    professionalOnboardingDraft: {
      accountType: 'BUSINESS',
      category: 'RETAIL',
      confirmPublicProfile: true,
    },
  });
  const publicUser = professional.toJSON();

  assert.equal(publicUser.accountType, 'CREATOR');
  assert.equal(publicUser.professionalCategory, 'ARTIST');
  assert.equal('professionalProfile' in publicUser, false);
  assert.equal('professionalOnboardingDraft' in publicUser, false);
  assert.equal('passwordHash' in publicUser, false);
});

test('professional campaign schema rejects non-draft statuses', async () => {
  const campaign = new ProfessionalCampaignModel({
    ownerId: '0123456789abcdef01234567',
    name: 'Test',
    objective: 'AWARENESS',
    dailyBudgetMinor: 500,
    startsAt: new Date(Date.now() + 60_000),
    endsAt: new Date(Date.now() + 120_000),
    status: 'ACTIVE',
  });

  await assert.rejects(() => campaign.validate());
});
