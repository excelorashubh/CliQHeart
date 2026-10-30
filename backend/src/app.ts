import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import type { AppConfig } from './config/env';
import { isDatabaseConnected } from './db/mongoose';
import { createAuthRouter } from './modules/auth';
import { createMessageRouter } from './modules/messages/message.routes';
import { createUserRouter } from './modules/users/user.routes';
import { createContentRouter } from './modules/content/content.routes';
import { createEngagementRouter } from './modules/content/engagement.routes';
import { createMediaRouter } from './modules/media/media.routes';
import { createNotificationRouter } from './modules/notifications/notification.routes';
import { createProfessionalRouter } from './modules/professional/professional.routes';

export interface RequestLogEntry {
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface AppOptions {
  config: AppConfig;
  databaseStatus?: () => boolean;
  requestLogger?: (entry: RequestLogEntry) => void;
}

const logLevels = ['debug', 'info', 'warn', 'error'] as const;
const apiRateLimit = 600;

function writeRequestLog(
  level: AppConfig['LOG_LEVEL'],
  entry: RequestLogEntry,
): void {
  const threshold = logLevels.indexOf(level);
  if (logLevels.indexOf('info') < threshold) {
    return;
  }
  console.info(JSON.stringify({ level: 'info', event: 'http_request', ...entry }));
}

export function createApp({
  config,
  databaseStatus = isDatabaseConnected,
  requestLogger,
}: AppOptions): express.Express {
  const app = express();
  const api = express.Router();
  const allowedCorsOrigins = new Set([
    ...config.CORS_ORIGINS,
    ...(config.ANDROID_DEV_ORIGIN ? [config.ANDROID_DEV_ORIGIN] : []),
  ]);

  app.disable('x-powered-by');
  if (config.NODE_ENV === 'production' || process.env.RENDER === 'true') {
    // Render's public load balancer is the single trusted forwarded-IP hop.
    app.set('trust proxy', 1);
  }
  app.use((request, response, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    response.on('finish', () => {
      const entry: RequestLogEntry = {
        requestId,
        method: request.method,
        route: response.locals.route ?? `${request.method} ${request.originalUrl.split('?')[0]}`,
        statusCode: response.statusCode,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
      (requestLogger ?? ((value) => writeRequestLog(config.LOG_LEVEL, value)))(entry);
    });
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Accept',
        'Authorization',
        'Content-Type',
        'X-CSRF-Token',
        'X-Session-Transport',
      ],
      origin: (origin, callback) => {
        callback(
          null,
          origin !== undefined && allowedCorsOrigins.has(origin) ? origin : false,
        );
      },
    }),
  );
  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && !allowedCorsOrigins.has(origin)) {
      response.status(403).json({
        error: 'Browser origin is not allowed.',
        requestId: response.locals.requestId,
      });
      return;
    }
    next();
  });
  app.use(hpp());
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use('/api/v1', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: apiRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (request) =>
      request.path === '/health' ||
      request.method === 'OPTIONS' ||
      [
        '/auth/login',
        '/auth/register',
        '/auth/refresh',
        '/auth/username-availability',
      ].includes(request.path),
    handler: (_request, response) => {
      response.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
        requestId: response.locals.requestId,
      });
    },
  }));
  api.get('/', (_request, response) => {
    response.locals.route = 'GET /api/v1';
    response.status(200).json({
      application: config.APP_NAME,
      apiVersion: 'v1',
      documentation: 'docs/API.md',
      status: 'ok',
      version: config.APP_VERSION,
    });
  });

  api.get('/health', (_request, response) => {
    response.locals.route = 'GET /api/v1/health';
    const connected = databaseStatus();
    response.status(200).json({
      application: config.APP_NAME,
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      database: connected ? 'connected' : 'disconnected',
      version: config.APP_VERSION,
    });
  });

  app.use('/api/v1', createAuthRouter(config));
  app.use('/api/v1', createMediaRouter(config));
  app.use('/api/v1', createContentRouter(config));
  app.use('/api/v1', createEngagementRouter(config));
  app.use('/api/v1', createNotificationRouter(config));
  app.use('/api/v1', createProfessionalRouter(config));
  app.use('/api/v1', createUserRouter(config));
  app.use('/api/v1', createMessageRouter(config));
  app.use('/api/v1', api);

  const notFoundHandler: RequestHandler = (_request, response) => {
    response.locals.route = 'unmatched';
    response.status(404).json({
      error: 'Not found',
      requestId: response.locals.requestId,
    });
  };
  app.use(notFoundHandler);

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number(error.status)
        : 500;
    const isClientError = status >= 400 && status < 500;
    const isMalformedJson =
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.parse.failed';
    response.status(isClientError ? status : 500).json({
      error: isMalformedJson
        ? 'Malformed JSON request'
        : status === 413
          ? 'Request body too large'
          : isClientError
            ? 'Invalid request'
            : 'Internal server error',
      requestId: response.locals.requestId,
    });
  };
  app.use(errorHandler);

  return app;
}
