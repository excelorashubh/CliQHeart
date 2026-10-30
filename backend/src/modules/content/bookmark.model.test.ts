import assert from 'node:assert/strict';
import test from 'node:test';
import { BookmarkModel } from './bookmark.model';

test('bookmark uniqueness distinguishes posts from Reels and indexes owner pages', () => {
  const indexes = BookmarkModel.schema.indexes();

  assert.ok(indexes.some(([keys, options]) =>
    keys.userId === 1 &&
    keys.contentType === 1 &&
    keys.postId === 1 &&
    options.unique === true,
  ));
  assert.ok(indexes.some(([keys]) =>
    keys.userId === 1 &&
    keys.contentType === 1 &&
    keys._id === -1,
  ));
});
