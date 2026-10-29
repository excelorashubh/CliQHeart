import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { requireAccessToken, type AuthenticatedRequest } from './require-access-token';
import { AuthService } from './auth.service';
import { loginSchema, refreshSchema, registerSchema } from './auth.validation';
import type { AuthSessionResult } from './auth.service';

const refreshCookieName = 'cliqheart_refresh';
const refreshCookiePath = '/api/v1/auth';

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  const service = new AuthService(config);
  const authenticate = requireAccessToken(config);

  router.post('/auth/register', async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (usesCookieTransport(request) && !hasTrustedOrigin(request, config)) {
        response.status(403).json({ error: 'Browser origin is not allowed.' });
        return;
      }
      const payload = registerSchema.parse(request.body);
      const result = await service.register(payload);
      sendSession(response, result, usesCookieTransport(request), 201, 'Registration successful.');
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({
          error: 'Invalid registration data.',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.') || 'value',
            message: issue.message,
          })),
        });
        return;
      }

      if (error instanceof Error && error.message === 'User already exists.') {
        response.status(409).json({ error: 'Username or email is already in use.' });
        return;
      }

      next(error);
    }
  });

  router.post('/auth/login', async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (usesCookieTransport(request) && !hasTrustedOrigin(request, config)) {
        response.status(403).json({ error: 'Browser origin is not allowed.' });
        return;
      }
      const payload = loginSchema.parse(request.body);
      const result = await service.login(payload);
      sendSession(response, result, usesCookieTransport(request), 200);
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid login request.' });
        return;
      }

      if (error instanceof Error && error.message === 'Invalid credentials.' ) {
        response.status(401).json({ error: 'Invalid email/username or password.' });
        return;
      }

      if (
        error instanceof Error &&
        [
          'Account is pending approval.',
          'Account is suspended.',
          'Account is deleted.',
          'Account status is invalid.',
        ].includes(error.message)
      ) {
        response.status(403).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  router.post('/auth/refresh', async (request: Request, response: Response, next: NextFunction) => {
    const cookieTransport = usesCookieTransport(request);
    try {
      if (cookieTransport && !hasTrustedOrigin(request, config)) {
        response.status(403).json({ error: 'Browser origin is not allowed.' });
        return;
      }
      const refreshToken = cookieTransport
        ? readRefreshCookie(request)
        : refreshSchema.parse(request.body).refreshToken;
      if (!refreshToken) {
        response.status(401).json({ error: 'Refresh session is unavailable.' });
        return;
      }
      const result = await service.refresh(refreshToken);
      sendSession(response, result, cookieTransport);
    } catch (error) {
      if (error instanceof ZodError || isSessionError(error)) {
        response.status(401).json({ error: 'Refresh session is invalid or expired.' });
        return;
      }
      if (error instanceof Error && error.message === 'Account is not available.') {
        response.status(403).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.post('/auth/logout', async (request: Request, response: Response, next: NextFunction) => {
    const cookieTransport = usesCookieTransport(request);
    try {
      if (cookieTransport && !hasTrustedOrigin(request, config)) {
        response.status(403).json({ error: 'Browser origin is not allowed.' });
        return;
      }
      const refreshToken = cookieTransport
        ? readRefreshCookie(request)
        : request.body?.refreshToken;
      await service.logout(typeof refreshToken === 'string' ? refreshToken : undefined);
      if (cookieTransport) clearRefreshCookie(response);
      response.status(204).end();
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid logout request.' });
        return;
      }
      next(error);
    }
  });

  router.post('/auth/logout-all', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      await service.logoutAll((request as AuthenticatedRequest).authenticatedUserId!);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function sendSession(
  response: Response,
  result: AuthSessionResult,
  cookieTransport: boolean,
  status = 200,
  message?: string,
): void {
  if (cookieTransport) setRefreshCookie(response, result.refreshToken, result.expiresAt);
  response.status(status).json({
    ...(message ? { message } : {}),
    accessToken: result.accessToken,
    ...(!cookieTransport ? { refreshToken: result.refreshToken } : {}),
    user: result.user,
  });
}

function usesCookieTransport(request: Request): boolean {
  return request.get('x-session-transport') === 'cookie';
}

function hasTrustedOrigin(request: Request, config: AppConfig): boolean {
  const origin = request.get('origin');
  const trustedOrigins = new Set([
    ...config.CORS_ORIGINS,
    ...(config.ANDROID_DEV_ORIGIN ? [config.ANDROID_DEV_ORIGIN] : []),
  ]);
  return Boolean(origin && trustedOrigins.has(origin));
}

function readRefreshCookie(request: Request): string | undefined {
  const cookieHeader = request.get('cookie');
  if (!cookieHeader) return undefined;
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== refreshCookieName) continue;
    return cookie.slice(separator + 1).trim();
  }
  return undefined;
}

function setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(refreshCookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: refreshCookiePath,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

function clearRefreshCookie(response: Response): void {
  response.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: refreshCookiePath,
  });
}

function isSessionError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Invalid refresh session.';
}
