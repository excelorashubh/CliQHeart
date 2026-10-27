import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import type { AppConfig } from './config/env';
import { isDatabaseConnected } from './db/mongoose';
import { createAuthRouter } from './modules/auth';

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
  app.use((request, response, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    response.on('finish', () => {
      const entry: RequestLogEntry = {
        requestId,
        method: request.method,
        route: response.locals.route ?? 'unmatched',
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
      origin: (origin, callback) => {
        callback(
          null,
          origin !== undefined && allowedCorsOrigins.has(origin) ? origin : false,
        );
      },
    }),
  );
  app.use(hpp());
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

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
