import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaUploader } from './MediaUploader.jsx';
import { mediaApi } from '../services/api.js';
import * as cloudinaryUpload from '../services/cloudinaryUpload.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MediaUploader Reel metadata confirmation', () => {
  it('does not deliver media for duration validation until server metadata confirmation completes', async () => {
    let resolveConfirmation;
    vi.stubGlobal('URL', class TestURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:reel-preview');
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(mediaApi, 'signature').mockResolvedValue({
      media: { id: 'media-reel' },
      upload: {
        apiKey: 'test-key',
        cloudName: 'test-cloud',
        resourceType: 'video',
        uploadUrl: 'https://api.cloudinary.com/v1_1/test-cloud/video/upload',
        timestamp: 1,
        signature: 'test-signature',
        publicId: 'cliqheart/reel/test',
        allowedFormats: ['mp4'],
        maxBytes: 250 * 1024 * 1024,
      },
    });
    vi.spyOn(mediaApi, 'confirm').mockImplementation(() => new Promise((resolve) => {
      resolveConfirmation = resolve;
    }));
    vi.spyOn(mediaApi, 'remove').mockResolvedValue(null);
    const validate = vi.spyOn(cloudinaryUpload, 'validateMediaFile')
      .mockResolvedValue({ resourceType: 'video' });
    const upload = vi.spyOn(cloudinaryUpload, 'uploadFileToCloudinary')
      .mockResolvedValue({
        public_id: 'cliqheart/reel/test',
        resource_type: 'video',
        secure_url: 'https://res.cloudinary.com/test-cloud/video/upload/reel.mp4',
      });
    const onReady = vi.fn();
    const { container, findByRole } = render(<MediaUploader purpose="reel" onReady={onReady} />);
    const file = new File(['video'], 'reel.mp4', { type: 'video/mp4' });

    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

    await waitFor(() => expect(mediaApi.confirm).toHaveBeenCalledWith('media-reel'));
    expect(validate).toHaveBeenCalledWith(file, 'reel');
    expect(upload).toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();

    resolveConfirmation({ media: {
      id: 'media-reel',
      status: 'ready',
      resourceType: 'video',
      duration: 35,
      secureUrl: 'https://res.cloudinary.com/test-cloud/video/upload/reel.mp4',
    } });

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ duration: 35 })));
    expect(await findByRole('button', { name: 'Remove upload' })).toBeInTheDocument();
  });
});
