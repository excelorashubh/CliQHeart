import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { MediaModel } from '../media/media.model';
import { createNotificationSafely } from '../notifications/notification.service';
import { CommentLikeModel, CommentModel, LikeModel, RepostModel } from './engagement.models';
import { BookmarkModel } from './bookmark.model';
import { PostModel } from './post.model';
import { ReelModel } from './reel.model';
import { emitContentEngagement } from '../messages/realtime';

type ContentType = 'post' | 'reel';

const paramsSchema = z.object({
  contentId: z.string().regex(/^[a-f\d]{24}$/i),
});
const commentSchema = z.object({
  text: z.string().trim().min(1).max(2200),
  parentCommentId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
}).strict();
const editCommentSchema = z.object({ text: z.string().trim().min(1).max(2200) }).strict();
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const engagementSyncSchema = z.object({
  content: z.array(z.object({
    contentId: z.string().regex(/^[a-f\d]{24}$/i),
    contentType: z.enum(['post', 'reel']),
  }).strict()).min(1).max(100),
}).strict();

export function createEngagementRouter(config: AppConfig): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);
  const mutationRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 150,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  router.post('/engagement/sync', authenticate, async (request, response, next) => {
    try {
      const { content } = engagementSyncSchema.parse(request.body);
      response.json({
        content: await synchronizeEngagement(content, authenticatedUserId(request)),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid engagement sync request.' });
        return;
      }
      next(error);
    }
  });

  router.post('/:collection/:contentId/like', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const input = parseContentParams(request, response);
      if (!input) return;
      const content = await findVisibleContent(input.contentType, input.contentId);
      if (!content) {
        response.status(404).json({ error: 'Content not found.' });
        return;
      }
      const userId = authenticatedUserId(request);
      const like = await upsertUnique(LikeModel, { userId, contentId: input.contentId, contentType: input.contentType });
      if (like.inserted) {
        await createNotificationSafely({
          recipientId: String(content.ownerId),
          actorId: userId,
          type: 'like',
          ...(input.contentType === 'post' ? { postId: input.contentId } : { reelId: input.contentId }),
          deduplicationKey: `like:${like.id}`,
        });
      }
      const likeCount = await LikeModel.countDocuments({
        contentId: input.contentId,
        contentType: input.contentType,
      });
      if (like.inserted) {
        void publishEngagement(input.contentId, input.contentType, userId, 'like.created')
          .catch((error: unknown) => logEngagementPublishFailure(error));
      }
      response.json({
        liked: true,
        likeCount,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:collection/:contentId/like', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const input = parseContentParams(request, response);
      if (!input) return;
      const content = await findVisibleContent(input.contentType, input.contentId);
      if (!content) {
        response.status(404).json({ error: 'Content not found.' });
        return;
      }
      const removed = await LikeModel.deleteOne({
        userId: authenticatedUserId(request),
        contentId: input.contentId,
        contentType: input.contentType,
      });
      const likeCount = await LikeModel.countDocuments({ contentId: input.contentId, contentType: input.contentType });
      response.json({
        liked: false,
        likeCount,
      });
      if (removed.deletedCount > 0) {
        void publishEngagement(
          input.contentId,
          input.contentType,
          authenticatedUserId(request),
          'like.deleted',
        ).catch((error: unknown) => logEngagementPublishFailure(error));
      }
    } catch (error) {
      next(error);
    }
  });

  router.get('/:collection/:contentId/comments', authenticate, async (request, response, next) => {
    try {
      const input = parseContentParams(request, response);
      if (!input) return;
      const content = await findVisibleContent(input.contentType, input.contentId);
      if (!content) {
        response.status(404).json({ error: 'Content not found.' });
        return;
      }
      const { limit } = pageSchema.parse({ limit: request.query.limit ?? 20 });
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (after && !Types.ObjectId.isValid(after)) {
        response.status(400).json({ error: 'Invalid comment cursor.' });
        return;
      }
      const cursor = after
        ? await CommentModel.findOne({
          _id: after,
          contentType: input.contentType,
          contentId: input.contentId,
          parentCommentId: null,
        }).select('createdAt').lean()
        : null;
      if (after && !cursor) {
        response.status(400).json({ error: 'Invalid comment cursor.' });
        return;
      }
      const roots = await CommentModel.find({
        contentType: input.contentType,
        contentId: input.contentId,
        parentCommentId: null,
        ...(cursor ? {
          $or: [
            { createdAt: { $gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $gt: cursor._id } },
          ],
        } : {}),
      }).sort({ createdAt: 1, _id: 1 }).limit(limit + 1).lean();
      const hasMore = roots.length > limit;
      const page = hasMore ? roots.slice(0, limit) : roots;
      const replies = page.length
        ? await CommentModel.find({ parentCommentId: { $in: page.map((comment) => comment._id) } })
          .sort({ createdAt: 1, _id: 1 }).lean()
        : [];
      const comments = await commentPayloads([...page, ...replies], authenticatedUserId(request));
      response.json({
        comments,
        nextCursor: hasMore ? String(page.at(-1)?._id) : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid comment pagination.' });
        return;
      }
      next(error);
    }
  });

  router.post('/:collection/:contentId/comments', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const input = parseContentParams(request, response);
      if (!input) return;
      const content = await findVisibleContent(input.contentType, input.contentId);
      if (!content) {
        response.status(404).json({ error: 'Content not found.' });
        return;
      }
      const parsed = commentSchema.parse(request.body);
      const userId = authenticatedUserId(request);
      let recipientId = String(content.ownerId);
      if (parsed.parentCommentId) {
        const parent = await CommentModel.findOne({
          _id: parsed.parentCommentId,
          contentType: input.contentType,
          contentId: input.contentId,
          parentCommentId: null,
        }).select('userId').lean();
        if (!parent) {
          response.status(404).json({ error: 'Parent comment not found.' });
          return;
        }
        recipientId = String(parent.userId);
      }
      const comment = await CommentModel.create({
        userId,
        contentId: input.contentId,
        contentType: input.contentType,
        text: parsed.text,
        parentCommentId: parsed.parentCommentId ?? null,
      });
      await createNotificationSafely({
        recipientId,
        actorId: userId,
        type: parsed.parentCommentId ? 'reply' : 'comment',
        ...(input.contentType === 'post' ? { postId: input.contentId } : { reelId: input.contentId }),
        commentId: String(comment._id),
        deduplicationKey: `comment:${comment._id}`,
      });
      const [payload] = await commentPayloads([comment.toObject()], userId);
      const commentCount = await CommentModel.countDocuments({
        contentId: input.contentId,
        contentType: input.contentType,
      });
      void publishEngagement(input.contentId, input.contentType, userId, 'comment.created')
        .catch((error: unknown) => logEngagementPublishFailure(error));
      response.status(201).json({ comment: payload, commentCount });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Comment text must contain 1 to 2200 characters.' });
        return;
      }
      next(error);
    }
  });

  router.patch('/comments/:commentId', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const commentId = request.params.commentId;
      if (!commentId || !Types.ObjectId.isValid(commentId)) {
        response.status(400).json({ error: 'Invalid comment ID.' });
        return;
      }
      const { text } = editCommentSchema.parse(request.body);
      const comment = await CommentModel.findOneAndUpdate(
        { _id: commentId, userId: authenticatedUserId(request) },
        { $set: { text } },
        { new: true, runValidators: true },
      ).lean();
      if (!comment) {
        response.status(404).json({ error: 'Comment not found.' });
        return;
      }
      const [payload] = await commentPayloads([comment], authenticatedUserId(request));
      response.json({ comment: payload });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Comment text must contain 1 to 2200 characters.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/comments/:commentId', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const commentId = request.params.commentId;
      if (!commentId || !Types.ObjectId.isValid(commentId)) {
        response.status(400).json({ error: 'Invalid comment ID.' });
        return;
      }
      const comment = await CommentModel.findOneAndDelete({
        _id: commentId,
        userId: authenticatedUserId(request),
      }).lean();
      if (!comment) {
        response.status(404).json({ error: 'Comment not found.' });
        return;
      }
      const ids = comment.parentCommentId
        ? [comment._id]
        : [comment._id, ...(await CommentModel.find({ parentCommentId: comment._id }).distinct('_id'))];
      await Promise.all([
        CommentModel.deleteMany({ parentCommentId: comment._id }),
        CommentLikeModel.deleteMany({ commentId: { $in: ids } }),
      ]);
      const commentCount = await CommentModel.countDocuments({
        contentId: comment.contentId,
        contentType: comment.contentType,
      });
      response.json({
        deleted: true,
        commentCount,
      });
      void publishEngagement(
        String(comment.contentId),
        comment.contentType,
        authenticatedUserId(request),
        'comment.deleted',
      ).catch((error: unknown) => logEngagementPublishFailure(error));
    } catch (error) {
      next(error);
    }
  });

  router.post('/comments/:commentId/like', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const commentId = request.params.commentId;
      if (!commentId || !Types.ObjectId.isValid(commentId)) {
        response.status(400).json({ error: 'Invalid comment ID.' });
        return;
      }
      const comment = await CommentModel.findById(commentId).select('_id').lean();
      if (!comment) {
        response.status(404).json({ error: 'Comment not found.' });
        return;
      }
      await upsertUnique(CommentLikeModel, { userId: authenticatedUserId(request), commentId });
      response.json({
        liked: true,
        likeCount: await CommentLikeModel.countDocuments({ commentId }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/comments/:commentId/like', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const commentId = request.params.commentId;
      if (!commentId || !Types.ObjectId.isValid(commentId)) {
        response.status(400).json({ error: 'Invalid comment ID.' });
        return;
      }
      const comment = await CommentModel.findById(commentId).select('_id').lean();
      if (!comment) {
        response.status(404).json({ error: 'Comment not found.' });
        return;
      }
      await CommentLikeModel.deleteOne({ userId: authenticatedUserId(request), commentId });
      response.json({
        liked: false,
        likeCount: await CommentLikeModel.countDocuments({ commentId }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:collection/:contentId/repost', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const input = parseContentParams(request, response);
      if (!input) return;
      const content = await findVisibleContent(input.contentType, input.contentId);
      if (!content) {
        response.status(404).json({ error: 'Content not found.' });
        return;
      }
      const userId = authenticatedUserId(request);
      const repost = await upsertUnique(
        RepostModel,
        { userId, contentId: input.contentId, contentType: input.contentType },
      );
      if (repost.inserted) {
        await createNotificationSafely({
          recipientId: String(content.ownerId),
          actorId: userId,
          type: 'repost',
          ...(input.contentType === 'post' ? { postId: input.contentId } : { reelId: input.contentId }),
          deduplicationKey: `repost:${repost.id}`,
        });
      }
      response.json({
        reposted: true,
        repostCount: await RepostModel.countDocuments({ contentId: input.contentId, contentType: input.contentType }),
      });
      if (repost.inserted) {
        void publishEngagement(input.contentId, input.contentType, userId, 'repost.created')
          .catch((error: unknown) => logEngagementPublishFailure(error));
      }
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:collection/:contentId/repost', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const input = parseContentParams(request, response);
      if (!input) return;
      const content = await findVisibleContent(input.contentType, input.contentId);
      if (!content) {
        response.status(404).json({ error: 'Content not found.' });
        return;
      }
      const removed = await RepostModel.deleteOne({
        userId: authenticatedUserId(request),
        contentId: input.contentId,
        contentType: input.contentType,
      });
      const repostCount = await RepostModel.countDocuments({
        contentId: input.contentId,
        contentType: input.contentType,
      });
      response.json({
        reposted: false,
        repostCount,
      });
      if (removed.deletedCount > 0) {
        void publishEngagement(
          input.contentId,
          input.contentType,
          authenticatedUserId(request),
          'repost.deleted',
        ).catch((error: unknown) => logEngagementPublishFailure(error));
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/reels/:contentId/save', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const { contentId } = paramsSchema.parse(request.params);
      const content = await findVisibleContent('reel', contentId);
      if (!content) {
        response.status(404).json({ error: 'Reel not found.' });
        return;
      }
      const userId = authenticatedUserId(request);
      await upsertUnique(BookmarkModel, { userId, postId: contentId, contentType: 'reel' });
      response.json({ saved: true });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid Reel ID.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/reels/:contentId/save', authenticate, mutationRateLimit, async (request, response, next) => {
    try {
      const { contentId } = paramsSchema.parse(request.params);
      await BookmarkModel.deleteOne({
        userId: authenticatedUserId(request),
        postId: contentId,
        contentType: 'reel',
      });
      response.json({ saved: false });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid Reel ID.' });
        return;
      }
      next(error);
    }
  });

  return router;
}

async function findVisibleContent(contentType: ContentType, contentId: string) {
  const content = contentType === 'post'
    ? await PostModel.findById(contentId).select('ownerId mediaId').lean()
    : await ReelModel.findById(contentId).select('ownerId mediaId').lean();
  if (!content) return null;
  const visible = await Promise.all([
    UserModel.exists({ _id: content.ownerId, accountStatus: 'active' }),
    MediaModel.exists({ _id: content.mediaId, status: 'ready' }),
  ]);
  return visible.every(Boolean) ? content : null;
}

async function publishEngagement(
  contentId: string,
  contentType: ContentType,
  actorId: string,
  action: 'like.created' | 'like.deleted' | 'comment.created' | 'comment.deleted' |
    'repost.created' | 'repost.deleted',
): Promise<void> {
  const [likeCount, commentCount, repostCount] = await Promise.all([
    LikeModel.countDocuments({ contentId, contentType }),
    CommentModel.countDocuments({ contentId, contentType }),
    RepostModel.countDocuments({ contentId, contentType }),
  ]);
  emitContentEngagement({
    eventId: randomUUID(),
    action,
    contentId,
    contentType,
    actorId,
    likeCount,
    commentCount,
    repostCount,
    occurredAt: new Date().toISOString(),
  });
}

async function synchronizeEngagement(
  entries: Array<{ contentId: string; contentType: ContentType }>,
  viewerId: string,
): Promise<Array<{
  contentId: string;
  contentType: ContentType;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  isLiked: boolean;
  isReposted: boolean;
}>> {
  const uniqueEntries = [...new Map(
    entries.map((entry) => [`${entry.contentType}:${entry.contentId}`, entry]),
  ).values()];
  const postIds = uniqueEntries.filter((entry) => entry.contentType === 'post').map((entry) => entry.contentId);
  const reelIds = uniqueEntries.filter((entry) => entry.contentType === 'reel').map((entry) => entry.contentId);
  const [posts, reels] = await Promise.all([
    postIds.length ? PostModel.find({ _id: { $in: postIds } }).select('_id ownerId mediaId').lean() : [],
    reelIds.length ? ReelModel.find({ _id: { $in: reelIds } }).select('_id ownerId mediaId').lean() : [],
  ]);
  const content = [
    ...posts.map((item) => ({ ...item, contentType: 'post' as const })),
    ...reels.map((item) => ({ ...item, contentType: 'reel' as const })),
  ];
  const ownerIds = [...new Set(content.map((item) => String(item.ownerId)))];
  const mediaIds = [...new Set(content.map((item) => String(item.mediaId)))];
  const [owners, media] = await Promise.all([
    UserModel.find({ _id: { $in: ownerIds }, accountStatus: 'active' }).select('_id').lean(),
    MediaModel.find({ _id: { $in: mediaIds }, status: 'ready' }).select('_id').lean(),
  ]);
  const activeOwners = new Set(owners.map((owner) => String(owner._id)));
  const readyMedia = new Set(media.map((item) => String(item._id)));
  const visibleKeys = new Set(content
    .filter((item) => activeOwners.has(String(item.ownerId)) && readyMedia.has(String(item.mediaId)))
    .map((item) => `${item.contentType}:${String(item._id)}`));
  const contentIds = content.map((item) => item._id);
  const groupedCounts = { $group: {
    _id: { contentId: '$contentId', contentType: '$contentType' },
    count: { $sum: 1 },
  } };
  const [likes, comments, reposts, viewerLikes, viewerReposts] = await Promise.all([
    LikeModel.aggregate<{ _id: { contentId: Types.ObjectId; contentType: ContentType }; count: number }>([
      { $match: { contentId: { $in: contentIds } } },
      groupedCounts,
    ]),
    CommentModel.aggregate<{ _id: { contentId: Types.ObjectId; contentType: ContentType }; count: number }>([
      { $match: { contentId: { $in: contentIds } } },
      groupedCounts,
    ]),
    RepostModel.aggregate<{ _id: { contentId: Types.ObjectId; contentType: ContentType }; count: number }>([
      { $match: { contentId: { $in: contentIds } } },
      groupedCounts,
    ]),
    LikeModel.find({ userId: viewerId, contentId: { $in: contentIds } }).select('contentId contentType').lean(),
    RepostModel.find({ userId: viewerId, contentId: { $in: contentIds } }).select('contentId contentType').lean(),
  ]);
  const counts = (records: Array<{
    _id: { contentId: Types.ObjectId; contentType: ContentType };
    count: number;
  }>) => new Map(records.map((record) => [
    `${record._id.contentType}:${String(record._id.contentId)}`,
    record.count,
  ]));
  const likeCounts = counts(likes);
  const commentCounts = counts(comments);
  const repostCounts = counts(reposts);
  const contentKey = (entry: { contentId: Types.ObjectId; contentType: ContentType }) =>
    `${entry.contentType}:${String(entry.contentId)}`;
  const likedIds = new Set(viewerLikes.map(contentKey));
  const repostedIds = new Set(viewerReposts.map(contentKey));
  return uniqueEntries.flatMap(({ contentId, contentType }) => {
    const key = `${contentType}:${contentId}`;
    if (!visibleKeys.has(key)) return [];
    return [{
      contentId,
      contentType,
      likeCount: likeCounts.get(key) ?? 0,
      commentCount: commentCounts.get(key) ?? 0,
      repostCount: repostCounts.get(key) ?? 0,
      isLiked: likedIds.has(key),
      isReposted: repostedIds.has(key),
    }];
  });
}

function parseContentParams(request: Request, response: Response): {
  contentId: string;
  contentType: ContentType;
} | null {
  const collection = request.params.collection;
  const contentType = collection === 'posts' ? 'post' : collection === 'reels' ? 'reel' : null;
  const parsed = paramsSchema.safeParse({ contentId: request.params.contentId });
  if (!contentType || !parsed.success) {
    response.status(400).json({ error: 'Invalid content type or ID.' });
    return null;
  }
  return { contentId: parsed.data.contentId, contentType };
}

function logEngagementPublishFailure(error: unknown): void {
  console.error(JSON.stringify({
    event: 'content_engagement_event_failed',
    errorName: error instanceof Error ? error.name : 'UnknownError',
  }));
}

async function commentPayloads(comments: Array<{
  _id: unknown;
  userId: unknown;
  contentId: unknown;
  contentType: string;
  text: string;
  parentCommentId?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}>, viewerId: string) {
  if (!comments.length) return [];
  const ids = comments.map((comment) => comment._id);
  const userIds = [...new Set(comments.map((comment) => String(comment.userId)))];
  const [authors, likes, likeCounts] = await Promise.all([
    UserModel.find({ _id: { $in: userIds }, accountStatus: 'active' })
      .select('username displayName avatarUrl').lean(),
    CommentLikeModel.find({ userId: viewerId, commentId: { $in: ids } }).select('commentId').lean(),
    CommentLikeModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { commentId: { $in: ids } } },
      { $group: { _id: '$commentId', count: { $sum: 1 } } },
    ]),
  ]);
  const authorById = new Map(authors.map((author) => [String(author._id), author]));
  const likedIds = new Set(likes.map((like) => String(like.commentId)));
  const countById = new Map(likeCounts.map((entry) => [String(entry._id), entry.count]));
  return comments.flatMap((comment) => {
    const author = authorById.get(String(comment.userId));
    if (!author) return [];
    return [{
      id: String(comment._id),
      contentId: String(comment.contentId),
      contentType: comment.contentType,
      text: comment.text,
      parentCommentId: comment.parentCommentId ? String(comment.parentCommentId) : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      likeCount: countById.get(String(comment._id)) ?? 0,
      isLiked: likedIds.has(String(comment._id)),
      author: {
        id: String(author._id),
        username: author.username,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl,
      },
    }];
  });
}

async function upsertUnique<T>(
  model: {
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<{ upsertedCount: number; upsertedId?: unknown }>;
  },
  fields: T & Record<string, unknown>,
): Promise<{ inserted: boolean; id: string | null }> {
  try {
    const result = await model.updateOne(fields, { $setOnInsert: fields }, { upsert: true });
    return {
      inserted: result.upsertedCount > 0,
      id: result.upsertedId ? String(result.upsertedId) : null,
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      return { inserted: false, id: null };
    }
    throw error;
  }
}

function authenticatedUserId(request: Request): string {
  const userId = (request as AuthenticatedRequest).authenticatedUserId;
  if (!userId) throw new Error('Authenticated user context is missing.');
  return userId;
}
