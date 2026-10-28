import type { NextFunction, Request, RequestHandler, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';

export interface AuthenticatedRequest extends Request {
  authenticatedUserId?: string;
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
