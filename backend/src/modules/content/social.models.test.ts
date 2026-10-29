import assert from 'node:assert/strict';
import test from 'node:test';
import { BookmarkModel } from './bookmark.model';
import { PostTagModel } from './post-tag.model';
import { NotificationModel } from '../notifications/notification.model';

test('bookmark and tag relationships enforce uniqueness and owner pagination indexes', () => {
  const bookmarkIndexes = BookmarkModel.schema.indexes();
  const tagIndexes = PostTagModel.schema.indexes();

  assert.ok(bookmarkIndexes.some(([fields, options]) =>
    fields.userId === 1 && fields.postId === 1 && options.unique === true));
  assert.ok(bookmarkIndexes.some(([fields]) => fields.userId === 1 && fields._id === -1));
  assert.ok(tagIndexes.some(([fields, options]) =>
    fields.postId === 1 && fields.userId === 1 && options.unique === true));
  assert.ok(tagIndexes.some(([fields]) => fields.userId === 1 && fields._id === -1));
});

test('notifications have deduplication and recipient unread-feed indexes', () => {
  const indexes = NotificationModel.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.deduplicationKey === 1 && options.unique === true && options.sparse === true));
  assert.ok(indexes.some(([fields]) =>
    fields.recipientId === 1 && fields.readAt === 1 && fields.createdAt === -1));
});
