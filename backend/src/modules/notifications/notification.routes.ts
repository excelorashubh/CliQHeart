import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { MediaModel } from '../media/media.model';
import { PostModel } from '../content/post.model';
import { ReelModel } from '../content/reel.model';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { NotificationModel } from './notification.model';
import { emitNotificationUnreadCount } from '../messages/realtime';

export function createNotificationRouter(config: AppConfig): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);

  router.get('/notifications/unread-count', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const unreadCount = await NotificationModel.countDocuments({
        recipientId: authenticatedUserId(request),
        readAt: { $exists: false },
      });
      response.json({ unreadCount });
    } catch (error) {
      next(error);
    }
  });

  router.get('/notifications', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const limit = Number(request.query.limit ?? 30);
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
          (after !== undefined && !Types.ObjectId.isValid(after))) {
        response.status(400).json({ error: 'Invalid notification pagination.' });
        return;
      }
      const recipientId = authenticatedUserId(request);
      const [items, unreadCount] = await Promise.all([
        NotificationModel.find({
          recipientId,
          ...(after ? { _id: { $lt: after } } : {}),
        }).sort({ _id: -1 }).limit(limit + 1).lean(),
        NotificationModel.countDocuments({ recipientId, readAt: { $exists: false } }),
      ]);
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const actorIds = [...new Set(page.map((item) => String(item.actorId)))];
      const postIds = [...new Set(page.flatMap((item) => item.postId ? [String(item.postId)] : []))];
      const reelIds = [...new Set(page.flatMap((item) => item.reelId ? [String(item.reelId)] : []))];
      const [actors, posts, reels] = await Promise.all([
        UserModel.find({ _id: { $in: actorIds }, accountStatus: 'active' })
          .select('username displayName avatarUrl').lean(),
        PostModel.find({ _id: { $in: postIds } }).select('_id mediaId').lean(),
        ReelModel.find({ _id: { $in: reelIds } }).select('_id mediaId').lean(),
      ]);
      const mediaIds = [...new Set([...posts, ...reels].map((content) => String(content.mediaId)))];
      const media = await MediaModel.find({ _id: { $in: mediaIds }, status: 'ready' })
        .select('_id thumbnailUrl secureUrl').lean();
      const actorById = new Map(actors.map((actor) => [String(actor._id), actor]));
      const postById = new Map(posts.map((post) => [String(post._id), post]));
      const reelById = new Map(reels.map((reel) => [String(reel._id), reel]));
      const mediaById = new Map(media.map((asset) => [String(asset._id), asset]));
      response.json({
        notifications: page.map((item) => {
          const post = item.postId ? postById.get(String(item.postId)) : undefined;
          const reel = item.reelId ? reelById.get(String(item.reelId)) : undefined;
          const asset = post || reel ? mediaById.get(String((post || reel)?.mediaId)) : undefined;
          return {
            id: String(item._id),
            type: item.type,
            read: Boolean(item.readAt),
            createdAt: item.createdAt,
            actor: actorById.get(String(item.actorId)) ?? null,
            ...(item.postId ? { postId: String(item.postId) } : {}),
            ...(item.reelId ? { reelId: String(item.reelId) } : {}),
            ...(item.commentId ? { commentId: String(item.commentId) } : {}),
            ...(item.conversationId ? { conversationId: String(item.conversationId) } : {}),
            ...(item.storyId ? { storyId: String(item.storyId) } : {}),
            ...(asset ? { thumbnailUrl: asset.thumbnailUrl || asset.secureUrl } : {}),
          };
        }),
        nextCursor: hasMore ? String(page.at(-1)?._id) : null,
        unreadCount,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/notifications/read-all', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const recipientId = authenticatedUserId(request);
      await NotificationModel.updateMany(
        { recipientId, readAt: { $exists: false } },
        { $set: { readAt: new Date() } },
      );
      await publishUnreadCount(recipientId);
      response.json({ read: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/notifications/:notificationId/read', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { notificationId } = request.params;
      if (!notificationId || !Types.ObjectId.isValid(notificationId)) {
        response.status(400).json({ error: 'Invalid notification ID.' });
        return;
      }
      const recipientId = authenticatedUserId(request);
      const notification = await NotificationModel.findOneAndUpdate(
        { _id: notificationId, recipientId },
        { $set: { readAt: new Date() } },
        { new: true },
      ).select('_id');
      if (!notification) {
        response.status(404).json({ error: 'Notification not found.' });
        return;
      }
      await publishUnreadCount(recipientId);
      response.json({ read: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function publishUnreadCount(recipientId: string): Promise<void> {
  try {
    const unreadCount = await NotificationModel.countDocuments({
      recipientId,
      readAt: { $exists: false },
    });
    emitNotificationUnreadCount(recipientId, unreadCount);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'notification_unread_publish_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }));
  }
}

function authenticatedUserId(request: Request): string {
  const userId = (request as AuthenticatedRequest).authenticatedUserId;
  if (!userId) throw new Error('Authenticated user context is missing.');
  return userId;
}
