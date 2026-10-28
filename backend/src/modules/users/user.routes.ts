import { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { FollowModel } from './follow.model';
import { userProfileUpdateSchema } from './user.validation';

const publicProfileFields = 'username displayName bio avatarUrl';

export function createUserRouter(config: AppConfig): Router {
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

  router.patch('/users/me', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const update = userProfileUpdateSchema.parse(request.body);
      const user = await UserModel.findByIdAndUpdate(
        (request as AuthenticatedRequest).authenticatedUserId,
        { $set: update },
        { new: true, runValidators: true },
      ).select(publicProfileFields).lean();
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      response.json({
        user: await profilePayload(user, (request as AuthenticatedRequest).authenticatedUserId!),
      });
    } catch (error) {
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
      response.json({
        users: page.map((user) => ({ id: String(user._id), ...user })),
        nextCursor: hasMore ? page.at(-1)?.username ?? null : null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:userId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { userId } = request.params;
      if (!userId || !/^[a-f\d]{24}$/i.test(userId)) {
        response.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const viewerId = (request as AuthenticatedRequest).authenticatedUserId!;
      const user = await UserModel.findOne({ _id: userId, accountStatus: 'active' })
        .select(publicProfileFields)
        .lean();
      if (!user) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
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
      const target = await UserModel.findOne({ _id: userId, accountStatus: 'active' }).select('_id');
      if (!target) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      await FollowModel.updateOne(
        { followerId, followedId: userId },
        { $setOnInsert: { followerId, followedId: userId } },
        { upsert: true },
      );
      response.json({ following: true });
    } catch (error) {
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
      await FollowModel.deleteOne({
        followerId: (request as AuthenticatedRequest).authenticatedUserId,
        followedId: userId,
      });
      response.json({ following: false });
    } catch (error) {
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
  const [followersCount, followingCount, isFollowing] = await Promise.all([
    FollowModel.countDocuments({ followedId: userId }),
    FollowModel.countDocuments({ followerId: userId }),
    userId === viewerId
      ? Promise.resolve(false)
      : FollowModel.exists({ followerId: viewerId, followedId: userId }),
  ]);
  return {
    id: userId,
    ...user,
    followersCount,
    followingCount,
    isFollowing: Boolean(isFollowing),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
