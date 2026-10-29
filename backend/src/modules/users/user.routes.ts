import { Router, type NextFunction, type Request, type Response } from 'express';
import argon2 from 'argon2';
import { ZodError } from 'zod';
import { z } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { MediaModel } from '../media/media.model';
import {
  CloudinaryUnavailableError,
  createCloudinaryClient,
  type CloudinaryMediaClient,
} from '../media/cloudinary';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { PostModel } from '../content/post.model';
import { ReelModel } from '../content/reel.model';
import { FollowModel } from './follow.model';
import { userProfileUpdateSchema } from './user.validation';
import { changeFollowRelationship, FollowAccountUnavailableError } from './follow.service';
import {
  AccountDeletionUnavailableError,
  deleteAccount,
} from './account-deletion.service';
import { recordProfileView } from '../professional/professional.service';

const publicProfileFields = 'username displayName bio avatarUrl accountType professionalCategory professionalProfile';
const accountDeletionSchema = z.object({
  password: z.string().min(1).max(128),
}).strict();

export function createUserRouter(
  config: AppConfig,
  cloudinaryClient?: CloudinaryMediaClient,
  deleteAccountHandler: (userId: string) => Promise<void> = deleteAccount,
): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);

  router.get('/users/me', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const user = await UserModel.findById((request as AuthenticatedRequest).authenticatedUserId)
        .select(publicProfileFields)
        .lean();
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      response.json({ user: await profilePayload(user, (request as AuthenticatedRequest).authenticatedUserId!) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/users/me', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { password } = accountDeletionSchema.parse(request.body);
      const ownerId = (request as AuthenticatedRequest).authenticatedUserId!;
      const user = await UserModel.findById(ownerId).select('+passwordHash');
      if (!user || typeof user.passwordHash !== 'string') {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      if (!await argon2.verify(user.passwordHash, password)) {
        response.status(401).json({ error: 'Password confirmation failed.' });
        return;
      }
      await deleteAccountHandler(ownerId);
      response.status(204).end();
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Enter your current password to confirm account deletion.' });
        return;
      }
      if (error instanceof AccountDeletionUnavailableError) {
        response.status(503).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.patch('/users/me', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    let claimedMediaId: string | undefined;
    let profileUpdated = false;
    try {
      const update = userProfileUpdateSchema.parse(request.body);
      const ownerId = (request as AuthenticatedRequest).authenticatedUserId!;
      const currentUser = await UserModel.findById(ownerId)
        .select(`${publicProfileFields} avatarMediaId`)
        .lean();
      if (!currentUser) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }

      const set: Record<string, unknown> = {};
      const unset: Record<string, 1> = {};
      let profilePhotoChanged = false;
      if (update.avatarMediaId) {
        if (String(currentUser.avatarMediaId ?? '') !== update.avatarMediaId) {
          const media = await MediaModel.findOneAndUpdate(
            {
              _id: update.avatarMediaId,
              ownerId,
              purpose: 'profile',
              resourceType: 'image',
              status: 'ready',
              attachedTo: { $exists: false },
            },
            { $set: { attachedTo: 'profile', attachedId: currentUser._id } },
            { new: true },
          );
          if (!media?.secureUrl) {
            response.status(409).json({ error: 'Choose a verified profile image owned by your account.' });
            return;
          }
          claimedMediaId = String(media._id);
          profilePhotoChanged = true;
          set.avatarMediaId = media._id;
          set.avatarUrl = media.secureUrl;
        }
      } else if (update.avatarMediaId === null) {
        profilePhotoChanged = true;
        unset.avatarMediaId = 1;
        unset.avatarUrl = 1;
      }
      if (update.username !== undefined) set.username = update.username;
      if (update.displayName !== undefined) set.displayName = update.displayName;
      if (update.bio !== undefined) set.bio = update.bio;
      const updateOperation = {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      };
      if (!Object.keys(updateOperation).length) {
        response.json({ user: await profilePayload(currentUser, ownerId) });
        return;
      }
      const user = await UserModel.findByIdAndUpdate(
        ownerId,
        updateOperation,
        { new: true, runValidators: true },
      ).select(publicProfileFields).lean();
      if (!user) {
        if (claimedMediaId) {
          await MediaModel.updateOne(
            { _id: claimedMediaId, attachedTo: 'profile', attachedId: currentUser._id },
            { $unset: { attachedTo: 1, attachedId: 1 } },
          );
        }
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      profileUpdated = true;
      const oldAvatarMediaId = currentUser.avatarMediaId;
      let photoCleanupWarning = false;
      if (
        profilePhotoChanged &&
        oldAvatarMediaId &&
        String(oldAvatarMediaId) !== String(claimedMediaId ?? '')
      ) {
        photoCleanupWarning = !await removeReplacedProfileMedia(
          config,
          ownerId,
          currentUser._id,
          oldAvatarMediaId,
          cloudinaryClient,
        );
      }
      response.json({
        user: await profilePayload(user, (request as AuthenticatedRequest).authenticatedUserId!),
        ...(photoCleanupWarning ? {
          photoCleanupWarning: 'Your profile photo was removed, but its stored image could not be deleted. Contact support if it remains visible in storage.',
        } : {}),
      });
    } catch (error) {
      if (claimedMediaId && !profileUpdated) {
        await MediaModel.updateOne(
          {
            _id: claimedMediaId,
            attachedTo: 'profile',
            attachedId: (request as AuthenticatedRequest).authenticatedUserId,
          },
          { $unset: { attachedTo: 1, attachedId: 1 } },
        );
      }
      if (error instanceof ZodError) {
        response.status(400).json({
          error: 'Invalid profile data.',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.') || 'value',
            message: issue.message,
          })),
        });
        return;
      }
      if (isDuplicateKeyError(error)) {
        response.status(409).json({ error: 'Username is already in use.' });
        return;
      }
      next(error);
    }
  });

  router.get('/users/search', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
      if (query.length < 2 || query.length > 80) {
        response.status(400).json({ error: 'Search query must be between 2 and 80 characters.' });
        return;
      }
      const limitValue = request.query.limit === undefined ? 30 : Number(request.query.limit);
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (
        !Number.isInteger(limitValue) ||
        limitValue < 1 ||
        limitValue > 50 ||
        (after !== undefined && !/^[a-z0-9._]{3,30}$/i.test(after))
      ) {
        response.status(400).json({ error: 'Invalid search pagination.' });
        return;
      }
      const users = await UserModel.find({
        accountStatus: 'active',
        _id: { $ne: (request as AuthenticatedRequest).authenticatedUserId },
        $and: [
          {
            $or: [
              { username: { $regex: escapeRegex(query), $options: 'i' } },
              { displayName: { $regex: escapeRegex(query), $options: 'i' } },
            ],
          },
          ...(after ? [{ username: { $gt: after.toLowerCase() } }] : []),
        ],
      })
        .select(publicProfileFields)
        .sort({ username: 1 })
        .limit(limitValue + 1)
        .lean();
      const hasMore = users.length > limitValue;
      const page = hasMore ? users.slice(0, limitValue) : users;
      const viewerId = (request as AuthenticatedRequest).authenticatedUserId!;
      const followedIds = new Set(
        page.length
          ? (await FollowModel.find({
            followerId: viewerId,
            followedId: { $in: page.map((user) => user._id) },
          }).select('followedId').lean()).map((follow) => String(follow.followedId))
          : [],
      );
      response.json({
        users: page.map((user) => ({
          id: String(user._id),
          ...user,
          isFollowing: followedIds.has(String(user._id)),
        })),
        nextCursor: hasMore ? page.at(-1)?.username ?? null : null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/suggestions', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const limitValue = request.query.limit === undefined ? 5 : Number(request.query.limit);
      const after = typeof request.query.after === 'string' ? request.query.after.toLowerCase() : undefined;
      if (
        !Number.isInteger(limitValue) ||
        limitValue < 1 ||
        limitValue > 50 ||
        (after !== undefined && !/^[a-z0-9._]{3,30}$/.test(after))
      ) {
        response.status(400).json({ error: 'Invalid suggestion page size.' });
        return;
      }
      const viewerId = (request as AuthenticatedRequest).authenticatedUserId!;
      const followed = await FollowModel.find({ followerId: viewerId }).select('followedId').lean();
      const excludedIds = [viewerId, ...followed.map((edge) => String(edge.followedId))];
      const users = await UserModel.find({
        accountStatus: 'active',
        _id: { $nin: excludedIds },
        ...(after ? { username: { $gt: after } } : {}),
      })
        .select(publicProfileFields)
        .sort({ username: 1 })
        .limit(limitValue + 1)
        .lean();
      const hasMore = users.length > limitValue;
      const page = hasMore ? users.slice(0, limitValue) : users;
      const candidateIds = page.map((user) => user._id);
      const mutualEdges = followed.length && candidateIds.length
        ? await FollowModel.find({
          followerId: { $in: followed.map((edge) => edge.followedId) },
          followedId: { $in: candidateIds },
        }).select('followerId followedId').lean()
        : [];
      const mutualFollowerIds = [...new Set(mutualEdges.map((edge) => String(edge.followerId)))];
      const mutualFollowers: Array<{ _id: unknown; username: string }> = mutualFollowerIds.length
        ? await UserModel.find({ _id: { $in: mutualFollowerIds }, accountStatus: 'active' })
          .select('username')
          .lean<{ _id: unknown; username: string }[]>()
        : [];
      const usernameById = new Map(mutualFollowers.map((user) => [String(user._id), user.username]));
      const mutualsByUser = new Map<string, string[]>();
      for (const edge of mutualEdges) {
        const usernames = mutualsByUser.get(String(edge.followedId)) ?? [];
        const username = usernameById.get(String(edge.followerId));
        if (username) usernames.push(username);
        mutualsByUser.set(String(edge.followedId), usernames);
      }
      response.json({
        users: page.map((user) => {
          const mutualUsernames = mutualsByUser.get(String(user._id)) ?? [];
          return {
          id: String(user._id),
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isFollowing: false,
            mutualCount: mutualUsernames.length,
            mutualUsernames: mutualUsernames.slice(0, 2),
          };
        }),
        nextCursor: hasMore ? page.at(-1)?.username ?? null : null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/by-username/:username', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const username = request.params.username?.toLowerCase();
      if (!username || !/^[a-z0-9._]{3,30}$/i.test(username)) {
        response.status(400).json({ error: 'Invalid username.' });
        return;
      }
      const user = await UserModel.findOne({ username, accountStatus: 'active' })
        .select(publicProfileFields)
        .lean();
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      recordProfileView(String(user._id), (request as AuthenticatedRequest).authenticatedUserId!);
      response.json({
        user: await profilePayload(user, (request as AuthenticatedRequest).authenticatedUserId!),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:userId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { userId } = request.params;
      if (!userId || (!/^[a-f\d]{24}$/i.test(userId) && !/^[a-z0-9._]{3,30}$/i.test(userId))) {
        response.status(400).json({ error: 'Invalid user ID or username.' });
        return;
      }
      const viewerId = (request as AuthenticatedRequest).authenticatedUserId!;
      const user = await UserModel.findOne({
        ...( /^[a-f\d]{24}$/i.test(userId) ? { _id: userId } : { username: userId.toLowerCase() }),
        accountStatus: 'active',
      })
        .select(publicProfileFields)
        .lean();
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      recordProfileView(String(user._id), viewerId);
      response.json({ user: await profilePayload(user, viewerId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/:userId/follow', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = request.params.userId?.toLowerCase();
      const followerId = (request as AuthenticatedRequest).authenticatedUserId!;
      if (
        !userId ||
        !/^[a-f\d]{24}$/i.test(userId) ||
        userId.toLowerCase() === followerId.toLowerCase()
      ) {
        response.status(400).json({ error: 'Invalid follow request.' });
        return;
      }
      await changeFollowRelationship(followerId, userId, true);
      response.json({ following: true });
    } catch (error) {
      if (error instanceof FollowAccountUnavailableError) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/users/:userId/follow', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = request.params.userId?.toLowerCase();
      if (!userId || !/^[a-f\d]{24}$/i.test(userId)) {
        response.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      await changeFollowRelationship((request as AuthenticatedRequest).authenticatedUserId!, userId, false);
      response.json({ following: false });
    } catch (error) {
      if (error instanceof FollowAccountUnavailableError) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      next(error);
    }
  });

  for (const [relation, edgeField] of [
    ['followers', 'followedId'],
    ['following', 'followerId'],
  ] as const) {
    router.get(`/users/:userId/${relation}`, authenticate, async (request: Request, response: Response, next: NextFunction) => {
      try {
        const userId = request.params.userId?.toLowerCase();
        if (!userId || !/^[a-f\d]{24}$/i.test(userId)) {
          response.status(400).json({ error: 'Invalid user ID.' });
          return;
        }
        const profileExists = await UserModel.exists({ _id: userId, accountStatus: 'active' });
        if (!profileExists) {
          response.status(404).json({ error: 'User not found.' });
          return;
        }
        const limit = Number(request.query.limit ?? 30);
        const after = typeof request.query.after === 'string' ? request.query.after : undefined;
        if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
            (after !== undefined && !/^[a-f\d]{24}$/i.test(after))) {
          response.status(400).json({ error: 'Invalid pagination parameters.' });
          return;
        }
        const edges = await FollowModel.find({
          [edgeField]: userId,
          ...(after ? { _id: { $gt: after } } : {}),
        }).sort({ _id: 1 }).limit(limit + 1).select('followerId followedId _id').lean();
        const hasMore = edges.length > limit;
        const page = hasMore ? edges.slice(0, limit) : edges;
        const memberIds = page.map((edge) => String(relation === 'followers' ? edge.followerId : edge.followedId));
        const users = await UserModel.find({ _id: { $in: memberIds }, accountStatus: 'active' })
          .select(publicProfileFields).lean();
        const byId = new Map(users.map((user) => [String(user._id), user]));
        response.json({
          users: memberIds.flatMap((id) => {
            const user = byId.get(id);
            return user ? [{ id, ...user }] : [];
          }),
          nextCursor: hasMore ? String(page.at(-1)?._id) : null,
        });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}

async function profilePayload(user: { _id: unknown; [key: string]: unknown }, viewerId: string) {
  const userId = String(user._id);
  const [followersCount, followingCount, postsCount, reelsCount, isFollowing] = await Promise.all([
    FollowModel.countDocuments({ followedId: userId }),
    FollowModel.countDocuments({ followerId: userId }),
    PostModel.countDocuments({ ownerId: userId }),
    ReelModel.countDocuments({ ownerId: userId }),
    userId === viewerId
      ? Promise.resolve(false)
      : FollowModel.exists({ followerId: viewerId, followedId: userId }),
  ]);
  const accountType = user.accountType ?? 'PERSONAL';
  return {
    id: userId,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    accountType,
    professionalCategory: user.professionalCategory ?? null,
    professionalLabelVisible: accountType !== 'PERSONAL' &&
      (!user.professionalProfile ||
        typeof user.professionalProfile !== 'object' ||
        (user.professionalProfile as Record<string, unknown>).showProfessionalLabel !== false),
    professionalContact: user.professionalProfile &&
      typeof user.professionalProfile === 'object' &&
      (user.professionalProfile as Record<string, unknown>).displayContactInfo === true
      ? {
        businessEmail: (user.professionalProfile as Record<string, unknown>).businessEmail,
        contactPhone: (user.professionalProfile as Record<string, unknown>).contactPhone,
        website: (user.professionalProfile as Record<string, unknown>).website,
        businessAddress: (user.professionalProfile as Record<string, unknown>).businessAddress,
      }
      : null,
    followersCount,
    followingCount,
    postsCount,
    reelsCount,
    isFollowing: Boolean(isFollowing),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function removeReplacedProfileMedia(
  config: AppConfig,
  ownerId: string,
  attachedId: unknown,
  mediaId: unknown,
  cloudinaryClient?: CloudinaryMediaClient,
): Promise<boolean> {
  let media;
  try {
    media = await MediaModel.findOneAndUpdate(
      {
        _id: mediaId,
        ownerId,
        purpose: 'profile',
        resourceType: 'image',
        status: 'ready',
        attachedTo: 'profile',
        attachedId,
        $or: [
          { publicId: { $regex: `^cliqheart/profiles/${ownerId}/` } },
          { publicId: { $regex: `^cliqheart/profile/${ownerId}/` } },
        ],
      },
      {
        $set: { status: 'deleting' },
        $unset: { attachedTo: 1, attachedId: 1 },
      },
      { new: false },
    );
    if (!media) return false;

    const cloudinary = cloudinaryClient ?? createCloudinaryClient(config);
    const result = await cloudinary.destroy(media.publicId, 'image');
    if (!isCloudinaryDeletionConfirmed(result)) {
      await restoreDetachedProfileMedia(media._id);
      console.warn(JSON.stringify({ event: 'replaced_profile_media_cleanup_unconfirmed' }));
      return false;
    }
    await MediaModel.updateOne(
      { _id: media._id, ownerId, status: 'deleting' },
      { $set: { status: 'deleted' } },
    );
    return true;
  } catch (error) {
    if (media) {
      try {
        await restoreDetachedProfileMedia(media._id);
      } catch {
        console.error(JSON.stringify({ event: 'replaced_profile_media_state_restore_failed' }));
      }
    }
    const providerStatus = cloudinaryHttpStatus(error);
    console.warn(JSON.stringify({
      event: 'replaced_profile_media_cleanup_failed',
      providerStatus: providerStatus ?? null,
      cloudinaryUnavailable: error instanceof CloudinaryUnavailableError,
    }));
    return false;
  }
}

async function restoreDetachedProfileMedia(mediaId: unknown): Promise<void> {
  await MediaModel.updateOne(
    { _id: mediaId, status: 'deleting' },
    { $set: { status: 'ready' } },
  );
}

function isCloudinaryDeletionConfirmed(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    'result' in value && (value.result === 'ok' || value.result === 'not found');
}

function cloudinaryHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('error' in error)) return undefined;
  const providerError = error.error;
  return typeof providerError === 'object' && providerError !== null &&
    'http_code' in providerError && typeof providerError.http_code === 'number'
    ? providerError.http_code
    : undefined;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
