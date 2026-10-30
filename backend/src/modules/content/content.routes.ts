import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { FollowModel } from '../users/follow.model';
import { MediaModel } from '../media/media.model';
import { isVerifiedDurationSeconds } from '../media/duration';
import { PostModel } from './post.model';
import { ReelModel } from './reel.model';
import { HashtagModel } from './hashtag.model';
import { StoryModel } from './story.model';
import { BookmarkModel } from './bookmark.model';
import { CommentLikeModel, CommentModel, LikeModel, RepostModel } from './engagement.models';
import { PostTagModel } from './post-tag.model';
import { ReelTagModel } from './reel-tag.model';
import { StoryLikeModel, StoryReactionModel, StoryReportModel, StoryViewModel } from './story-engagement.models';
import { createNotificationSafely } from '../notifications/notification.service';
import { NotificationModel } from '../notifications/notification.model';
import { recordContentView } from '../professional/professional.service';

const publishBaseSchema = {
  mediaId: z.string().regex(/^[a-f\d]{24}$/i),
  caption: z.string().trim().max(2200).default(''),
};
const updatePostSchema = z.object({
  caption: z.string().trim().max(2200).optional(),
  location: z.string().trim().max(120).optional(),
  altText: z.string().trim().max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0).superRefine(validateHashtagCount);
const updateReelSchema = z.object({
  caption: z.string().trim().max(2200).optional(),
  location: z.string().trim().max(120).optional(),
  aiDisclosure: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0).superRefine(validateHashtagCount);
const postPublishSchema = z.object({
  ...publishBaseSchema,
  location: z.string().trim().max(120).optional(),
  altText: z.string().trim().max(500).optional(),
}).strict().superRefine(validateHashtagCount);
const reelPublishSchema = z.object({
  ...publishBaseSchema,
  location: z.string().trim().max(120).optional(),
  aiDisclosure: z.boolean().optional(),
}).strict().superRefine(validateHashtagCount);
const addTagSchema = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

const storySchema = z.object({
  mediaId: z.string().regex(/^[a-f\d]{24}$/i),
  caption: z.string().trim().max(500).default(''),
}).strict();
const storyReactionSchema = z.object({
  emoji: z.enum(['❤️', '😂', '😮', '😢', '🔥', '👏', '🥰', '😍']),
}).strict();
const storyReportSchema = z.object({
  reason: z.string().trim().max(500).default(''),
}).strict();

const pageSizeSchema = z.coerce.number().int().min(1).max(50).default(30);
const storyLifetimeMs = 24 * 60 * 60 * 1000;

export function createContentRouter(config: AppConfig): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);

  router.get('/hashtags/search', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = typeof request.query.q === 'string'
        ? normalizeHashtagQuery(request.query.q)
        : '';
      if (!query) {
        response.json({ hashtags: [] });
        return;
      }
      const hashtags = await HashtagModel.find({
        normalizedName: { $regex: `^${escapeRegex(query)}` },
        usageCount: { $gt: 0 },
      }).sort({ usageCount: -1, normalizedName: 1 }).limit(10).lean();
      response.json({
        hashtags: hashtags.map((hashtag) => ({
          name: hashtag.name,
          normalizedName: hashtag.normalizedName,
          usageCount: hashtag.usageCount,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/hashtags/trending', authenticate, async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const hashtags = await HashtagModel.find({ usageCount: { $gt: 0 } })
        .sort({ usageCount: -1, normalizedName: 1 }).limit(10).lean();
      response.json({
        hashtags: hashtags.map((hashtag) => ({
          name: hashtag.name,
          normalizedName: hashtag.normalizedName,
          usageCount: hashtag.usageCount,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/hashtags/:tag', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const tag = normalizeHashtagName(request.params.tag ?? '');
      if (!tag) {
        response.status(400).json({ error: 'Invalid hashtag.' });
        return;
      }
      const hashtag = await HashtagModel.findOne({ normalizedName: tag }).lean();
      if (!hashtag || hashtag.usageCount === 0) {
        response.status(404).json({ error: 'Hashtag not found.' });
        return;
      }
      const limit = pageSizeSchema.parse(request.query.limit ?? 30);
      const cursor = parseHashtagCursor(request.query.after);
      if (request.query.after !== undefined && !cursor) {
        response.status(400).json({ error: 'Invalid hashtag cursor.' });
        return;
      }
      const cursorFilter = cursor
        ? {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
          ],
        }
        : {};
      const [posts, reels] = await Promise.all([
        PostModel.find({ hashtags: tag, ...cursorFilter })
          .sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean(),
        ReelModel.find({ hashtags: tag, ...cursorFilter })
          .sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean(),
      ]);
      const merged = [
        ...posts.map((item) => ({ item, kind: 'post' as const })),
        ...reels.map((item) => ({ item, kind: 'reel' as const })),
      ].sort((first, second) =>
        new Date(second.item.createdAt ?? 0).getTime() - new Date(first.item.createdAt ?? 0).getTime() ||
        String(second.item._id).localeCompare(String(first.item._id)));
      const hasMore = merged.length > limit;
      const page = hasMore ? merged.slice(0, limit) : merged;
      const [postPayloads, reelPayloads] = await Promise.all([
        contentListPayload(page.filter((entry) => entry.kind === 'post').map((entry) => entry.item), authenticatedUserId(request), 'post'),
        contentListPayload(page.filter((entry) => entry.kind === 'reel').map((entry) => entry.item), authenticatedUserId(request), 'reel'),
      ]);
      const payloadByKey = new Map([
        ...postPayloads.map((item) => [`post:${item.id}`, item] as const),
        ...reelPayloads.map((item) => [`reel:${item.id}`, item] as const),
      ]);
      const items = page.flatMap(({ item, kind }) => {
        const content = payloadByKey.get(`${kind}:${String(item._id)}`);
        return content ? [{ ...content, contentType: kind }] : [];
      });
      const lastItem = page.at(-1)?.item;
      response.json({
        hashtag: {
          name: hashtag.name,
          normalizedName: hashtag.normalizedName,
          usageCount: hashtag.usageCount,
        },
        items,
        nextCursor: hasMore && lastItem?.createdAt
          ? `${new Date(lastItem.createdAt).getTime()}_${String(lastItem._id)}`
          : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid hashtag page size.' });
        return;
      }
      next(error);
    }
  });

  router.post('/posts', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { mediaId, caption, location, altText } = postPublishSchema.parse(request.body);
      const hashtags = extractHashtags(caption);
      const ownerId = authenticatedUserId(request);
      const postId = new Types.ObjectId();
      const media = await claimMedia(mediaId, ownerId, 'post', ['image', 'video'], postId);
      if (!media) {
        response.status(409).json({ error: 'Choose a verified post upload owned by your account.' });
        return;
      }
      const post = await PostModel.create({
          _id: postId,
          ownerId,
          mediaId: media._id,
          caption,
          hashtags,
          ...(location ? { location } : {}),
          ...(altText ? { altText } : {}),
        }).catch(async (error: unknown) => {
          await releaseMedia(media._id, postId, 'post');
          throw error;
        });
      await synchronizeHashtagUsage([], hashtags);
      response.status(201).json({
        post: { ...await contentPayload(post, media), isSaved: false },
      });
    } catch (error) {
      handleValidationError(error, request, response, config);
      if (!(error instanceof ZodError)) next(error);
    }
  });

  router.get('/posts', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const limit = pageSizeSchema.parse(request.query.limit ?? 30);
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (request.query.after !== undefined && (!after || !Types.ObjectId.isValid(after))) {
        response.status(400).json({ error: 'Invalid post cursor.' });
        return;
      }
      const cursor = after ? await PostModel.findById(after).select('createdAt').lean() : null;
      if (after && !cursor) {
        response.status(400).json({ error: 'Invalid post cursor.' });
        return;
      }
      const posts = await PostModel.find(cursor
        ? {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
          ],
        }
        : {})
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
      const hasMore = posts.length > limit;
      const page = hasMore ? posts.slice(0, limit) : posts;
      const viewerId = authenticatedUserId(request);
      const items = await contentListPayload(page, viewerId, 'post');
      const followedOwnerIds = new Set(
        items.length
          ? (await FollowModel.find({
            followerId: viewerId,
            followedId: { $in: items.map((item) => item.owner.id) },
          }).select('followedId').lean()).map((edge) => String(edge.followedId))
          : [],
      );
      response.json({
        posts: items.map((item) => ({
          ...item,
          isFollowing: item.owner.id === viewerId || followedOwnerIds.has(item.owner.id),
        })),
        nextCursor: hasMore ? String(page.at(-1)?._id) : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid page size.' });
        return;
      }
      next(error);
    }
  });

  router.get('/posts/:postId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const postId = request.params.postId;
      if (!postId || !Types.ObjectId.isValid(postId)) {
        response.status(400).json({ error: 'Invalid post ID.' });
        return;
      }
      const post = await PostModel.findById(postId).lean();
      const [visiblePost] = post ? await contentListPayload([post], authenticatedUserId(request), 'post') : [];
      if (!post || !visiblePost) {
        response.status(404).json({ error: 'Post not found.' });
        return;
      }
      recordContentView(String(post.ownerId), authenticatedUserId(request), 'post', String(post._id));
      response.json({ post: visiblePost });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/posts/:postId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const postId = request.params.postId;
      if (!postId || !Types.ObjectId.isValid(postId)) {
        response.status(400).json({ error: 'Invalid post ID.' });
        return;
      }
      const updates = updatePostSchema.parse(request.body);
      const existing = await PostModel.findOne({ _id: postId, ownerId: authenticatedUserId(request) }).lean();
      if (!existing) {
        response.status(404).json({ error: 'Post not found.' });
        return;
      }
      const caption = updates.caption ?? existing.caption ?? '';
      const hashtags = extractHashtags(caption);
      const post = await PostModel.findOneAndUpdate(
        { _id: postId, ownerId: authenticatedUserId(request) },
        { $set: { ...updates, caption, hashtags } },
        { new: true, runValidators: true },
      ).lean();
      if (!post) {
        response.status(404).json({ error: 'Post not found.' });
        return;
      }
      await synchronizeHashtagUsage(existing.hashtags ?? [], hashtags);
      const media = await MediaModel.findById(post.mediaId).lean();
      if (!media) {
        response.status(404).json({ error: 'Post media not found.' });
        return;
      }
      response.json({ post: { ...await contentPayload(post, media), isSaved: false } });
    } catch (error) {
      handleValidationError(error, request, response, config);
      if (!(error instanceof ZodError)) next(error);
    }
  });

  router.post('/posts/:postId/save', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const postId = request.params.postId;
      if (!postId || !Types.ObjectId.isValid(postId)) {
        response.status(400).json({ error: 'Invalid post ID.' });
        return;
      }
      const post = await PostModel.findById(postId).select('ownerId mediaId').lean();
      const canView = post && await UserModel.exists({ _id: post.ownerId, accountStatus: 'active' }) &&
        await MediaModel.exists({ _id: post.mediaId, status: 'ready' });
      if (!canView) {
        response.status(404).json({ error: 'Post not found.' });
        return;
      }
      await BookmarkModel.updateOne(
        {
          userId: authenticatedUserId(request),
          postId,
          $or: [{ contentType: 'post' }, { contentType: { $exists: false } }],
        },
        { $setOnInsert: { userId: authenticatedUserId(request), postId, contentType: 'post' } },
        { upsert: true },
      );
      response.json({ saved: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/posts/:postId/save', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const postId = request.params.postId;
      if (!postId || !Types.ObjectId.isValid(postId)) {
        response.status(400).json({ error: 'Invalid post ID.' });
        return;
      }
      await BookmarkModel.deleteOne({
        userId: authenticatedUserId(request),
        postId,
        $or: [{ contentType: 'post' }, { contentType: { $exists: false } }],
      });
      response.json({ saved: false });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/me/saved', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (after && !Types.ObjectId.isValid(after)) {
        response.status(400).json({ error: 'Invalid pagination cursor.' });
        return;
      }
      const limit = await parsePageSize(request);
      const savedKind = request.query.kind;
      if (savedKind !== undefined && savedKind !== 'posts' && savedKind !== 'reels') {
        response.status(400).json({ error: 'Invalid saved content type.' });
        return;
      }
      const typeFilter = savedKind === 'posts'
        ? { $or: [{ contentType: 'post' }, { contentType: { $exists: false } }] }
        : savedKind === 'reels' ? { contentType: 'reel' } : {};
      const bookmarks = await BookmarkModel.find({
        userId: authenticatedUserId(request),
        ...typeFilter,
        ...(after ? { _id: { $lt: after } } : {}),
      }).sort({ _id: -1 }).limit(limit + 1).lean();
      const hasMore = bookmarks.length > limit;
      const page = hasMore ? bookmarks.slice(0, limit) : bookmarks;
      const postIds = page.filter((bookmark) => bookmark.contentType !== 'reel').map((item) => item.postId);
      const reelIds = page.filter((bookmark) => bookmark.contentType === 'reel').map((item) => item.postId);
      const [foundPosts, foundReels] = await Promise.all([
        postIds.length ? PostModel.find({ _id: { $in: postIds } }).lean() : Promise.resolve([]),
        reelIds.length ? ReelModel.find({ _id: { $in: reelIds } }).lean() : Promise.resolve([]),
      ]);
      const postById = new Map(foundPosts.map((post) => [String(post._id), post]));
      const reelById = new Map(foundReels.map((reel) => [String(reel._id), reel]));
      const content = page.flatMap((bookmark) => {
        const type = bookmark.contentType === 'reel' ? 'reel' : 'post';
        const item = type === 'reel'
          ? reelById.get(String(bookmark.postId))
          : postById.get(String(bookmark.postId));
        return item ? [{ item, type }] : [];
      });
      const posts = await contentListPayload(
        content.filter((entry) => entry.type === 'post').map((entry) => entry.item),
        authenticatedUserId(request),
        'post',
      );
      const reels = await contentListPayload(
        content.filter((entry) => entry.type === 'reel').map((entry) => entry.item),
        authenticatedUserId(request),
        'reel',
      );
      const postByContentId = new Map(posts.map((item) => [item.id, item]));
      const reelByContentId = new Map(reels.map((item) => [item.id, item]));
      const items = content.flatMap(({ item, type }) => {
        const payload = (type === 'reel' ? reelByContentId : postByContentId).get(String(item._id));
        return payload ? [{ ...payload, contentType: type }] : [];
      });
      response.json({
        items,
        posts,
        reels,
        nextCursor: hasMore ? String(page.at(-1)?._id) : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid page size.' });
        return;
      }
      next(error);
    }
  });

  router.get('/users/:userId/tagged', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = request.params.userId;
      if (!userId || (!Types.ObjectId.isValid(userId) && !/^[a-z0-9._]{3,30}$/i.test(userId))) {
        response.status(400).json({ error: 'Invalid user ID or username.' });
        return;
      }
      const taggedUser = await UserModel.findOne({
        ...(Types.ObjectId.isValid(userId) ? { _id: userId } : { username: userId.toLowerCase() }),
        accountStatus: 'active',
      }).select('_id').lean();
      if (!taggedUser) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (after && !Types.ObjectId.isValid(after)) {
        response.status(400).json({ error: 'Invalid pagination cursor.' });
        return;
      }
      const limit = await parsePageSize(request);
      const [postTags, reelTags] = await Promise.all([
        PostTagModel.find({
          userId: taggedUser._id,
          ...(after ? { _id: { $lt: after } } : {}),
        }).sort({ _id: -1 }).limit(limit + 1).lean(),
        ReelTagModel.find({
          userId: taggedUser._id,
          ...(after ? { _id: { $lt: after } } : {}),
        }).sort({ _id: -1 }).limit(limit + 1).lean(),
      ]);
      const tags = [
        ...postTags.map((tag) => ({ tag, contentType: 'post' as const })),
        ...reelTags.map((tag) => ({ tag, contentType: 'reel' as const })),
      ].sort((first, second) => String(second.tag._id).localeCompare(String(first.tag._id)));
      const hasMore = tags.length > limit;
      const page = hasMore ? tags.slice(0, limit) : tags;
      const postIds = page.filter((entry) => entry.contentType === 'post').map((entry) => entry.tag.postId);
      const reelIds = page.filter((entry) => entry.contentType === 'reel').map((entry) => entry.tag.reelId);
      const [foundPosts, foundReels] = await Promise.all([
        postIds.length ? PostModel.find({ _id: { $in: postIds } }).lean() : Promise.resolve([]),
        reelIds.length ? ReelModel.find({ _id: { $in: reelIds } }).lean() : Promise.resolve([]),
      ]);
      const postById = new Map(foundPosts.map((post) => [String(post._id), post]));
      const reelById = new Map(foundReels.map((reel) => [String(reel._id), reel]));
      const posts = page.flatMap(({ tag, contentType }) => {
        const post = contentType === 'post' ? postById.get(String(tag.postId)) : undefined;
        return post ? [post] : [];
      });
      const reels = page.flatMap(({ tag, contentType }) => {
        const reel = contentType === 'reel' ? reelById.get(String(tag.reelId)) : undefined;
        return reel ? [reel] : [];
      });
      const [postPayloads, reelPayloads] = await Promise.all([
        contentListPayload(posts, authenticatedUserId(request), 'post'),
        contentListPayload(reels, authenticatedUserId(request), 'reel'),
      ]);
      const postPayloadById = new Map(postPayloads.map((item) => [item.id, item]));
      const reelPayloadById = new Map(reelPayloads.map((item) => [item.id, item]));
      const items = page.flatMap(({ tag, contentType }) => {
        if (contentType === 'reel') {
          const item = reelPayloadById.get(String(tag.reelId));
          return item ? [{ ...item, contentType: 'reel' }] : [];
        }
        const item = postPayloadById.get(String(tag.postId));
        return item ? [{ ...item, contentType: 'post' }] : [];
      });
      response.json({
        items,
        posts: postPayloads,
        reels: reelPayloads,
        nextCursor: hasMore ? String(page.at(-1)?.tag._id) : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid page size.' });
        return;
      }
      next(error);
    }
  });

  router.post('/posts/:postId/tags', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const postId = request.params.postId;
      if (!postId || !Types.ObjectId.isValid(postId)) {
        response.status(400).json({ error: 'Invalid post ID.' });
        return;
      }
      const { userId: taggedUserId } = addTagSchema.parse(request.body);
      const actorId = authenticatedUserId(request);
      const post = await PostModel.findOne({ _id: postId, ownerId: actorId }).select('_id');
      if (!post) {
        response.status(404).json({ error: 'Post not found or not owned by this account.' });
        return;
      }
      const target = await UserModel.findOne({ _id: taggedUserId, accountStatus: 'active' }).select('_id');
      if (!target) {
        response.status(404).json({ error: 'Tagged user not found.' });
        return;
      }
      const tagResult = await PostTagModel.updateOne(
        { postId, userId: taggedUserId },
        { $setOnInsert: { postId, userId: taggedUserId, taggedById: actorId } },
        { upsert: true },
      );
      if (tagResult.upsertedCount > 0) {
        await createNotificationSafely({
          recipientId: taggedUserId,
          actorId,
          type: 'tag',
          postId,
          deduplicationKey: `tag:${tagResult.upsertedId}`,
        });
      }
      response.json({ tagged: true });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid tag request.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/posts/:postId/tags/me', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const postId = request.params.postId;
      if (!postId || !Types.ObjectId.isValid(postId)) {
        response.status(400).json({ error: 'Invalid post ID.' });
        return;
      }
      await PostTagModel.deleteOne({ postId, userId: authenticatedUserId(request) });
      response.json({ tagged: false });
    } catch (error) {
      next(error);
    }
  });

  router.post('/reels/:reelId/tags', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const reelId = request.params.reelId;
      if (!reelId || !Types.ObjectId.isValid(reelId)) {
        response.status(400).json({ error: 'Invalid Reel ID.' });
        return;
      }
      const { userId: taggedUserId } = addTagSchema.parse(request.body);
      const actorId = authenticatedUserId(request);
      const reel = await ReelModel.findOne({ _id: reelId, ownerId: actorId }).select('_id');
      if (!reel) {
        response.status(404).json({ error: 'Reel not found or not owned by this account.' });
        return;
      }
      const target = await UserModel.findOne({ _id: taggedUserId, accountStatus: 'active' }).select('_id');
      if (!target) {
        response.status(404).json({ error: 'Tagged user not found.' });
        return;
      }
      const tagResult = await ReelTagModel.updateOne(
        { reelId, userId: taggedUserId },
        { $setOnInsert: { reelId, userId: taggedUserId, taggedById: actorId } },
        { upsert: true },
      );
      if (tagResult.upsertedCount > 0) {
        await createNotificationSafely({
          recipientId: taggedUserId,
          actorId,
          type: 'tag',
          reelId,
          deduplicationKey: `tag:${tagResult.upsertedId}`,
        });
      }
      response.json({ tagged: true });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid tag request.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/reels/:reelId/tags/me', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const reelId = request.params.reelId;
      if (!reelId || !Types.ObjectId.isValid(reelId)) {
        response.status(400).json({ error: 'Invalid Reel ID.' });
        return;
      }
      await ReelTagModel.deleteOne({ reelId, userId: authenticatedUserId(request) });
      response.json({ tagged: false });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:userId/posts', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = request.params.userId;
      if (!userId || !Types.ObjectId.isValid(userId)) {
        response.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const profileOwner = await UserModel.findOne({ _id: userId, accountStatus: 'active' })
        .select('username').lean();
      if (!profileOwner) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      const [posts, reposts] = await Promise.all([
        PostModel.find({ ownerId: userId }).sort({ createdAt: -1 }).limit(await parsePageSize(request)).lean(),
        RepostModel.find({ userId, contentType: 'post' }).sort({ createdAt: -1 }).limit(await parsePageSize(request)).lean(),
      ]);
      const repostedPosts = reposts.length
        ? await PostModel.find({ _id: { $in: reposts.map((repost) => repost.contentId) } }).lean()
        : [];
      const [postPayloads, repostPayloads] = await Promise.all([
        contentListPayload(posts, authenticatedUserId(request), 'post'),
        contentListPayload(repostedPosts, authenticatedUserId(request), 'post'),
      ]);
      const repostByContentId = new Map(reposts.map((repost) => [String(repost.contentId), repost]));
      const profile = { id: userId, username: profileOwner.username };
      const items = [
        ...postPayloads.map((item) => ({ ...item, repostedAt: item.createdAt })),
        ...repostPayloads.flatMap((item) => {
          const repost = repostByContentId.get(item.id);
          return repost ? [{ ...item, repostedAt: repost.createdAt, repostedBy: profile, feedKey: String(repost._id) }] : [];
        }),
      ].sort((first, second) =>
        new Date(second.repostedAt || second.createdAt || 0).getTime() -
        new Date(first.repostedAt || first.createdAt || 0).getTime());
      response.json({ posts: items });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid page size.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/posts/:postId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const postId = request.params.postId;
      if (!postId || !Types.ObjectId.isValid(postId)) {
        response.status(400).json({ error: 'Invalid post ID.' });
        return;
      }
      const ownerId = authenticatedUserId(request);
      const post = await PostModel.findOneAndDelete({ _id: postId, ownerId });
      if (!post) {
        response.status(404).json({ error: 'Post not found.' });
        return;
      }
      const commentIds = await CommentModel.find({ contentId: postId, contentType: 'post' }).distinct('_id');
      await Promise.all([
        BookmarkModel.deleteMany({ postId, $or: [{ contentType: 'post' }, { contentType: { $exists: false } }] }),
        PostTagModel.deleteMany({ postId }),
        LikeModel.deleteMany({ contentId: postId, contentType: 'post' }),
        CommentModel.deleteMany({ contentId: postId, contentType: 'post' }),
        CommentLikeModel.deleteMany({ commentId: { $in: commentIds } }),
        RepostModel.deleteMany({ contentId: postId, contentType: 'post' }),
        NotificationModel.deleteMany({ $or: [{ postId }, { commentId: { $in: commentIds } }] }),
        synchronizeHashtagUsage(post.hashtags ?? [], []),
      ]);
      await releaseMedia(post.mediaId, post._id, 'post');
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/stories', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { mediaId, caption } = storySchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      const storyId = new Types.ObjectId();
      const media = await claimMedia(mediaId, ownerId, 'story', ['image', 'video'], storyId);
      if (!media) {
        response.status(409).json({ error: 'Choose a verified story upload owned by your account.' });
        return;
      }
      try {
        const story = await StoryModel.create({
          _id: storyId,
          ownerId,
          mediaId: media._id,
          caption,
          expiresAt: new Date(Date.now() + storyLifetimeMs),
        });
        response.status(201).json({ story: await contentPayload(story, media) });
      } catch (error) {
        await releaseMedia(media._id, storyId, 'story');
        throw error;
      }
    } catch (error) {
      handleValidationError(error, request, response, config);
      if (!(error instanceof ZodError)) next(error);
    }
  });

  router.get('/stories', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const ownerId = authenticatedUserId(request);
      const follows = await FollowModel.find({ followerId: ownerId }).select('followedId').lean();
      const visibleOwners = [ownerId, ...follows.map((follow) => String(follow.followedId))];
      const stories = await StoryModel.find({
        ownerId: { $in: visibleOwners },
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: 1 }).limit(200).lean();
      response.json({ stories: await contentListPayload(stories, undefined, 'story') });
    } catch (error) {
      next(error);
    }
  });

  router.post('/stories/:storyId/view', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = validStoryId(request.params.storyId, response);
      if (!storyId) return;
      const viewerId = authenticatedUserId(request);
      const story = await activeStoryVisibleTo(storyId, viewerId);
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      if (String(story.ownerId) !== viewerId) {
        try {
          await StoryViewModel.updateOne(
            { storyId: story._id, viewerId },
            { $setOnInsert: { storyId: story._id, viewerId, viewedAt: new Date() } },
            { upsert: true },
          );
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
        }
      }
      const [viewCount, isLiked] = await Promise.all([
        StoryViewModel.countDocuments({ storyId: story._id }),
        StoryLikeModel.exists({ storyId: story._id, userId: viewerId }),
      ]);
      response.json({ viewCount, isLiked: Boolean(isLiked), isOwner: String(story.ownerId) === viewerId });
    } catch (error) {
      next(error);
    }
  });

  router.get('/stories/:storyId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = validStoryId(request.params.storyId, response);
      if (!storyId) return;
      const viewerId = authenticatedUserId(request);
      const story = await activeStoryVisibleTo(storyId, viewerId);
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      const media = await MediaModel.findOne({ _id: story.mediaId, status: 'ready' }).lean();
      if (!media) {
        response.status(404).json({ error: 'Story media is not available.' });
        return;
      }
      const [payload, isLiked] = await Promise.all([
        contentPayload(story, media),
        StoryLikeModel.exists({ storyId, userId: viewerId }),
      ]);
      response.json({ story: { ...payload, isLiked: Boolean(isLiked) } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/stories/:storyId/views', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = validStoryId(request.params.storyId, response);
      if (!storyId) return;
      const ownerId = authenticatedUserId(request);
      const story = await StoryModel.findOne({
        _id: storyId,
        ownerId,
        expiresAt: { $gt: new Date() },
      }).select('_id').lean();
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      const limit = pageSizeSchema.parse(request.query.limit ?? 20);
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (after && !Types.ObjectId.isValid(after)) {
        response.status(400).json({ error: 'Invalid story-view cursor.' });
        return;
      }
      const [viewCount, viewRows] = await Promise.all([
        StoryViewModel.countDocuments({ storyId }),
        StoryViewModel.find({ storyId, ...(after ? { _id: { $lt: after } } : {}) })
          .sort({ _id: -1 }).limit(limit + 1).lean(),
      ]);
      const hasMore = viewRows.length > limit;
      const page = hasMore ? viewRows.slice(0, limit) : viewRows;
      const viewers = await UserModel.find({
        _id: { $in: page.map((view) => view.viewerId) },
        accountStatus: 'active',
      }).select('username displayName avatarUrl').lean();
      const viewerById = new Map(viewers.map((viewer) => [String(viewer._id), viewer]));
      response.json({
        viewCount,
        viewers: page.flatMap((view) => {
          const viewer = viewerById.get(String(view.viewerId));
          return viewer ? [{
            id: String(viewer._id),
            username: viewer.username,
            displayName: viewer.displayName,
            avatarUrl: viewer.avatarUrl,
            viewedAt: view.viewedAt,
          }] : [];
        }),
        nextCursor: hasMore ? String(page.at(-1)?._id) : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid story-view pagination.' });
        return;
      }
      next(error);
    }
  });

  router.post('/stories/:storyId/like', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = validStoryId(request.params.storyId, response);
      if (!storyId) return;
      const userId = authenticatedUserId(request);
      const story = await activeStoryVisibleTo(storyId, userId);
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      if (String(story.ownerId) === userId) {
        response.status(400).json({ error: 'You cannot like your own story.' });
        return;
      }
      try {
        await StoryLikeModel.updateOne(
          { storyId: story._id, userId },
          { $setOnInsert: { storyId: story._id, userId } },
          { upsert: true },
        );
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      await createNotificationSafely({
        recipientId: String(story.ownerId),
        actorId: userId,
        type: 'story_like',
        storyId,
        deduplicationKey: `story-like:${storyId}:${userId}`,
      });
      response.json({ isLiked: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/stories/:storyId/like', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = validStoryId(request.params.storyId, response);
      if (!storyId) return;
      const userId = authenticatedUserId(request);
      const story = await activeStoryVisibleTo(storyId, userId);
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      await StoryLikeModel.deleteOne({ storyId, userId });
      response.json({ isLiked: false });
    } catch (error) {
      next(error);
    }
  });

  router.post('/stories/:storyId/reactions', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = validStoryId(request.params.storyId, response);
      if (!storyId) return;
      const { emoji } = storyReactionSchema.parse(request.body);
      const senderId = authenticatedUserId(request);
      const story = await activeStoryVisibleTo(storyId, senderId);
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      if (String(story.ownerId) === senderId) {
        response.status(400).json({ error: 'You cannot react to your own story.' });
        return;
      }
      let inserted = false;
      try {
        const result = await StoryReactionModel.updateOne(
          { storyId, senderId, emoji },
          { $setOnInsert: { storyId, senderId, receiverId: String(story.ownerId), emoji } },
          { upsert: true },
        );
        inserted = result.upsertedCount > 0;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      if (inserted) {
        await createNotificationSafely({
          recipientId: String(story.ownerId),
          actorId: senderId,
          type: 'story_reaction',
          storyId,
          deduplicationKey: `story-reaction:${storyId}:${senderId}:${emoji}`,
        });
      }
      response.status(inserted ? 201 : 200).json({ sent: true, duplicate: !inserted });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Choose a supported story reaction.' });
        return;
      }
      next(error);
    }
  });

  router.post('/stories/:storyId/report', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = validStoryId(request.params.storyId, response);
      if (!storyId) return;
      const { reason } = storyReportSchema.parse(request.body);
      const reporterId = authenticatedUserId(request);
      const story = await activeStoryVisibleTo(storyId, reporterId);
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      if (String(story.ownerId) === reporterId) {
        response.status(400).json({ error: 'You cannot report your own story.' });
        return;
      }
      let inserted = false;
      try {
        const result = await StoryReportModel.updateOne(
          { storyId, reporterId },
          { $setOnInsert: { storyId, reporterId, reason } },
          { upsert: true },
        );
        inserted = result.upsertedCount > 0;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      response.status(inserted ? 201 : 200).json({ reported: true, duplicate: !inserted });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid story report.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/stories/:storyId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const storyId = request.params.storyId;
      if (!storyId || !Types.ObjectId.isValid(storyId)) {
        response.status(400).json({ error: 'Invalid story ID.' });
        return;
      }
      const story = await StoryModel.findOneAndDelete({
        _id: storyId,
        ownerId: authenticatedUserId(request),
      });
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      await Promise.all([
        releaseMedia(story.mediaId, story._id, 'story'),
        StoryViewModel.deleteMany({ storyId }),
        StoryLikeModel.deleteMany({ storyId }),
        StoryReactionModel.deleteMany({ storyId }),
        StoryReportModel.deleteMany({ storyId }),
      ]);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/reels', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { mediaId, caption, location, aiDisclosure } = reelPublishSchema.parse(request.body);
      const hashtags = extractHashtags(caption);
      const ownerId = authenticatedUserId(request);
      const reelId = new Types.ObjectId();
      const media = await claimMedia(mediaId, ownerId, 'reel', ['video'], reelId);
      if (!media) {
        response.status(409).json({ error: 'Choose a verified video to publish this Reel.' });
        return;
      }
      if (!isVerifiedDurationSeconds(media.duration)) {
        await releaseMedia(media._id, reelId, 'reel');
        response.status(409).json({ error: 'Could not verify this video\'s duration. Choose another video or retry the upload.' });
        return;
      }
      if (media.duration > 180) {
        await releaseMedia(media._id, reelId, 'reel');
        response.status(409).json({ error: 'Choose a verified video no longer than 180 seconds.' });
        return;
      }
      const reel = await ReelModel.create({
          _id: reelId,
          ownerId,
          mediaId: media._id,
          caption,
          hashtags,
          ...(location ? { location } : {}),
          ...(aiDisclosure ? { aiDisclosure } : {}),
        }).catch(async (error: unknown) => {
          await releaseMedia(media._id, reelId, 'reel');
          throw error;
        });
      await synchronizeHashtagUsage([], hashtags);
      response.status(201).json({ reel: await contentPayload(reel, media) });
    } catch (error) {
      handleValidationError(error, request, response, config);
      if (!(error instanceof ZodError)) next(error);
    }
  });

  router.patch('/reels/:reelId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const reelId = request.params.reelId;
      if (!reelId || !Types.ObjectId.isValid(reelId)) {
        response.status(400).json({ error: 'Invalid Reel ID.' });
        return;
      }
      const updates = updateReelSchema.parse(request.body);
      const existing = await ReelModel.findOne({ _id: reelId, ownerId: authenticatedUserId(request) }).lean();
      if (!existing) {
        response.status(404).json({ error: 'Reel not found.' });
        return;
      }
      const caption = updates.caption ?? existing.caption ?? '';
      const hashtags = extractHashtags(caption);
      const reel = await ReelModel.findOneAndUpdate(
        { _id: reelId, ownerId: authenticatedUserId(request) },
        { $set: { ...updates, caption, hashtags } },
        { new: true, runValidators: true },
      ).lean();
      if (!reel) {
        response.status(404).json({ error: 'Reel not found.' });
        return;
      }
      await synchronizeHashtagUsage(existing.hashtags ?? [], hashtags);
      const media = await MediaModel.findById(reel.mediaId).lean();
      if (!media) {
        response.status(404).json({ error: 'Reel media not found.' });
        return;
      }
      response.json({ reel: await contentPayload(reel, media) });
    } catch (error) {
      handleValidationError(error, request, response, config);
      if (!(error instanceof ZodError)) next(error);
    }
  });

  router.get('/reels', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const limit = pageSizeSchema.parse(request.query.limit ?? 30);
      const after = typeof request.query.after === 'string' ? request.query.after : undefined;
      if (request.query.after !== undefined && (!after || !Types.ObjectId.isValid(after))) {
        response.status(400).json({ error: 'Invalid Reel cursor.' });
        return;
      }
      const cursor = after ? await ReelModel.findById(after).select('createdAt').lean() : null;
      if (after && !cursor) {
        response.status(400).json({ error: 'Invalid Reel cursor.' });
        return;
      }
      const reels = await ReelModel.find(cursor
        ? {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
          ],
        }
        : {})
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();
      const hasMore = reels.length > limit;
      const page = hasMore ? reels.slice(0, limit) : reels;
      const viewerId = authenticatedUserId(request);
      const items = await contentListPayload(page, viewerId, 'reel');
      const followedOwnerIds = new Set(
        items.length
          ? (await FollowModel.find({
            followerId: viewerId,
            followedId: { $in: items.map((item) => item.owner.id) },
          }).select('followedId').lean()).map((edge) => String(edge.followedId))
          : [],
      );
      response.json({
        reels: items.map((item) => ({
          ...item,
          isFollowing: item.owner.id === viewerId || followedOwnerIds.has(item.owner.id),
        })),
        nextCursor: hasMore ? String(page.at(-1)?._id) : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid page size.' });
        return;
      }
      next(error);
    }
  });

  router.get('/reels/:reelId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const reelId = request.params.reelId;
      if (!reelId || !Types.ObjectId.isValid(reelId)) {
        response.status(400).json({ error: 'Invalid Reel ID.' });
        return;
      }
      const reel = await ReelModel.findById(reelId).lean();
      const [visibleReel] = reel ? await contentListPayload([reel], authenticatedUserId(request), 'reel') : [];
      if (!reel || !visibleReel) {
        response.status(404).json({ error: 'Reel not found.' });
        return;
      }
      recordContentView(String(reel.ownerId), authenticatedUserId(request), 'reel', String(reel._id));
      response.json({ reel: visibleReel });
    } catch (error) {
      next(error);
    }
  });

  router.get('/users/:userId/reels', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = request.params.userId;
      if (!userId || !Types.ObjectId.isValid(userId)) {
        response.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const profileOwner = await UserModel.findOne({ _id: userId, accountStatus: 'active' })
        .select('username').lean();
      if (!profileOwner) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      const [reels, reposts] = await Promise.all([
        ReelModel.find({ ownerId: userId }).sort({ createdAt: -1 }).limit(await parsePageSize(request)).lean(),
        RepostModel.find({ userId, contentType: 'reel' }).sort({ createdAt: -1 }).limit(await parsePageSize(request)).lean(),
      ]);
      const repostedReels = reposts.length
        ? await ReelModel.find({ _id: { $in: reposts.map((repost) => repost.contentId) } }).lean()
        : [];
      const [reelPayloads, repostPayloads] = await Promise.all([
        contentListPayload(reels, authenticatedUserId(request), 'reel'),
        contentListPayload(repostedReels, authenticatedUserId(request), 'reel'),
      ]);
      const repostByContentId = new Map(reposts.map((repost) => [String(repost.contentId), repost]));
      const profile = { id: userId, username: profileOwner.username };
      const items = [
        ...reelPayloads.map((item) => ({ ...item, repostedAt: item.createdAt })),
        ...repostPayloads.flatMap((item) => {
          const repost = repostByContentId.get(item.id);
          return repost ? [{ ...item, repostedAt: repost.createdAt, repostedBy: profile, feedKey: String(repost._id) }] : [];
        }),
      ].sort((first, second) =>
        new Date(second.repostedAt || second.createdAt || 0).getTime() -
        new Date(first.repostedAt || first.createdAt || 0).getTime());
      response.json({ reels: items });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid page size.' });
        return;
      }
      next(error);
    }
  });

  router.delete('/reels/:reelId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const reelId = request.params.reelId;
      if (!reelId || !Types.ObjectId.isValid(reelId)) {
        response.status(400).json({ error: 'Invalid reel ID.' });
        return;
      }
      const reel = await ReelModel.findOneAndDelete({
        _id: reelId,
        ownerId: authenticatedUserId(request),
      });
      if (!reel) {
        response.status(404).json({ error: 'Reel not found.' });
        return;
      }
      const commentIds = await CommentModel.find({ contentId: reelId, contentType: 'reel' }).distinct('_id');
      await Promise.all([
        BookmarkModel.deleteMany({ postId: reelId, contentType: 'reel' }),
        ReelTagModel.deleteMany({ reelId }),
        LikeModel.deleteMany({ contentId: reelId, contentType: 'reel' }),
        CommentModel.deleteMany({ contentId: reelId, contentType: 'reel' }),
        CommentLikeModel.deleteMany({ commentId: { $in: commentIds } }),
        RepostModel.deleteMany({ contentId: reelId, contentType: 'reel' }),
        NotificationModel.deleteMany({ $or: [{ reelId }, { commentId: { $in: commentIds } }] }),
        synchronizeHashtagUsage(reel.hashtags ?? [], []),
      ]);
      await releaseMedia(reel.mediaId, reel._id, 'reel');
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function claimMedia(
  mediaId: string,
  ownerId: string,
  purpose: 'post' | 'story' | 'reel',
  resourceTypes: readonly string[],
  attachmentId: Types.ObjectId,
) {
  return MediaModel.findOneAndUpdate(
    {
      _id: mediaId,
      ownerId,
      purpose,
      resourceType: { $in: resourceTypes },
      status: 'ready',
      attachedTo: { $exists: false },
    },
    { $set: { attachedTo: purpose, attachedId: attachmentId } },
    { new: true },
  );
}

async function releaseMedia(
  mediaId: Types.ObjectId,
  attachmentId: Types.ObjectId,
  purpose: 'post' | 'story' | 'reel',
): Promise<void> {
  await MediaModel.updateOne(
    { _id: mediaId, attachedTo: purpose, attachedId: attachmentId },
    { $unset: { attachedTo: 1, attachedId: 1 } },
  );
}

async function contentPayload(
  content: {
    _id: unknown;
    ownerId: unknown;
    mediaId: unknown;
    caption?: string;
    hashtags?: string[];
    location?: string | null;
    altText?: string | null;
    aiDisclosure?: boolean | null;
    createdAt?: Date;
    expiresAt?: Date;
  },
  media: {
    _id: unknown;
    resourceType: string;
    secureUrl?: string | null;
    thumbnailUrl?: string | null;
    format?: string | null;
    bytes?: number | null;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
  },
) {
  const owner = await UserModel.findOne({ _id: content.ownerId, accountStatus: 'active' })
    .select('username displayName avatarUrl')
    .lean();
  return {
    id: String(content._id),
    caption: content.caption ?? '',
    hashtags: content.hashtags ?? extractHashtags(content.caption ?? ''),
    ...(content.location ? { location: content.location } : {}),
    ...(content.altText ? { altText: content.altText } : {}),
    ...(content.aiDisclosure ? { aiDisclosure: content.aiDisclosure } : {}),
    createdAt: content.createdAt,
    ...(content.expiresAt ? { expiresAt: content.expiresAt } : {}),
    owner: owner ? {
      id: String(owner._id),
      username: owner.username,
      displayName: owner.displayName,
      avatarUrl: owner.avatarUrl,
    } : null,
    media: {
      id: String(media._id),
      resourceType: media.resourceType,
      secureUrl: media.secureUrl,
      thumbnailUrl: media.thumbnailUrl,
      format: media.format,
      bytes: media.bytes,
      width: media.width,
      height: media.height,
      duration: media.duration,
    },
  };
}

async function contentListPayload(
  content: Array<{
    _id: unknown;
    ownerId: unknown;
    mediaId: unknown;
    caption?: string;
    hashtags?: string[];
    location?: string | null;
    altText?: string | null;
    aiDisclosure?: boolean | null;
    createdAt?: Date;
    expiresAt?: Date;
  }>,
  viewerId?: string,
  contentType: 'post' | 'reel' | 'story' = 'post',
) {
  if (!content.length) return [];
  const ownerIds = [...new Set(content.map((item) => String(item.ownerId)))];
  const mediaIds = [...new Set(content.map((item) => String(item.mediaId)))];
  const contentIds = content.map((item) => item._id);
  const relationFilter = contentType === 'story'
    ? { contentId: { $in: [] }, contentType }
    : { contentId: { $in: contentIds }, contentType };
  const bookmarkFilter = contentType === 'post'
    ? { $or: [{ contentType: 'post' }, { contentType: { $exists: false } }] }
    : contentType === 'reel' ? { contentType: 'reel' } : { _id: { $in: [] } };
  const [owners, media, bookmarks, likes, comments, reposts, viewerLikes, viewerReposts] = await Promise.all([
    UserModel.find({ _id: { $in: ownerIds }, accountStatus: 'active' })
      .select('username displayName avatarUrl')
      .lean(),
    MediaModel.find({ _id: { $in: mediaIds }, status: 'ready' }).lean(),
    viewerId
      ? BookmarkModel.find({
        userId: viewerId,
        postId: { $in: contentIds },
        ...bookmarkFilter,
      }).select('postId').lean()
      : Promise.resolve([]),
    contentType !== 'story'
      ? LikeModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { ...relationFilter } },
        { $group: { _id: '$contentId', count: { $sum: 1 } } },
      ])
      : Promise.resolve([]),
    contentType !== 'story'
      ? CommentModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { ...relationFilter } },
        { $group: { _id: '$contentId', count: { $sum: 1 } } },
      ])
      : Promise.resolve([]),
    contentType !== 'story'
      ? RepostModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { ...relationFilter } },
        { $group: { _id: '$contentId', count: { $sum: 1 } } },
      ])
      : Promise.resolve([]),
    viewerId && contentType !== 'story'
      ? LikeModel.find({ userId: viewerId, ...relationFilter }).select('contentId').lean()
      : Promise.resolve([]),
    viewerId && contentType !== 'story'
      ? RepostModel.find({ userId: viewerId, ...relationFilter }).select('contentId').lean()
      : Promise.resolve([]),
  ]);
  const ownerById = new Map(owners.map((owner) => [String(owner._id), owner]));
  const mediaById = new Map(media.map((item) => [String(item._id), item]));
  const savedContentIds = new Set(bookmarks.map((bookmark) => String(bookmark.postId)));
  const likeCounts = new Map(likes.map((entry) => [String(entry._id), entry.count]));
  const commentCounts = new Map(comments.map((entry) => [String(entry._id), entry.count]));
  const repostCounts = new Map(reposts.map((entry) => [String(entry._id), entry.count]));
  const likedContentIds = new Set(viewerLikes.map((like) => String(like.contentId)));
  const repostedContentIds = new Set(viewerReposts.map((repost) => String(repost.contentId)));
  return content.flatMap((item) => {
    const owner = ownerById.get(String(item.ownerId));
    const asset = mediaById.get(String(item.mediaId));
    if (!owner || !asset) return [];
    return [{
      id: String(item._id),
      caption: item.caption ?? '',
      hashtags: item.hashtags ?? extractHashtags(item.caption ?? ''),
      ...(item.location ? { location: item.location } : {}),
      ...(item.altText ? { altText: item.altText } : {}),
      ...(item.aiDisclosure ? { aiDisclosure: item.aiDisclosure } : {}),
      createdAt: item.createdAt,
      ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      owner: {
        id: String(owner._id),
        username: owner.username,
        displayName: owner.displayName,
        avatarUrl: owner.avatarUrl,
      },
      media: {
        id: String(asset._id),
        resourceType: asset.resourceType,
        secureUrl: asset.secureUrl,
        thumbnailUrl: asset.thumbnailUrl,
        format: asset.format,
        bytes: asset.bytes,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
      },
      ...(contentType !== 'story' ? {
        likeCount: likeCounts.get(String(item._id)) ?? 0,
        commentCount: commentCounts.get(String(item._id)) ?? 0,
        repostCount: repostCounts.get(String(item._id)) ?? 0,
        isLiked: likedContentIds.has(String(item._id)),
        isReposted: repostedContentIds.has(String(item._id)),
        isSaved: savedContentIds.has(String(item._id)),
      } : {}),
    }];
  });
}

function authenticatedUserId(request: Request): string {
  const userId = (request as AuthenticatedRequest).authenticatedUserId;
  if (!userId) throw new Error('Authenticated user context is missing.');
  return userId;
}

function validateHashtagCount(value: { caption?: string | undefined }, context: z.RefinementCtx): void {
  if (extractHashtags(value.caption ?? '').length > 30) {
    context.addIssue({
      code: 'custom',
      path: ['caption'],
      message: 'A post or Reel can contain at most 30 unique hashtags.',
    });
  }
}

function extractHashtags(caption: string): string[] {
  const tags = new Set<string>();
  for (const match of caption.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const tag = normalizeHashtagName(match[1] ?? '');
    if (tag) tags.add(tag);
  }
  return [...tags];
}

function normalizeHashtagName(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '').normalize('NFKC').toLocaleLowerCase('en-US');
  return /^[\p{L}\p{N}_]{1,50}$/u.test(normalized) ? normalized : null;
}

function normalizeHashtagQuery(value: string): string {
  const normalized = value.trim().replace(/^#/, '').normalize('NFKC').toLocaleLowerCase('en-US');
  return /^[\p{L}\p{N}_]{1,50}$/u.test(normalized) ? normalized : '';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseHashtagCursor(value: unknown): { createdAt: Date; id: Types.ObjectId } | null {
  if (typeof value !== 'string') return null;
  const [timestampText, idText, ...extra] = value.split('_');
  const timestamp = Number(timestampText);
  if (extra.length || !Number.isSafeInteger(timestamp) || !idText || !Types.ObjectId.isValid(idText)) {
    return null;
  }
  return { createdAt: new Date(timestamp), id: new Types.ObjectId(idText) };
}

async function synchronizeHashtagUsage(previousTags: string[], nextTags: string[]): Promise<void> {
  const previous = new Set(previousTags.map(normalizeHashtagName).filter((tag): tag is string => Boolean(tag)));
  const next = new Set(nextTags.map(normalizeHashtagName).filter((tag): tag is string => Boolean(tag)));
  const additions = [...next].filter((tag) => !previous.has(tag));
  const removals = [...previous].filter((tag) => !next.has(tag));
  await Promise.all([
    ...additions.map(async (tag) => {
      try {
        await HashtagModel.updateOne(
          { normalizedName: tag },
          {
            $setOnInsert: { name: tag, normalizedName: tag },
            $inc: { usageCount: 1 },
          },
          { upsert: true },
        );
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await HashtagModel.updateOne({ normalizedName: tag }, { $inc: { usageCount: 1 } });
      }
    }),
    ...removals.map((tag) => HashtagModel.updateOne(
      { normalizedName: tag, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    )),
  ]);
}

function validStoryId(value: string | undefined, response: Response): string | null {
  if (!value || !Types.ObjectId.isValid(value)) {
    response.status(400).json({ error: 'Invalid story ID.' });
    return null;
  }
  return value;
}

async function activeStoryVisibleTo(storyId: string, viewerId: string) {
  const story = await StoryModel.findOne({
    _id: storyId,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!story) return null;
  const activeOwner = await UserModel.exists({ _id: story.ownerId, accountStatus: 'active' });
  if (!activeOwner) return null;
  if (String(story.ownerId) === viewerId) return story;
  const followsOwner = await FollowModel.exists({
    followerId: viewerId,
    followedId: String(story.ownerId),
  });
  return followsOwner ? story : null;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

async function parsePageSize(request: Request): Promise<number> {
  return pageSizeSchema.parse(request.query.limit ?? 30);
}

function handleValidationError(
  error: unknown,
  request: Request,
  response: Response,
  config: AppConfig,
): void {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.join('.') ||
        (issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : 'value'),
      message: issue.message,
    }));
    if (config.NODE_ENV === 'development') {
      console.warn(JSON.stringify({
        event: 'content_validation_failed',
        route: `${request.method} ${request.originalUrl.split('?')[0]}`,
        fields: [...new Set(details.map((issue) => issue.field))],
      }));
    }
    response.status(400).json({
      error: 'Invalid content request.',
      details,
      requestId: response.locals.requestId,
    });
  }
}
