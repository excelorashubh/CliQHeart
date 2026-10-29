import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { PostModel } from '../content/post.model';
import { ReelModel } from '../content/reel.model';
import { FollowModel } from '../users/follow.model';
import { ProfessionalCampaignModel, ProfessionalEventModel, isProfessionalType } from './professional.model';
import {
  analyticsRangeSchema,
  campaignInputSchema,
  campaignUpdateSchema,
  conversionSchema,
  onboardingStepSchema,
  professionalProfileInputSchema,
} from './professional.validation';

const privateUserFields = [
  'accountType',
  'professionalCategory',
  'professionalProfile',
  'professionalOnboardingDraft',
  'professionalOnboardingCompletedAt',
].join(' ');

type OnboardingDraft = {
  accountType?: 'CREATOR' | 'BUSINESS';
  category?: string;
  profile?: Record<string, unknown>;
  confirmPublicProfile?: boolean;
};

export function createProfessionalRouter(config: AppConfig): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);

  router.get('/professional/me', authenticate, async (request, response, next) => {
    try {
      const user = await UserModel.findById(authenticatedUserId(request))
        .select(privateUserFields)
        .lean();
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      response.json({ professional: serializeProfessional(user) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/professional/onboarding', authenticate, async (request, response, next) => {
    try {
      const update = onboardingStepSchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      const user = await UserModel.findById(ownerId).select(privateUserFields);
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      const currentAccountType = user.accountType ?? 'PERSONAL';
      if (currentAccountType !== 'PERSONAL') {
        response.status(409).json({
          error: isProfessionalType(currentAccountType)
            ? 'This account is already professional.'
            : 'This account cannot enter professional onboarding.',
        });
        return;
      }
      const currentDocument = user.get('professionalOnboardingDraft') as
        { toObject: () => OnboardingDraft } | undefined;
      const current = currentDocument?.toObject();
      const draft = { ...current };
      if (update.step === 'type') draft.accountType = update.accountType;
      if (update.step === 'category') draft.category = update.category;
      if (update.step === 'profile') draft.profile = update.profile;
      if (update.step === 'confirmation') draft.confirmPublicProfile = update.confirmPublicProfile;
      user.set('professionalOnboardingDraft', draft);
      await user.save();
      response.json({ professional: serializeProfessional(userState(user)) });
    } catch (error) {
      handleInputError(error, response, next);
    }
  });

  router.post('/professional/convert', authenticate, async (request, response, next) => {
    try {
      conversionSchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      const user = await UserModel.findById(ownerId).select(privateUserFields);
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      const currentAccountType = user.accountType ?? 'PERSONAL';
      if (currentAccountType === 'PERSONAL') {
        const draft = user.get('professionalOnboardingDraft') as OnboardingDraft | undefined;
        if (!draft?.accountType || !draft.category || draft.confirmPublicProfile !== true) {
          response.status(409).json({ error: 'Complete and confirm professional onboarding first.' });
          return;
        }
        user.accountType = draft.accountType;
        user.professionalCategory = draft.category;
        user.set('professionalProfile', draft.profile);
        user.professionalOnboardingCompletedAt = new Date();
        user.professionalOnboardingDraft = undefined;
        await user.save();
      } else if (!isProfessionalType(currentAccountType)) {
        response.status(409).json({ error: 'This account cannot be converted.' });
        return;
      }
      response.json({ professional: serializeProfessional(userState(user)) });
    } catch (error) {
      handleInputError(error, response, next);
    }
  });

  router.patch('/professional/profile', authenticate, async (request, response, next) => {
    try {
      const profile = professionalProfileInputSchema.parse(request.body);
      const user = await requireProfessional(authenticatedUserId(request));
      if (!user) {
        response.status(403).json({ error: 'Convert to a professional account to edit these settings.' });
        return;
      }
      const currentDocument = user.get('professionalProfile') as
        { toObject: () => Record<string, unknown> } | undefined;
      const current = currentDocument?.toObject();
      user.set('professionalProfile', { ...current, ...profile });
      await user.save();
      response.json({ professional: serializeProfessional(userState(user)) });
    } catch (error) {
      handleInputError(error, response, next);
    }
  });

  router.post('/professional/switch-to-personal', authenticate, async (request, response, next) => {
    try {
      const user = await requireProfessional(authenticatedUserId(request));
      if (!user) {
        response.status(409).json({ error: 'This account is already personal or unavailable.' });
        return;
      }
      user.accountType = 'PERSONAL';
      user.professionalCategory = undefined;
      user.set('professionalProfile', undefined);
      user.set('professionalOnboardingDraft', undefined);
      user.professionalOnboardingCompletedAt = undefined;
      await user.save();
      response.json({ professional: serializeProfessional(userState(user)) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/professional/dashboard', authenticate, async (request, response, next) => {
    try {
      const ownerId = authenticatedUserId(request);
      const professional = await requireProfessional(ownerId);
      if (!professional) {
        response.status(403).json({ error: 'Convert to a professional account to view analytics.' });
        return;
      }
      const range = analyticsRangeSchema.parse(request.query.days);
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - Number(range) + 1);
      const startDay = start.toISOString().slice(0, 10);
      const [followersCount, followingCount, postsCount, reelsCount, daily, topContent, recentEvents] = await Promise.all([
        FollowModel.countDocuments({ followedId: ownerId }),
        FollowModel.countDocuments({ followerId: ownerId }),
        PostModel.countDocuments({ ownerId }),
        ReelModel.countDocuments({ ownerId }),
        ProfessionalEventModel.aggregate([
          { $match: { ownerId: new Types.ObjectId(ownerId), eventDay: { $gte: startDay }, eventType: { $in: ['profile_view', 'post_view', 'reel_view', 'follow', 'unfollow'] } } },
          { $group: { _id: { day: '$eventDay', type: '$eventType' }, count: { $sum: 1 } } },
          { $sort: { '_id.day': 1 } },
        ]),
        ProfessionalEventModel.aggregate([
          { $match: { ownerId: new Types.ObjectId(ownerId), eventDay: { $gte: startDay }, targetId: { $ne: null }, eventType: { $in: ['post_view', 'reel_view'] } } },
          { $group: { _id: { targetId: '$targetId', type: '$eventType' }, views: { $sum: 1 } } },
          { $sort: { views: -1 } },
          { $limit: 5 },
        ]),
        ProfessionalEventModel.find({ ownerId, eventDay: { $gte: startDay } })
          .sort({ createdAt: -1 })
          .limit(10)
          .select('eventType eventDay targetId')
          .lean(),
      ]);
      const contentIds = topContent.map((item) => String(item._id.targetId));
      const [posts, reels] = await Promise.all([
        PostModel.find({ _id: { $in: contentIds } }).select('_id caption').lean(),
        ReelModel.find({ _id: { $in: contentIds } }).select('_id caption').lean(),
      ]);
      const contentById = new Map<string, { caption: string; type: 'post' | 'reel' }>();
      posts.forEach((item) => contentById.set(String(item._id), { caption: item.caption, type: 'post' }));
      reels.forEach((item) => contentById.set(String(item._id), { caption: item.caption, type: 'reel' }));
      response.json({
        analytics: {
          rangeDays: Number(range),
          totals: { followers: followersCount, following: followingCount, posts: postsCount, reels: reelsCount },
          dailyUniqueEvents: daily.map((item) => ({ day: item._id.day, event: item._id.type, count: item.count })),
          topContent: topContent.flatMap((item) => {
            const content = contentById.get(String(item._id.targetId));
            return content ? [{
              id: String(item._id.targetId),
              type: content.type,
              caption: content.caption,
              uniqueViewerDays: item.views,
            }] : [];
          }),
          recentActivity: recentEvents.map((event) => ({
            event: event.eventType,
            day: event.eventDay,
            contentType: event.eventType === 'post_view' ? 'post' : event.eventType === 'reel_view' ? 'reel' : undefined,
          })),
          metricDefinition: 'Views and activity count unique signed-in viewers per UTC day; impressions, reach, and historical pre-launch analytics are not available.',
        },
      });
    } catch (error) {
      handleInputError(error, response, next);
    }
  });

  router.get('/professional/campaigns', authenticate, async (request, response, next) => {
    try {
      if (!await requireProfessional(authenticatedUserId(request))) {
        response.status(403).json({ error: 'Convert to a professional account to create a promotion draft.' });
        return;
      }
      const campaigns = await ProfessionalCampaignModel.find({ ownerId: authenticatedUserId(request) })
        .sort({ updatedAt: -1 })
        .lean();
      response.json({ campaigns: campaigns.map(serializeCampaign), billing: { configured: false } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/professional/campaigns', authenticate, async (request, response, next) => {
    try {
      const input = campaignInputSchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      if (!await requireProfessional(ownerId)) {
        response.status(403).json({ error: 'Convert to a professional account to create a promotion draft.' });
        return;
      }
      if (input.startsAt <= new Date() || input.endsAt.getTime() - input.startsAt.getTime() > 366 * 24 * 60 * 60 * 1000) {
        response.status(400).json({ error: 'Choose a future start and an end within one year.' });
        return;
      }
      if (input.postId && !await PostModel.exists({ _id: input.postId, ownerId })) {
        response.status(400).json({ error: 'Choose a post owned by this account.' });
        return;
      }
      const campaign = await ProfessionalCampaignModel.create({ ...input, ownerId });
      response.status(201).json({
        campaign: serializeCampaign(campaign.toObject()),
        billing: { configured: false },
      });
    } catch (error) {
      handleInputError(error, response, next);
    }
  });

  router.patch('/professional/campaigns/:campaignId', authenticate, async (request, response, next) => {
    try {
      const campaignId = request.params.campaignId;
      if (!campaignId || !Types.ObjectId.isValid(campaignId)) {
        response.status(400).json({ error: 'Invalid promotion draft ID.' });
        return;
      }
      const update = campaignUpdateSchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      const campaign = await ProfessionalCampaignModel.findOne({ _id: campaignId, ownerId, status: 'DRAFT' });
      if (!campaign) {
        response.status(404).json({ error: 'Promotion draft not found.' });
        return;
      }
      if (update.postId && !await PostModel.exists({ _id: update.postId, ownerId })) {
        response.status(400).json({ error: 'Choose a post owned by this account.' });
        return;
      }
      const startsAt = update.startsAt ?? campaign.startsAt;
      const endsAt = update.endsAt ?? campaign.endsAt;
      if (startsAt <= new Date() || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 366 * 24 * 60 * 60 * 1000) {
        response.status(400).json({ error: 'Choose a future start and an end within one year.' });
        return;
      }
      campaign.set(update);
      await campaign.save();
      response.json({ campaign: serializeCampaign(campaign.toObject()), billing: { configured: false } });
    } catch (error) {
      handleInputError(error, response, next);
    }
  });

  router.delete('/professional/campaigns/:campaignId', authenticate, async (request, response, next) => {
    try {
      const campaignId = request.params.campaignId;
      if (!campaignId || !Types.ObjectId.isValid(campaignId)) {
        response.status(400).json({ error: 'Invalid promotion draft ID.' });
        return;
      }
      const result = await ProfessionalCampaignModel.deleteOne({
        _id: campaignId,
        ownerId: authenticatedUserId(request),
        status: 'DRAFT',
      });
      if (result.deletedCount !== 1) {
        response.status(404).json({ error: 'Promotion draft not found.' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function requireProfessional(ownerId: string) {
  const user = await UserModel.findById(ownerId)
    .select(privateUserFields)
    .where({ accountType: { $in: ['CREATOR', 'BUSINESS'] }, accountStatus: 'active' });
  return user;
}

function authenticatedUserId(request: Request): string {
  return (request as AuthenticatedRequest).authenticatedUserId!;
}

function serializeProfessional(user: Record<string, unknown>) {
  const accountType = user.accountType ?? 'PERSONAL';
  return {
    accountType,
    category: user.professionalCategory ?? null,
    profile: user.professionalProfile ?? null,
    onboardingDraft: user.professionalOnboardingDraft ?? null,
    onboardingCompletedAt: user.professionalOnboardingCompletedAt ?? null,
  };
}

function userState(user: {
  accountType?: unknown;
  professionalCategory?: unknown;
  professionalProfile?: unknown;
  professionalOnboardingDraft?: unknown;
  professionalOnboardingCompletedAt?: unknown;
}): Record<string, unknown> {
  return {
    accountType: user.accountType ?? 'PERSONAL',
    professionalCategory: user.professionalCategory,
    professionalProfile: user.professionalProfile,
    professionalOnboardingDraft: user.professionalOnboardingDraft,
    professionalOnboardingCompletedAt: user.professionalOnboardingCompletedAt,
  };
}

function serializeCampaign(campaign: Record<string, unknown>) {
  return {
    id: String(campaign._id),
    name: campaign.name,
    objective: campaign.objective,
    postId: campaign.postId ? String(campaign.postId) : null,
    dailyBudgetMinor: campaign.dailyBudgetMinor,
    currency: campaign.currency,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    status: 'DRAFT',
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

function handleInputError(error: unknown, response: Response, next: NextFunction): void {
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Check the professional account details and try again.', details: error.issues });
    return;
  }
  next(error);
}
