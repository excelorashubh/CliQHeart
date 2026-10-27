import { Router, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { AuthService } from './auth.service';
import { loginSchema, registerSchema } from './auth.validation';

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  const service = new AuthService(config);

  router.post('/auth/register', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const payload = registerSchema.parse(request.body);
      const result = await service.register(payload);
      response.status(201).json({
        message: 'Registration successful.',
        user: result.user,
      });
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
      const payload = loginSchema.parse(request.body);
      const result = await service.login(payload);
      response.status(200).json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid login request.' });
        return;
      }

      if (error instanceof Error && error.message === 'Invalid credentials.' ) {
        response.status(401).json({ error: 'Invalid email/username or password.' });
        return;
      }

      if (error instanceof Error && error.message === 'Account is not active.') {
        response.status(403).json({ error: 'Account is not active.' });
        return;
      }

      next(error);
    }
  });

  return router;
}
