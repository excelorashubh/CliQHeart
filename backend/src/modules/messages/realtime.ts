import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import * as jwt from 'jsonwebtoken';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { SessionModel } from '../auth/session.model';
import { ConversationModel } from './conversation.model';
import { MessageModel } from './message.model';

type ClientToServerEvents = {
  'conversation:join': (conversationId: string, acknowledge?: (joined: boolean) => void) => void;
  'conversation:leave': (conversationId: string) => void;
  'typing:start': (conversationId: string) => void;
  'typing:stop': (conversationId: string) => void;
  'message:delivered': (payload: { conversationId: string; messageId: string }) => void;
};

type ServerToClientEvents = {
  'conversation:created': (payload: { id: string; participantId: string }) => void;
  'conversation:updated': (payload: { id: string }) => void;
  'message:new': (payload: Record<string, unknown>) => void;
  'message:sent': (payload: Record<string, unknown>) => void;
  'message:delivered': (payload: { conversationId: string; messageId: string; deliveredAt: string }) => void;
  'message:read': (payload: { conversationId: string; readerId: string; messageIds: string[]; readAt: string }) => void;
  'typing:start': (payload: { conversationId: string; userId: string }) => void;
  'typing:stop': (payload: { conversationId: string; userId: string }) => void;
  'unread:update': (payload: { count: number }) => void;
};

type ServerEventPayloads = {
  'conversation:created': { id: string; participantId: string };
  'conversation:updated': { id: string };
  'message:new': Record<string, unknown>;
  'message:sent': Record<string, unknown>;
  'message:delivered': { conversationId: string; messageId: string; deliveredAt: string };
  'message:read': { conversationId: string; readerId: string; messageIds: string[]; readAt: string };
  'typing:start': { conversationId: string; userId: string };
  'typing:stop': { conversationId: string; userId: string };
  'unread:update': { count: number };
};

type SocketData = {
  userId: string;
  sessionId?: string;
  authExpiresAt?: number;
  joinedConversations: Set<string>;
  lastTypingAt: Map<string, number>;
};

type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let realtimeServer: ChatServer | undefined;
let redisClients: Array<ReturnType<typeof createClient>> = [];

export async function attachRealtimeServer(server: HttpServer, config: AppConfig): Promise<ChatServer> {
  const io: ChatServer = new Server(server, {
    cors: { origin: config.CORS_ORIGINS, credentials: true, methods: ['GET', 'POST'] },
    transports: ['websocket'],
  });

  if (config.REDIS_URL) {
    const publisher = createClient({ url: config.REDIS_URL });
    const subscriber = publisher.duplicate();
    publisher.on('error', (error) => logRealtimeFailure('redis_publisher_error', error));
    subscriber.on('error', (error) => logRealtimeFailure('redis_subscriber_error', error));
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
    redisClients = [publisher, subscriber];
  }

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (typeof token !== 'string' || !config.JWT_ACCESS_SECRET) {
        next(new Error('Authentication required.'));
        return;
      }
      const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      });
      if (typeof payload === 'string' || payload.tokenType !== 'access' ||
          typeof payload.sub !== 'string' || !/^[a-f\d]{24}$/i.test(payload.sub)) {
        next(new Error('Authentication required.'));
        return;
      }
      if (payload.sid !== undefined) {
        if (typeof payload.sid !== 'string' || !/^[a-f\d]{24}$/i.test(payload.sid) ||
            !await SessionModel.exists({
              _id: payload.sid,
              userId: payload.sub,
              revokedAt: null,
              expiresAt: { $gt: new Date() },
            })) {
          next(new Error('Authentication required.'));
          return;
        }
      }
      const userExists = await UserModel.exists({ _id: payload.sub, accountStatus: 'active' });
      if (!userExists) {
        next(new Error('Authentication required.'));
        return;
      }
      socket.data.userId = payload.sub;
      if (typeof payload.sid === 'string') socket.data.sessionId = payload.sid;
      socket.data.joinedConversations = new Set();
      socket.data.lastTypingAt = new Map();
      const expiryMs = typeof payload.exp === 'number' ? payload.exp * 1000 - Date.now() : 0;
      if (expiryMs <= 0) {
        next(new Error('Authentication required.'));
        return;
      }
      socket.data.authExpiresAt = expiryMs;
      next();
    } catch {
      next(new Error('Authentication required.'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));
    if (socket.data.sessionId) socket.join(sessionRoom(socket.data.sessionId));
    const expiresIn = Math.max(0, socket.data.authExpiresAt ?? 0);
    const expiryTimer = setTimeout(() => socket.disconnect(true), expiresIn);

    socket.on('conversation:join', (conversationId, acknowledge) => {
      void joinConversation(socket, conversationId)
        .then((joined) => {
          if (typeof acknowledge === 'function') acknowledge(joined);
        })
        .catch((error: unknown) => {
          logRealtimeFailure('conversation_join_failed', error);
          if (typeof acknowledge === 'function') acknowledge(false);
        });
    });
    socket.on('conversation:leave', (conversationId) => {
      if (!socket.data.joinedConversations.delete(conversationId)) return;
      socket.leave(conversationRoom(conversationId));
      emitTypingToOtherParticipant(io, conversationId, userId, 'typing:stop');
    });
    socket.on('typing:start', (conversationId) => {
      const lastAt = socket.data.lastTypingAt.get(conversationId) ?? 0;
      if (!socket.data.joinedConversations.has(conversationId) || Date.now() - lastAt < 1000) return;
      socket.data.lastTypingAt.set(conversationId, Date.now());
      emitTypingToOtherParticipant(io, conversationId, userId, 'typing:start');
    });
    socket.on('typing:stop', (conversationId) => {
      if (!socket.data.joinedConversations.has(conversationId)) return;
      socket.data.lastTypingAt.delete(conversationId);
      emitTypingToOtherParticipant(io, conversationId, userId, 'typing:stop');
    });
    socket.on('message:delivered', (payload) => {
      void markDelivered(io, socket, payload)
        .catch((error: unknown) => logRealtimeFailure('message_delivery_receipt_failed', error));
    });
    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      for (const conversationId of socket.data.joinedConversations) {
        emitTypingToOtherParticipant(io, conversationId, userId, 'typing:stop');
      }
    });
  });

  realtimeServer = io;
  return io;
}

async function joinConversation(socket: ChatSocket, conversationId: string): Promise<boolean> {
  if (typeof conversationId !== 'string' || !/^[a-f\d]{24}$/i.test(conversationId)) return false;
  const conversation = await ConversationModel.findOne({
    _id: conversationId,
    participants: socket.data.userId,
  }).select('_id');
  if (!conversation) return false;
  socket.data.joinedConversations.add(conversationId);
  socket.join(conversationRoom(conversationId));
  return true;
}

async function markDelivered(
  io: ChatServer,
  socket: ChatSocket,
  payload: { conversationId: string; messageId: string },
): Promise<void> {
  if (!payload || !socket.data.joinedConversations.has(payload.conversationId) ||
      !/^[a-f\d]{24}$/i.test(payload.messageId)) return;
  const message = await MessageModel.findOneAndUpdate(
    {
      _id: payload.messageId,
      conversationId: payload.conversationId,
      senderId: { $ne: socket.data.userId },
      deliveredAt: null,
    },
    { $set: { deliveredAt: new Date() } },
    { new: true },
  ).select('_id senderId deliveredAt');
  if (!message?.deliveredAt) return;
  io.to(userRoom(String(message.senderId))).emit('message:delivered', {
    conversationId: payload.conversationId,
    messageId: String(message._id),
    deliveredAt: message.deliveredAt.toISOString(),
  });
}

function emitTypingToOtherParticipant(
  io: ChatServer,
  conversationId: string,
  userId: string,
  event: 'typing:start' | 'typing:stop',
): void {
  void ConversationModel.findOne({ _id: conversationId, participants: userId })
    .select('participants')
    .lean()
    .then((conversation) => {
      const otherId = conversation?.participants.find((id) => String(id) !== userId);
      if (otherId) io.to(userRoom(String(otherId))).emit(event, { conversationId, userId });
    })
    .catch((error: unknown) => logRealtimeFailure('typing_event_failed', error));
}

export function emitToUser<K extends keyof ServerToClientEvents>(
  userId: string,
  event: K,
  payload: ServerEventPayloads[K],
): void {
  const target = realtimeServer?.to(userRoom(userId));
  if (!target) return;
  switch (event) {
    case 'conversation:created':
      target.emit('conversation:created', payload as ServerEventPayloads['conversation:created']);
      break;
    case 'conversation:updated':
      target.emit('conversation:updated', payload as ServerEventPayloads['conversation:updated']);
      break;
    case 'message:new':
      target.emit('message:new', payload as ServerEventPayloads['message:new']);
      break;
    case 'message:sent':
      target.emit('message:sent', payload as ServerEventPayloads['message:sent']);
      break;
    case 'message:delivered':
      target.emit('message:delivered', payload as ServerEventPayloads['message:delivered']);
      break;
    case 'message:read':
      target.emit('message:read', payload as ServerEventPayloads['message:read']);
      break;
    case 'typing:start':
      target.emit('typing:start', payload as ServerEventPayloads['typing:start']);
      break;
    case 'typing:stop':
      target.emit('typing:stop', payload as ServerEventPayloads['typing:stop']);
      break;
    case 'unread:update':
      target.emit('unread:update', payload as ServerEventPayloads['unread:update']);
      break;
  }
}

export function emitToConversation(
  participants: readonly (string | { toString(): string })[],
  event: 'message:new' | 'conversation:updated' | 'message:read',
  payload: Record<string, unknown>,
): void {
  for (const participant of participants) {
    emitToUser(String(participant), event, payload as ServerEventPayloads[typeof event]);
  }
}

export function emitConversationCreated(conversationId: string, firstUserId: string, secondUserId: string): void {
  emitToUser(firstUserId, 'conversation:created', { id: conversationId, participantId: secondUserId });
  emitToUser(secondUserId, 'conversation:created', { id: conversationId, participantId: firstUserId });
}

export function emitUnreadCount(userId: string, count: number): void {
  emitToUser(userId, 'unread:update', { count });
}

export function disconnectSessionSockets(sessionId: string): void {
  realtimeServer?.in(sessionRoom(sessionId)).disconnectSockets(true);
}

export function disconnectUserSockets(userId: string): void {
  realtimeServer?.in(userRoom(userId)).disconnectSockets(true);
}

export async function closeRealtimeDependencies(): Promise<void> {
  const clients = redisClients;
  redisClients = [];
  await Promise.all(clients.map(async (client) => {
    if (client.isOpen) await client.quit();
  }));
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function logRealtimeFailure(event: string, error: unknown): void {
  console.error(JSON.stringify({
    event,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  }));
}
