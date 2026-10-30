import assert from 'node:assert/strict';
import test from 'node:test';
import { BookmarkModel } from './bookmark.model';
import { PostTagModel } from './post-tag.model';
import { ReelTagModel } from './reel-tag.model';
import { NotificationModel } from '../notifications/notification.model';
import { PostModel } from './post.model';
import { ReelModel } from './reel.model';
import { StoryModel } from './story.model';
import { StoryLikeModel, StoryReactionModel, StoryReportModel, StoryViewModel } from './story-engagement.models';

test('bookmark and tag relationships enforce uniqueness and owner pagination indexes', () => {
  const bookmarkIndexes = BookmarkModel.schema.indexes();
  const tagIndexes = PostTagModel.schema.indexes();
  const reelTagIndexes = ReelTagModel.schema.indexes();

  assert.ok(bookmarkIndexes.some(([fields, options]) =>
    fields.userId === 1 && fields.contentType === 1 && fields.postId === 1 && options.unique === true));
  assert.ok(bookmarkIndexes.some(([fields]) => fields.userId === 1 && fields._id === -1));
  assert.ok(tagIndexes.some(([fields, options]) =>
    fields.postId === 1 && fields.userId === 1 && options.unique === true));
  assert.ok(reelTagIndexes.some(([fields, options]) =>
    fields.reelId === 1 && fields.userId === 1 && options.unique === true));
  assert.ok(tagIndexes.some(([fields]) => fields.userId === 1 && fields._id === -1));
});

test('notifications have deduplication and recipient unread-feed indexes', () => {
  const indexes = NotificationModel.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.deduplicationKey === 1 && options.unique === true && options.sparse === true));
  assert.ok(indexes.some(([fields]) =>
    fields.recipientId === 1 && fields.readAt === 1 && fields.createdAt === -1));
});

test('story engagement models enforce unique relationships and viewer pagination', () => {
  const viewIndexes = StoryViewModel.schema.indexes();
  const likeIndexes = StoryLikeModel.schema.indexes();
  const reactionIndexes = StoryReactionModel.schema.indexes();
  const reportIndexes = StoryReportModel.schema.indexes();
  assert.ok(viewIndexes.some(([fields, options]) =>
    fields.storyId === 1 && fields.viewerId === 1 && options.unique === true));
  assert.ok(viewIndexes.some(([fields]) => fields.storyId === 1 && fields._id === -1));
  assert.ok(likeIndexes.some(([fields, options]) =>
    fields.storyId === 1 && fields.userId === 1 && options.unique === true));
  assert.ok(reactionIndexes.some(([fields, options]) =>
    fields.storyId === 1 && fields.senderId === 1 && fields.emoji === 1 && options.unique === true));
  assert.ok(reportIndexes.some(([fields, options]) =>
    fields.storyId === 1 && fields.reporterId === 1 && options.unique === true));
});

test('published content models validate and preserve composer metadata', () => {
  const ownerId = '507f1f77bcf86cd799439011';
  const mediaId = '507f1f77bcf86cd799439012';
  const post = new PostModel({
    ownerId,
    mediaId,
    caption: 'A real moment',
    location: 'Lisbon',
    altText: 'Friends at the coast',
  });
  const reel = new ReelModel({
    ownerId,
    mediaId,
    caption: 'A short video',
    location: 'Studio',
    aiDisclosure: true,
  });
  const story = new StoryModel({
    ownerId,
    mediaId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  assert.equal(post.validateSync(), undefined);
  assert.equal(post.altText, 'Friends at the coast');
  assert.equal(post.location, 'Lisbon');
  assert.equal(reel.validateSync(), undefined);
  assert.equal(reel.aiDisclosure, true);
  assert.equal(reel.location, 'Studio');
  assert.equal(story.validateSync(), undefined);
});
