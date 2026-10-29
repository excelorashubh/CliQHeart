import { describe, expect, it } from 'vitest';
import {
  CloudinaryUploadError,
  cloudinaryStatusMessage,
  validateMediaFile,
} from './cloudinaryUpload.js';

describe('validateMediaFile', () => {
  it('accepts supported image content based on its file signature', async () => {
    const file = new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    ], 'portrait.jpg', { type: 'image/jpeg' });

    await expect(validateMediaFile(file, 'profile')).resolves.toEqual({ resourceType: 'image' });
  });

  it('accepts PNG images and enforces the five-megabyte profile limit', async () => {
    const png = new File([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ], 'portrait.png', { type: 'image/png' });
    await expect(validateMediaFile(png, 'profile')).resolves.toEqual({ resourceType: 'image' });

    const oversized = {
      name: 'portrait.jpg',
      type: 'image/jpeg',
      size: 5 * 1024 * 1024 + 1,
      slice: () => { throw new Error('Oversized file must be rejected before reading.'); },
    };
    await expect(validateMediaFile(oversized, 'profile')).rejects.toThrow('smaller than 5 MB');
  });

  it('accepts WebP image content for profile photos', async () => {
    const webp = new File([
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
    ], 'portrait.webp', { type: 'image/webp' });

    await expect(validateMediaFile(webp, 'profile')).resolves.toEqual({ resourceType: 'image' });
  });

  it('rejects a mismatched declared image MIME type', async () => {
    const jpeg = new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    ], 'portrait.jpg', { type: 'image/png' });

    await expect(validateMediaFile(jpeg, 'profile')).rejects.toThrow('matching file type');
  });

  it('accepts an MP4 video only for video-enabled content', async () => {
    const file = new File([
      new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    ], 'clip.mp4', { type: 'video/mp4' });

    await expect(validateMediaFile(file, 'reel')).resolves.toEqual({ resourceType: 'video' });
    await expect(validateMediaFile(file, 'profile')).rejects.toThrow('valid JPEG, PNG, or WebP');
  });

  it('rejects unsupported extensions and files over the purpose-specific size limit', async () => {
    const invalid = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'portrait.gif', { type: 'image/gif' });
    await expect(validateMediaFile(invalid, 'post')).rejects.toThrow('valid JPEG, PNG, or WebP');

    const oversized = {
      name: 'portrait.jpg',
      type: 'image/jpeg',
      size: 5 * 1024 * 1024 + 1,
      slice: () => { throw new Error('Oversized file must be rejected before reading.'); },
    };
    await expect(validateMediaFile(oversized, 'profile')).rejects.toThrow('smaller than 5 MB');
  });
});

describe('Cloudinary upload errors', () => {
  it('distinguishes parameter, signature, permission, and size failures', () => {
    expect(cloudinaryStatusMessage(400)).toMatch(/parameters or image format/i);
    expect(cloudinaryStatusMessage(401)).toMatch(/signature/i);
    expect(cloudinaryStatusMessage(403)).toMatch(/permission.*account upload restrictions/i);
    expect(cloudinaryStatusMessage(413)).toMatch(/too large/i);
    expect(cloudinaryStatusMessage(500)).toMatch(/HTTP 500/);
  });

  it('preserves safe provider diagnostics without exposing signed values', () => {
    const error = new CloudinaryUploadError(
      403,
      'permission_denied',
      'Create denied; api_secret=private-value; signature: sensitive-value',
    );

    expect(error.status).toBe(403);
    expect(error.code).toBe('permission_denied');
    expect(error.providerMessage).toContain('Create denied');
    expect(error.message).not.toContain('private-value');
    expect(error.message).not.toContain('sensitive-value');
  });
});
