import { describe, expect, it } from 'vitest';
import { cloudinaryStatusMessage, validateMediaFile } from './cloudinaryUpload.js';

describe('validateMediaFile', () => {
  it('accepts supported image content based on its file signature', async () => {
    const file = new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    ], 'portrait.jpg', { type: 'image/jpeg' });

    await expect(validateMediaFile(file, 'profile')).resolves.toEqual({ resourceType: 'image' });
  });

  describe('Cloudinary upload errors', () => {
    it('explains permission, signature, and size failures without hiding their status', () => {
      expect(cloudinaryStatusMessage(401)).toMatch(/signature/i);
      expect(cloudinaryStatusMessage(403)).toMatch(/create\/upload permission/i);
      expect(cloudinaryStatusMessage(413)).toMatch(/too large/i);
      expect(cloudinaryStatusMessage(500, 'Provider error')).toBe('Provider error');
    });
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
      size: 10 * 1024 * 1024 + 1,
      slice: () => { throw new Error('Oversized file must be rejected before reading.'); },
    };
    await expect(validateMediaFile(oversized, 'profile')).rejects.toThrow('smaller than 10 MB');
  });
});
