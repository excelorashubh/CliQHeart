import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { ConversationModel } from './conversation.model';
import { MessageModel } from './message.model';

const createConversationSchema = z.object({ participantId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
const createMessageSchema = z.object({ text: z.string().trim().min(1).max(4000) }).strict();
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(30);

export function createMessageRouter(config: AppConfig): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);

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
            lastMessage: messageByConversation.get(String(conversation._id)) ?? null,
            lastMessageAt: conversation.lastMessageAt,
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
      if (!conversation) {
        try {
          conversation = await ConversationModel.create({
            participantPair,
            participants: [userId, participantId],
          });
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          conversation = await ConversationModel.findOne({ participantPair });
        }
      }
      if (!conversation) {
        throw new Error('Conversation could not be created.');
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
      const before = typeof request.query.before === 'string' ? new Date(request.query.before) : null;
      if (before && Number.isNaN(before.getTime())) {
        response.status(400).json({ error: 'Invalid pagination cursor.' });
        return;
      }
      const messages = await MessageModel.find({
        conversationId,
        ...(before ? { createdAt: { $lt: before } } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      response.json({
        messages: messages.reverse().map((message) => ({
          id: String(message._id),
          senderId: String(message.senderId),
          text: message.text,
          createdAt: message.createdAt,
        })),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid pagination limit.' });
        return;
      }
      next(error);
    }
  });

  router.post('/conversations/:conversationId/messages', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { conversationId } = request.params;
      if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
        response.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }
      const { text } = createMessageSchema.parse(request.body);
      const userId = authenticatedUserId(request);
      const conversation = await ConversationModel.findOne({ _id: conversationId, participants: userId });
      if (!conversation) {
        response.status(404).json({ error: 'Conversation not found.' });
        return;
      }
      const message = await MessageModel.create({ conversationId, senderId: userId, text });
      conversation.lastMessageAt = message.createdAt;
      await conversation.save();
      response.status(201).json({
        message: {
          id: String(message._id),
          senderId: userId,
          text: message.text,
          createdAt: message.createdAt,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid message.' });
        return;
      }
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
