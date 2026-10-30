import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { StoryModel } from '../content/story.model';
import { FollowModel } from '../users/follow.model';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { ConversationModel } from './conversation.model';
import { MessageModel } from './message.model';
import { createNotificationSafely } from '../notifications/notification.service';
import {
  emitToConversation,
  emitToUser,
  emitUnreadCount,
} from './realtime';

const createConversationSchema = z.object({ participantId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
const createMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  clientMessageId: z.string().min(8).max(100).optional(),
}).strict();
const storyReplySchema = z.object({
  text: z.string().trim().min(1).max(1000),
  clientMessageId: z.string().min(8).max(100),
}).strict();
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(30);

export function createMessageRouter(config: AppConfig): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);
  const messageSendLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (request) =>
      (request as AuthenticatedRequest).authenticatedUserId ?? 'unauthenticated',
    message: { error: 'You are sending messages too quickly. Please wait and try again.' },
  });

  router.get('/conversations', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = authenticatedUserId(request);
      const conversations = await ConversationModel.find({ participants: userId })
        .sort({ lastMessageAt: -1 })
        .limit(50)
        .lean();
      const otherIds = conversations
        .map((conversation) => conversation.participants.find((id) => String(id) !== userId))
        .filter((id): id is Types.ObjectId => id !== undefined);
      const users = await UserModel.find({ _id: { $in: otherIds }, accountStatus: 'active' })
        .select('username displayName avatarUrl')
        .lean();
      const userById = new Map(users.map((user) => [String(user._id), user]));
      const lastMessages = await MessageModel.aggregate([
        { $match: { conversationId: { $in: conversations.map((item) => item._id) } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$conversationId', text: { $first: '$text' }, createdAt: { $first: '$createdAt' } } },
      ]);
      const messageByConversation = new Map(lastMessages.map((message) => [String(message._id), message]));
      response.json({
        conversations: conversations.map((conversation) => {
          const otherId = conversation.participants.find((id) => String(id) !== userId);
          return {
            id: String(conversation._id),
            participant: otherId ? userById.get(String(otherId)) ?? null : null,
            lastMessage: conversation.lastMessage
              ? serializeMessagePreview(conversation.lastMessage)
              : messageByConversation.get(String(conversation._id)) ?? null,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount: readUnreadCount(conversation.unreadCounts, userId),
          };
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/conversations', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { participantId: requestedParticipantId } = createConversationSchema.parse(request.body);
      const participantId = requestedParticipantId.toLowerCase();
      const userId = authenticatedUserId(request);
      if (participantId === userId) {
        response.status(400).json({ error: 'You cannot start a conversation with yourself.' });
        return;
      }
      const participant = await UserModel.findOne({ _id: participantId, accountStatus: 'active' }).select('_id');
      if (!participant) {
        response.status(404).json({ error: 'User not found.' });
        return;
      }
      const participantPair = [userId, participantId].sort().join(':');
      let conversation = await ConversationModel.findOne({ participantPair });
      let created = false;
      if (!conversation) {
        try {
          conversation = await ConversationModel.create({
            participantPair,
            participants: [userId, participantId],
          });
          created = true;
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          conversation = await ConversationModel.findOne({ participantPair });
        }
      }
      if (!conversation) {
        throw new Error('Conversation could not be created.');
      }
      if (created) {
        emitToUser(userId, 'conversation:created', {
          id: String(conversation._id),
          participantId,
        });
        emitToUser(participantId, 'conversation:created', {
          id: String(conversation._id),
          participantId: userId,
        });
      }
      response.status(200).json({ conversation: { id: String(conversation._id), participantId } });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid conversation request.' });
        return;
      }
      next(error);
    }
  });

  router.post('/stories/:storyId/reply', authenticate, messageSendLimit, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { storyId } = request.params;
      if (!storyId || !Types.ObjectId.isValid(storyId)) {
        response.status(400).json({ error: 'Invalid story ID.' });
        return;
      }
      const { text, clientMessageId } = storyReplySchema.parse(request.body);
      const senderId = authenticatedUserId(request);
      const story = await StoryModel.findOne({
        _id: storyId,
        expiresAt: { $gt: new Date() },
      }).select('_id ownerId').lean();
      if (!story) {
        response.status(404).json({ error: 'Story not found.' });
        return;
      }
      const recipientId = String(story.ownerId);
      if (senderId === recipientId) {
        response.status(400).json({ error: 'You cannot reply to your own story.' });
        return;
      }
      const [recipient, followsOwner] = await Promise.all([
        UserModel.findOne({ _id: recipientId, accountStatus: 'active' }).select('_id'),
        FollowModel.exists({ followerId: senderId, followedId: recipientId }),
      ]);
      if (!recipient || !followsOwner) {
        response.status(404).json({ error: 'Story owner is not available for replies.' });
        return;
      }
      const participantPair = [senderId, recipientId].sort().join(':');
      let conversation = await ConversationModel.findOne({ participantPair });
      if (!conversation) {
        try {
          conversation = await ConversationModel.create({
            participantPair,
            participants: [senderId, recipientId],
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          conversation = await ConversationModel.findOne({ participantPair });
        }
      }
      if (!conversation) throw new Error('Story reply conversation could not be created.');

      const session = await mongoose.startSession();
      let savedMessage: InstanceType<typeof MessageModel> | undefined;
      let duplicate = false;
      try {
        await session.withTransaction(async () => {
          const existing = await MessageModel.findOne({
            conversationId: conversation?._id,
            senderId,
            clientMessageId,
          }).session(session);
          if (existing) {
            savedMessage = existing;
            duplicate = true;
            return;
          }
          const [message] = await MessageModel.create([{
            conversationId: conversation?._id,
            senderId,
            text,
            clientMessageId,
            storyId: story._id,
          }], { session });
          if (!message) throw new Error('Story reply could not be saved.');
          await ConversationModel.updateOne(
            { _id: conversation?._id, participants: senderId },
            {
              $set: {
                lastMessageAt: message.createdAt,
                lastMessage: {
                  id: message._id,
                  text: message.text,
                  senderId: message.senderId,
                  createdAt: message.createdAt,
                },
              },
              $inc: { [`unreadCounts.${recipientId}`]: 1 },
            },
            { session },
          );
          savedMessage = message;
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        savedMessage = (await MessageModel.findOne({ conversationId: conversation._id, senderId, clientMessageId })) ?? undefined;
        duplicate = true;
        if (!savedMessage) throw error;
      } finally {
        await session.endSession();
      }
      if (!savedMessage) throw new Error('Story reply transaction completed without a saved message.');
      if (!duplicate) {
        await createNotificationSafely({
          recipientId,
          actorId: senderId,
          type: 'message',
          conversationId: String(conversation._id),
          deduplicationKey: `message:${savedMessage._id}`,
        });
      }
      const eventMessage = { conversationId: String(conversation._id), message: serializeMessage(savedMessage) };
      emitToUser(senderId, 'message:sent', eventMessage);
      emitToUser(recipientId, 'message:new', eventMessage);
      emitToConversation(conversation.participants, 'conversation:updated', { id: String(conversation._id) });
      emitUnreadCount(recipientId, await totalUnreadCount(recipientId));
      response.status(duplicate ? 200 : 201).json({
        message: serializeMessage(savedMessage),
        conversationId: String(conversation._id),
        sent: true,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid story reply.' });
        return;
      }
      next(error);
    }
  });

  router.get('/conversations/:conversationId/messages', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { conversationId } = request.params;
      if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
        response.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }
      const userId = authenticatedUserId(request);
      const conversation = await ConversationModel.findOne({ _id: conversationId, participants: userId }).select('_id');
      if (!conversation) {
        response.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      const limit = pageSizeSchema.parse(request.query.limit ?? 30);
      const before = typeof request.query.before === 'string' ? request.query.before : null;
      if (before && !Types.ObjectId.isValid(before)) {
        response.status(400).json({ error: 'Invalid pagination cursor.' });
        return;
      }
      const messages = await MessageModel.find({
        conversationId,
        ...(before ? { _id: { $lt: new Types.ObjectId(before) } } : {}),
      })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean();
      const hasMore = messages.length > limit;
      if (hasMore) messages.pop();
      const chronological = messages.reverse();
      response.json({
        messages: chronological.map((message) => serializeMessage(message)),
        hasMore,
        nextCursor: hasMore && chronological[0] ? String(chronological[0]._id) : null,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid pagination limit.' });
        return;
      }
      next(error);
    }
  });

  router.post('/conversations/:conversationId/messages', authenticate, messageSendLimit, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { conversationId } = request.params;
      if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
        response.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }
      const { text, clientMessageId } = createMessageSchema.parse(request.body);
      const userId = authenticatedUserId(request);
      const conversation = await ConversationModel.findOne({ _id: conversationId, participants: userId });
      if (!conversation) {
        response.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      const session = await mongoose.startSession();
      let savedMessage: InstanceType<typeof MessageModel> | undefined;
      let duplicate = false;
      try {
        await session.withTransaction(async () => {
          const currentConversation = await ConversationModel.findOne({
            _id: conversationId,
            participants: userId,
          }).session(session);
          if (!currentConversation) throw new Error('Conversation is no longer available.');
          if (clientMessageId) {
            const existing = await MessageModel.findOne({
              conversationId,
              senderId: userId,
              clientMessageId,
            }).session(session);
            if (existing) {
              savedMessage = existing;
              duplicate = true;
              return;
            }
          }
          const [message] = await MessageModel.create([{
            conversationId,
            senderId: userId,
            text,
            ...(clientMessageId ? { clientMessageId } : {}),
          }], { session });
          if (!message) throw new Error('Message could not be saved.');
          await ConversationModel.updateOne(
            { _id: conversationId, participants: userId },
            {
              $set: {
                lastMessageAt: message.createdAt,
                lastMessage: {
                  id: message._id,
                  text: message.text,
                  senderId: message.senderId,
                  createdAt: message.createdAt,
                },
              },
              ...(String(currentConversation.participants.find((id) => String(id) !== userId))
                ? { $inc: { [`unreadCounts.${String(currentConversation.participants.find((id) => String(id) !== userId))}`]: 1 } }
                : {}),
            },
            { session },
          );
          savedMessage = message;
        });
      } catch (error) {
        if (!clientMessageId || !isDuplicateKeyError(error)) throw error;
        const duplicateMessage = await MessageModel.findOne({
          conversationId,
          senderId: userId,
          clientMessageId,
        });
        savedMessage = duplicateMessage ?? undefined;
        duplicate = true;
        if (!savedMessage) throw error;
      } finally {
        await session.endSession();
      }
      const message = savedMessage;
      if (!message) throw new Error('Message transaction completed without a saved message.');
      const recipientId = conversation.participants.find((participantId) => String(participantId) !== userId);
      if (recipientId) {
        if (!duplicate) {
          await createNotificationSafely({
            recipientId: String(recipientId),
            actorId: userId,
            type: 'message',
            conversationId,
            deduplicationKey: `message:${message._id}`,
          });
        }
        const eventMessage = {
          conversationId,
          message: serializeMessage(message),
        };
        emitToUser(userId, 'message:sent', eventMessage);
        emitToUser(String(recipientId), 'message:new', eventMessage);
        emitToConversation(conversation.participants, 'conversation:updated', { id: conversationId });
        emitUnreadCount(String(recipientId), await totalUnreadCount(String(recipientId)));
      }
      response.status(duplicate ? 200 : 201).json({
        message: serializeMessage(message),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid message.' });
        return;
      }
      next(error);
    }
  });

  router.patch('/conversations/:conversationId/read', authenticate, async (request, response, next) => {
    try {
      const { conversationId } = request.params;
      if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
        response.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }
      const userId = authenticatedUserId(request);
      const conversation = await ConversationModel.findOne({ _id: conversationId, participants: userId });
      if (!conversation) {
        response.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      const session = await mongoose.startSession();
      const readAt = new Date();
      let unreadMessages: Array<{ _id: Types.ObjectId; senderId: Types.ObjectId }> = [];
      let conversationAvailable = false;
      try {
        await session.withTransaction(async () => {
          const currentConversation = await ConversationModel.findOne({
            _id: conversationId,
            participants: userId,
          }).session(session);
          if (!currentConversation) return;
          conversationAvailable = true;
          unreadMessages = await MessageModel.find({
            conversationId,
            senderId: { $ne: userId },
            readAt: null,
          }).select('_id senderId').session(session).lean();
          await MessageModel.updateMany(
            { conversationId, senderId: { $ne: userId }, readAt: null },
            { $set: { readAt } },
            { session },
          );
          await ConversationModel.updateOne(
            { _id: conversationId, participants: userId },
            { $set: { [`unreadCounts.${userId}`]: 0 } },
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      if (!conversationAvailable) {
        response.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      const readMessagesBySender = new Map<string, string[]>();
      for (const message of unreadMessages) {
        const senderId = String(message.senderId);
        const messageIds = readMessagesBySender.get(senderId) ?? [];
        messageIds.push(String(message._id));
        readMessagesBySender.set(senderId, messageIds);
      }
      const messageIdBatchSize = 500;
      for (const [senderId, messageIds] of readMessagesBySender) {
        for (let offset = 0; offset < messageIds.length; offset += messageIdBatchSize) {
          emitToConversation([senderId], 'message:read', {
            conversationId,
            readerId: userId,
            messageIds: messageIds.slice(offset, offset + messageIdBatchSize),
            readAt: readAt.toISOString(),
          });
        }
      }
      emitUnreadCount(userId, await totalUnreadCount(userId));
      response.json({ readCount: unreadMessages.length, readAt: readAt.toISOString() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/messages/unread-count', authenticate, async (request, response, next) => {
    try {
      const userId = authenticatedUserId(request);
      const conversations = await ConversationModel.find({ participants: userId }).select('unreadCounts').lean();
      response.json({
        unreadCount: conversations.reduce(
          (total, conversation) => total + readUnreadCount(conversation.unreadCounts, userId),
          0,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function authenticatedUserId(request: Request): string {
  const userId = (request as AuthenticatedRequest).authenticatedUserId;
  if (!userId) throw new Error('Authenticated user context is missing.');
  return userId;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

function serializeMessage(message: {
  _id: unknown;
  conversationId?: unknown;
  senderId: unknown;
  text: string;
  clientMessageId?: string | null;
  storyId?: unknown;
  createdAt: Date;
  deliveredAt?: Date | null;
  readAt?: Date | null;
}) {
  return {
    id: String(message._id),
    ...(message.conversationId ? { conversationId: String(message.conversationId) } : {}),
    senderId: String(message.senderId),
    text: message.text,
    ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
    ...(message.storyId ? { storyId: String(message.storyId) } : {}),
    createdAt: message.createdAt,
    deliveredAt: message.deliveredAt ?? null,
    readAt: message.readAt ?? null,
  };
}

function serializeMessagePreview(message: {
  id?: unknown;
  text?: string | null;
  senderId?: unknown;
  createdAt?: Date | null;
}) {
  return {
    id: message.id ? String(message.id) : undefined,
    text: message.text ?? '',
    senderId: message.senderId ? String(message.senderId) : undefined,
    createdAt: message.createdAt,
  };
}

function readUnreadCount(unreadCounts: unknown, userId: string): number {
  if (unreadCounts instanceof Map) return Number(unreadCounts.get(userId) ?? 0);
  if (typeof unreadCounts === 'object' && unreadCounts !== null && userId in unreadCounts) {
    const count = Number((unreadCounts as Record<string, unknown>)[userId]);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
  }
  return 0;
}

async function totalUnreadCount(userId: string): Promise<number> {
  const conversations = await ConversationModel.find({ participants: userId }).select('unreadCounts').lean();
  return conversations.reduce(
    (total, conversation) => total + readUnreadCount(conversation.unreadCounts, userId),
    0,
  );
}
