import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommentLikeModel,
  CommentModel,
  LikeModel,
  RepostModel,
} from './engagement.models';

function hasUniqueIndex(indexes: ReturnType<typeof LikeModel.schema.indexes>, fields: string[]) {
  return indexes.some(([keys, options]) =>
    fields.every((field) => keys[field] === 1) && options.unique === true,
  );
}

test('likes, comment likes, and reposts have unique actor-content indexes', () => {
  assert.equal(hasUniqueIndex(LikeModel.schema.indexes(), ['userId', 'contentType', 'contentId']), true);
  assert.equal(hasUniqueIndex(CommentLikeModel.schema.indexes(), ['userId', 'commentId']), true);
  assert.equal(hasUniqueIndex(RepostModel.schema.indexes(), ['userId', 'contentType', 'contentId']), true);
});

test('comments constrain content type, text length, and thread pagination', () => {
  assert.deepEqual(CommentModel.schema.path('contentType').options.enum, ['post', 'reel']);
  assert.equal(CommentModel.schema.path('text').options.maxlength, 2200);
  assert.ok(CommentModel.schema.indexes().some(([keys]) =>
    keys.contentType === 1 &&
    keys.contentId === 1 &&
    keys.parentCommentId === 1 &&
    keys.createdAt === 1 &&
    keys._id === 1,
  ));
});
