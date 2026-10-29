import type { NextFunction, Request, RequestHandler, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { SessionModel } from './session.model';

export interface AuthenticatedRequest extends Request {
  authenticatedUserId?: string;
  authenticatedSessionId?: string;
}

export function requireAccessToken(config: AppConfig): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization');
    const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token || !config.JWT_ACCESS_SECRET) {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }

    try {
      const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      });
      if (
        typeof payload === 'string' ||
        payload.tokenType !== 'access' ||
        typeof payload.sub !== 'string' ||
        !Types.ObjectId.isValid(payload.sub)
      ) {
        response.status(401).json({ error: 'Invalid access token.' });
        return;
      }

      if (payload.sid !== undefined) {
        if (typeof payload.sid !== 'string' || !Types.ObjectId.isValid(payload.sid)) {
          response.status(401).json({ error: 'Invalid access token.' });
          return;
        }
        const activeSession = await SessionModel.exists({
          _id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        });
        if (!activeSession) {
          response.status(401).json({ error: 'Session is no longer available.' });
          return;
        }
        (request as AuthenticatedRequest).authenticatedSessionId = payload.sid;
      }

      const activeUser = await UserModel.findOne({
        _id: payload.sub,
        accountStatus: 'active',
      }).select('_id');
      if (!activeUser) {
        response.status(401).json({ error: 'Account is not available.' });
        return;
      }

      (request as AuthenticatedRequest).authenticatedUserId = payload.sub;
      next();
    } catch {
      if (response.headersSent) return;
      next(new Error('Could not validate access token.'));
    }
  };
}
