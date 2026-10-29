import assert from 'node:assert/strict';
import test from 'node:test';
import { Types } from 'mongoose';
import { MessageModel } from './message.model';
import { ConversationModel } from './conversation.model';

test('message schema validates persisted text and idempotency metadata', async () => {
  const message = new MessageModel({
    conversationId: new Types.ObjectId(),
    senderId: new Types.ObjectId(),
    text: 'Hello',
    clientMessageId: 'client-message-id-1',
  });

  await message.validate();
  assert.equal(message.text, 'Hello');
  assert.equal(message.deliveredAt, null);
  assert.equal(message.readAt, null);
});

test('message idempotency and cursor indexes and canonical conversation uniqueness are defined', () => {
  const messageIndexes = MessageModel.schema.indexes();
  const conversationIndexes = ConversationModel.schema.indexes();

  assert.ok(messageIndexes.some(([keys]) =>
    keys.conversationId === 1 && keys.createdAt === -1));
  assert.ok(messageIndexes.some(([keys]) =>
    keys.conversationId === 1 && keys._id === -1));
  assert.ok(messageIndexes.some(([keys, options]) =>
    keys.conversationId === 1 && keys.senderId === 1 &&
    keys.clientMessageId === 1 && options?.unique === true));
  assert.ok(conversationIndexes.some(([keys, options]) =>
    keys.participantPair === 1 && options?.unique === true));
});
