import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { FollowModel } from '../users/follow.model';
import { MediaModel } from '../media/media.model';
import { PostModel } from './post.model';
import { ReelModel } from './reel.model';
import { StoryModel } from './story.model';
import { BookmarkModel } from './bookmark.model';
import { PostTagModel } from './post-tag.model';
import { createNotificationSafely } from '../notifications/notification.service';
import { NotificationModel } from '../notifications/notification.model';

const publishSchema = z.object({
  mediaId: z.string().regex(/^[a-f\d]{24}$/i),
  caption: z.string().trim().max(2200).default(''),
}).strict();
const addTagSchema = z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

const storySchema = z.object({
  mediaId: z.string().regex(/^[a-f\d]{24}$/i),
  caption: z.string().trim().max(500).default(''),
}).strict();

const pageSizeSchema = z.coerce.number().int().min(1).max(50).default(30);
const storyLifetimeMs = 24 * 60 * 60 * 1000;

export function createContentRouter(config: AppConfig): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);

  router.post('/posts', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { mediaId, caption } = publishSchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      const postId = new Types.ObjectId();
      const media = await claimMedia(mediaId, ownerId, 'post', ['image', 'video'], postId);
      if (!media) {
        response.status(409).json({ error: 'Choose a verified post upload owned by your account.' });
        return;
      }
      try {
        const post = await PostModel.create({ _id: postId, ownerId, mediaId: media._id, caption });
        response.status(201).json({
          post: { ...await contentPayload(post, media), isSaved: false },
        });
      } catch (error) {
        await releaseMedia(media._id, postId, 'post');
        throw error;
      }
    } catch (error) {
      handleValidationError(error, response);
      if (!(error instanceof ZodError)) next(error);
    }
  });

  router.get('/posts', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const limit = pageSizeSchema.parse(request.query.limit ?? 30);
      const posts = await PostModel.find().sort({ createdAt: -1 }).limit(limit).lean();
      response.json({ posts: await contentListPayload(posts, authenticatedUserId(request)) });
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
      const [visiblePost] = post ? await contentListPayload([post], authenticatedUserId(request)) : [];
      if (!visiblePost) {
        response.status(404).json({ error: 'Post not found.' });
        return;
      }
      response.json({ post: visiblePost });
    } catch (error) {
      next(error);
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
        { userId: authenticatedUserId(request), postId },
        { $setOnInsert: { userId: authenticatedUserId(request), postId } },
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
      await BookmarkModel.deleteOne({ userId: authenticatedUserId(request), postId });
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
      const bookmarks = await BookmarkModel.find({
        userId: authenticatedUserId(request),
        ...(after ? { _id: { $lt: after } } : {}),
      }).sort({ _id: -1 }).limit(limit + 1).lean();
      const hasMore = bookmarks.length > limit;
      const page = hasMore ? bookmarks.slice(0, limit) : bookmarks;
      const foundPosts = await PostModel.find({ _id: { $in: page.map((item) => item.postId) } }).lean();
      const postById = new Map(foundPosts.map((post) => [String(post._id), post]));
      const posts = page.flatMap((bookmark) => {
        const post = postById.get(String(bookmark.postId));
        return post ? [post] : [];
      });
      response.json({
        posts: await contentListPayload(posts, authenticatedUserId(request)),
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
      const tags = await PostTagModel.find({
        userId: taggedUser._id,
        ...(after ? { _id: { $lt: after } } : {}),
      }).sort({ _id: -1 }).limit(limit + 1).lean();
      const hasMore = tags.length > limit;
      const page = hasMore ? tags.slice(0, limit) : tags;
      const foundPosts = await PostModel.find({ _id: { $in: page.map((tag) => tag.postId) } }).lean();
      const postById = new Map(foundPosts.map((post) => [String(post._id), post]));
      const posts = page.flatMap((tag) => {
        const post = postById.get(String(tag.postId));
        return post ? [post] : [];
      });
      response.json({
        posts: await contentListPayload(posts, authenticatedUserId(request)),
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

  router.get('/users/:userId/posts', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = request.params.userId;
      if (!userId || !Types.ObjectId.isValid(userId)) {
        response.status(400).json({ error: 'Invalid user ID.' });
        return;
      }
      const exists = await UserModel.exists({ _id: userId, accountStatus: 'active' });
      if (!exists) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      const posts = await PostModel.find({ ownerId: userId })
        .sort({ createdAt: -1 })
        .limit(await parsePageSize(request))
        .lean();
      response.json({ posts: await contentListPayload(posts, authenticatedUserId(request)) });
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
      await Promise.all([
        BookmarkModel.deleteMany({ postId }),
        PostTagModel.deleteMany({ postId }),
        NotificationModel.deleteMany({ postId }),
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
      handleValidationError(error, response);
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
      response.json({ stories: await contentListPayload(stories) });
    } catch (error) {
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
      await releaseMedia(story.mediaId, story._id, 'story');
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/reels', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { mediaId, caption } = publishSchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      const reelId = new Types.ObjectId();
      const media = await claimMedia(mediaId, ownerId, 'reel', ['video'], reelId);
      if (!media || !media.duration || media.duration > 180) {
        if (media) await releaseMedia(media._id, reelId, 'reel');
        response.status(409).json({ error: 'Choose a verified video no longer than 180 seconds.' });
        return;
      }
      try {
        const reel = await ReelModel.create({ _id: reelId, ownerId, mediaId: media._id, caption });
        response.status(201).json({ reel: await contentPayload(reel, media) });
      } catch (error) {
        await releaseMedia(media._id, reelId, 'reel');
        throw error;
      }
    } catch (error) {
      handleValidationError(error, response);
      if (!(error instanceof ZodError)) next(error);
    }
  });

  router.get('/reels', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const limit = pageSizeSchema.parse(request.query.limit ?? 30);
      const reels = await ReelModel.find().sort({ createdAt: -1 }).limit(limit).lean();
      response.json({ reels: await contentListPayload(reels) });
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
      const [visibleReel] = reel ? await contentListPayload([reel]) : [];
      if (!visibleReel) {
        response.status(404).json({ error: 'Reel not found.' });
        return;
      }
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
      const reels = await ReelModel.find({ ownerId: userId })
        .sort({ createdAt: -1 })
        .limit(await parsePageSize(request))
        .lean();
      response.json({ reels: await contentListPayload(reels) });
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
    createdAt?: Date;
    expiresAt?: Date;
  }>,
  viewerId?: string,
) {
  if (!content.length) return [];
  const ownerIds = [...new Set(content.map((item) => String(item.ownerId)))];
  const mediaIds = [...new Set(content.map((item) => String(item.mediaId)))];
  const [owners, media, bookmarks] = await Promise.all([
    UserModel.find({ _id: { $in: ownerIds }, accountStatus: 'active' })
      .select('username displayName avatarUrl')
      .lean(),
    MediaModel.find({ _id: { $in: mediaIds }, status: 'ready' }).lean(),
    viewerId
      ? BookmarkModel.find({ userId: viewerId, postId: { $in: content.map((item) => item._id) } }).select('postId').lean()
      : Promise.resolve([]),
  ]);
  const ownerById = new Map(owners.map((owner) => [String(owner._id), owner]));
  const mediaById = new Map(media.map((item) => [String(item._id), item]));
  const savedPostIds = new Set(bookmarks.map((bookmark) => String(bookmark.postId)));
  return content.flatMap((item) => {
    const owner = ownerById.get(String(item.ownerId));
    const asset = mediaById.get(String(item.mediaId));
    if (!owner || !asset) return [];
    return [{
      id: String(item._id),
      caption: item.caption ?? '',
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
      isSaved: savedPostIds.has(String(item._id)),
    }];
  });
}

function authenticatedUserId(request: Request): string {
  const userId = (request as AuthenticatedRequest).authenticatedUserId;
  if (!userId) throw new Error('Authenticated user context is missing.');
  return userId;
}

async function parsePageSize(request: Request): Promise<number> {
  return pageSizeSchema.parse(request.query.limit ?? 30);
}

function handleValidationError(error: unknown, response: Response): void {
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Invalid content request.' });
  }
}
