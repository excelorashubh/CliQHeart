import { v2 as cloudinary } from 'cloudinary';
import type { AppConfig } from '../../config/env';

export class CloudinaryUnavailableError extends Error {
  constructor() {
    super('Media uploads are not configured.');
    this.name = 'CloudinaryUnavailableError';
  }
}

export interface CloudinaryMediaClient {
  sign(parameters: Record<string, string | number | boolean>): string;
  resource(publicId: string, resourceType: 'image' | 'video'): Promise<unknown>;
  destroy(publicId: string, resourceType: 'image' | 'video'): Promise<unknown>;
}

export function createCloudinaryClient(config: AppConfig): CloudinaryMediaClient {
  const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = config;
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME) {
    throw new CloudinaryUnavailableError();
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });

  return {
    sign: (parameters) => cloudinary.utils.api_sign_request(parameters, CLOUDINARY_API_SECRET),
    resource: (publicId, resourceType) =>
      cloudinary.api.resource(publicId, { resource_type: resourceType, type: 'upload' }),
    destroy: (publicId, resourceType) =>
      cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: 'upload' }),
  };
}
