import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../../config/env';
import { UserModel } from '../../models/user';
import { requireAccessToken, type AuthenticatedRequest } from '../auth/require-access-token';
import { PostModel } from '../content/post.model';
import { ReelModel } from '../content/reel.model';
import { StoryModel } from '../content/story.model';
import { CloudinaryUnavailableError, createCloudinaryClient, type CloudinaryMediaClient } from './cloudinary';
import { MediaModel } from './media.model';

const signatureRequestSchema = z.object({
  purpose: z.enum(['profile', 'post', 'story', 'reel']),
  resourceType: z.enum(['image', 'video']),
}).strict();

export const uploadRules = {
  profile: { resourceTypes: ['image'], formats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 5 * 1024 * 1024 },
  post: { resourceTypes: ['image', 'video'], formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'], maxBytes: 100 * 1024 * 1024 },
  story: { resourceTypes: ['image', 'video'], formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'], maxBytes: 100 * 1024 * 1024 },
  reel: { resourceTypes: ['video'], formats: ['mp4', 'mov'], maxBytes: 250 * 1024 * 1024 },
} as const;

const signatureRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const confirmationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export function createMediaRouter(
  config: AppConfig,
  cloudinaryClient?: CloudinaryMediaClient,
): Router {
  const router = Router();
  const authenticate = requireAccessToken(config);

  router.post('/media/signature', authenticate, signatureRateLimit, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { purpose, resourceType } = signatureRequestSchema.parse(request.body);
      const ownerId = authenticatedUserId(request);
      const rules = uploadRules[purpose];
      if (!(rules.resourceTypes as readonly string[]).includes(resourceType)) {
        response.status(400).json({ error: 'That media type is not allowed for this upload.' });
        return;
      }

      let provider: CloudinaryMediaClient;
      try {
        provider = cloudinaryClient ?? createCloudinaryClient(config);
      } catch (error) {
        if (error instanceof CloudinaryUnavailableError) {
          response.status(503).json({ error: error.message });
          return;
        }
        throw error;
      }
      const id = randomUUID();
      const folder = purpose === 'profile'
        ? `cliqheart/profiles/${ownerId}`
        : `cliqheart/${purpose}/${ownerId}`;
      const publicId = `${folder}/${id}`;
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureParameters = {
        allowed_formats: rules.formats.join(','),
        overwrite: false,
        public_id: publicId,
        timestamp,
      };
      const signature = provider.sign(signatureParameters);
      const media = await MediaModel.create({
        _id: new Types.ObjectId(),
        ownerId,
        purpose,
        resourceType,
        publicId,
        folder,
        status: 'uploading',
        signatureExpiresAt: new Date((timestamp + 60 * 60) * 1000),
      });

      response.status(201).json({
        media: { id: String(media._id), status: media.status },
        upload: {
          apiKey: config.CLOUDINARY_API_KEY,
          cloudName: config.CLOUDINARY_CLOUD_NAME,
          resourceType,
          uploadUrl: `https://api.cloudinary.com/v1_1/${config.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
          timestamp,
          signature,
          publicId,
          allowedFormats: rules.formats,
          maxBytes: rules.maxBytes,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: 'Invalid media upload request.' });
        return;
      }
      if (error instanceof CloudinaryUnavailableError) {
        response.status(503).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.post('/media/:mediaId/confirm', authenticate, confirmationRateLimit, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const mediaId = request.params.mediaId;
      if (!mediaId || !Types.ObjectId.isValid(mediaId)) {
        response.status(400).json({ error: 'Invalid media ID.' });
        return;
      }
      const ownerId = authenticatedUserId(request);
      const media = await MediaModel.findOne({ _id: mediaId, ownerId });
      if (!media) {
        response.status(404).json({ error: 'Media upload not found.' });
        return;
      }
      if (media.status === 'ready') {
        response.json({ media: mediaPayload(media) });
        return;
      }
      if (media.status !== 'uploading' || media.signatureExpiresAt.getTime() < Date.now()) {
        response.status(410).json({ error: 'This upload signature has expired.' });
        return;
      }

      let provider: CloudinaryMediaClient;
      try {
        provider = cloudinaryClient ?? createCloudinaryClient(config);
      } catch (error) {
        if (error instanceof CloudinaryUnavailableError) {
          response.status(503).json({ error: error.message });
          return;
        }
        throw error;
      }
      let resource: unknown;
      try {
        resource = await provider.resource(media.publicId, media.resourceType);
      } catch (error) {
        const failure = cloudinaryFailure(error);
        if (failure.status === 404) {
          response.status(409).json({ error: 'The upload is not available to confirm yet.' });
          return;
        }
        console.warn(JSON.stringify({
          event: 'cloudinary_asset_verification_failed',
          providerStatus: failure.status ?? null,
          providerCode: failure.code ?? null,
        }));
        response.status(502).json({
          error: 'Could not verify the uploaded asset with Cloudinary.',
          provider: {
            status: failure.status ?? null,
            code: failure.code ?? null,
            message: cloudinaryFailureMessage(failure.status),
          },
        });
        return;
      }
      const verified = parseCloudinaryResource(resource);
      const rules = uploadRules[media.purpose];
      if (
        !verified ||
        verified.publicId !== media.publicId ||
        verified.resourceType !== media.resourceType ||
        !(rules.formats as readonly string[]).includes(verified.format) ||
        verified.bytes < 1 ||
        verified.bytes > rules.maxBytes ||
        !isCloudinaryHttpsUrl(verified.secureUrl, config.CLOUDINARY_CLOUD_NAME)
      ) {
        response.status(422).json({ error: 'The uploaded asset did not pass validation.' });
        return;
      }

      const thumbnailUrl = createThumbnailUrl(
        config.CLOUDINARY_CLOUD_NAME,
        media.resourceType,
        media.publicId,
      );
      const confirmed = await MediaModel.findOneAndUpdate(
        { _id: media._id, ownerId, status: 'uploading' },
        {
          $set: {
            assetId: verified.assetId,
            secureUrl: verified.secureUrl,
            format: verified.format,
            bytes: verified.bytes,
            width: verified.width ?? null,
            height: verified.height ?? null,
            duration: verified.duration ?? null,
            thumbnailUrl,
            status: 'ready',
          },
        },
        { new: true },
      );
      if (!confirmed) {
        response.status(409).json({ error: 'This upload is no longer available to confirm.' });
        return;
      }
      response.json({ media: mediaPayload(confirmed) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/media/:mediaId', authenticate, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const mediaId = request.params.mediaId;
      if (!mediaId || !Types.ObjectId.isValid(mediaId)) {
        response.status(400).json({ error: 'Invalid media ID.' });
        return;
      }
      const ownerId = authenticatedUserId(request);
      const existing = await MediaModel.findOne({ _id: mediaId, ownerId });
      if (!existing) {
        response.status(404).json({ error: 'Media upload not found.' });
        return;
      }
      if (existing.status === 'deleted') {
        response.status(204).end();
        return;
      }

      let provider: CloudinaryMediaClient;
      try {
        provider = cloudinaryClient ?? createCloudinaryClient(config);
      } catch (error) {
        if (error instanceof CloudinaryUnavailableError) {
          response.status(503).json({ error: error.message });
          return;
        }
        throw error;
      }
      const media = await MediaModel.findOneAndUpdate(
        {
          _id: mediaId,
          ownerId,
          status: { $in: ['uploading', 'ready', 'failed'] },
          attachedTo: { $exists: false },
        },
        { $set: { status: 'deleting' } },
        { new: false },
      );
      if (!media) {
        response.status(409).json({ error: 'Media is attached or another operation is in progress.' });
        return;
      }

      const [profileReference, postReference, storyReference, reelReference] = await Promise.all([
        UserModel.exists({ avatarMediaId: media._id }),
        PostModel.exists({ mediaId: media._id }),
        StoryModel.exists({ mediaId: media._id, expiresAt: { $gt: new Date() } }),
        ReelModel.exists({ mediaId: media._id }),
      ]);
      if (media.attachedTo || profileReference || postReference || storyReference || reelReference) {
        await MediaModel.updateOne(
          { _id: media._id, status: 'deleting' },
          { $set: { status: media.status } },
        );
        response.status(409).json({ error: 'Media still attached to active content cannot be deleted.' });
        return;
      }

      let result: unknown;
      try {
        result = await provider.destroy(media.publicId, media.resourceType);
      } catch (error) {
        await MediaModel.updateOne(
          { _id: media._id, status: 'deleting' },
          { $set: { status: media.status } },
        );
        if (cloudinaryStatus(error) === 404) {
          result = { result: 'not found' };
        } else {
          response.status(502).json({ error: 'Cloudinary could not delete this asset. Retry later.' });
          return;
        }
      }
      if (!isDeletedCloudinaryResult(result)) {
        await MediaModel.updateOne(
          { _id: media._id, status: 'deleting' },
          { $set: { status: media.status } },
        );
        response.status(502).json({ error: 'Cloudinary could not confirm asset deletion.' });
        return;
      }
      await MediaModel.updateOne(
        { _id: media._id, status: 'deleting' },
        { $set: { status: 'deleted' } },
      );
      response.status(204).end();
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

function mediaPayload(media: {
  _id: unknown;
  purpose: string;
  resourceType: string;
  publicId: string;
  secureUrl?: string | null;
  format?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  thumbnailUrl?: string | null;
  status: string;
}) {
  return {
    id: String(media._id),
    purpose: media.purpose,
    resourceType: media.resourceType,
    publicId: media.publicId,
    secureUrl: media.secureUrl,
    format: media.format,
    bytes: media.bytes,
    width: media.width,
    height: media.height,
    duration: media.duration,
    thumbnailUrl: media.thumbnailUrl,
    status: media.status,
  };
}

function parseCloudinaryResource(value: unknown): {
  publicId: string;
  assetId: string;
  resourceType: string;
  secureUrl: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
} | null {
  if (typeof value !== 'object' || value === null) return null;
  const asset = value as Record<string, unknown>;
  if (
    typeof asset.public_id !== 'string' ||
    typeof asset.asset_id !== 'string' ||
    typeof asset.resource_type !== 'string' ||
    typeof asset.secure_url !== 'string' ||
    typeof asset.format !== 'string' ||
    typeof asset.bytes !== 'number'
  ) return null;
  return {
    publicId: asset.public_id,
    assetId: asset.asset_id,
    resourceType: asset.resource_type,
    secureUrl: asset.secure_url,
    format: asset.format.toLowerCase(),
    bytes: asset.bytes,
    ...(typeof asset.width === 'number' ? { width: asset.width } : {}),
    ...(typeof asset.height === 'number' ? { height: asset.height } : {}),
    ...(typeof asset.duration === 'number' ? { duration: asset.duration } : {}),
  };
}

function isCloudinaryHttpsUrl(value: string, cloudName: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'res.cloudinary.com' &&
      url.pathname.startsWith(`/${cloudName}/`);
  } catch {
    return false;
  }
}

function createThumbnailUrl(
  cloudName: string,
  resourceType: 'image' | 'video',
  publicId: string,
): string {
  const transformations = resourceType === 'image'
    ? 'f_auto,q_auto,w_640,c_limit'
    : 'so_0,f_jpg,q_auto,w_640,c_limit';
  const extension = resourceType === 'video' ? '.jpg' : '';
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/${transformations}/${publicId}${extension}`;
}

function cloudinaryStatus(error: unknown): number | undefined {
  return cloudinaryFailure(error).status;
}

function cloudinaryFailure(error: unknown): { status?: number; code?: string } {
  if (typeof error !== 'object' || error === null || !('error' in error)) return {};
  const nested = error.error;
  if (typeof nested !== 'object' || nested === null) return {};
  const status = 'http_code' in nested && typeof nested.http_code === 'number'
    ? nested.http_code
    : undefined;
  const code = 'code' in nested && typeof nested.code === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(nested.code)
    ? nested.code
    : undefined;
  return { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
}

function cloudinaryFailureMessage(status?: number): string {
  if (status === 400) return 'Cloudinary rejected the asset request.';
  if (status === 401) return 'Cloudinary rejected the configured API credentials.';
  if (status === 403) return 'Cloudinary denied this API operation because of account or API key permissions.';
  if (status === 413) return 'The Cloudinary asset exceeds the allowed size.';
  return 'Cloudinary did not complete the asset verification request.';
}

function isDeletedCloudinaryResult(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('result' in value)) return false;
  return value.result === 'ok' || value.result === 'not found';
}
