import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVideoDurationSeconds } from './videoMetadata.js';

const NativeURL = URL;

function setupVideo(duration, event = 'loadedmetadata') {
  const objectUrl = 'blob:local-reel';
  vi.stubGlobal('URL', class TestURL extends NativeURL {
    static createObjectURL = vi.fn(() => objectUrl);
    static revokeObjectURL = vi.fn();
  });
  const createElement = document.createElement.bind(document);
  const createVideo = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
    const element = createElement(tagName, options);
    if (tagName === 'video') {
      if (duration !== undefined) {
        Object.defineProperty(element, 'duration', { configurable: true, value: duration });
      }
      if (event) queueMicrotask(() => element.dispatchEvent(new Event(event)));
    }
    return element;
  });
  return { createVideo };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getVideoDurationSeconds', () => {
  it('reads duration in seconds from loadedmetadata and cleans up the temporary object URL', async () => {
    const { createVideo } = setupVideo(35);
    const file = new File(['video'], 'reel.mp4', { type: 'video/mp4' });

    await expect(getVideoDurationSeconds(file)).resolves.toBe(35);

    expect(createVideo).toHaveBeenCalledWith('video');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-reel');
  });

  it('waits for delayed metadata rather than treating it as missing', async () => {
    vi.stubGlobal('URL', class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:slow-reel');
      static revokeObjectURL = vi.fn();
    });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', { configurable: true, value: 35 });
        setTimeout(() => element.dispatchEvent(new Event('loadedmetadata')), 15);
      }
      return element;
    });
    const file = new File(['video'], 'reel.mp4', { type: 'video/mp4' });

    await expect(getVideoDurationSeconds(file, { timeoutMs: 100 })).resolves.toBe(35);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    'rejects unavailable or invalid duration %s',
    async (duration) => {
      setupVideo(duration);
      const file = new File(['video'], 'reel.mp4', { type: 'video/mp4' });

      await expect(getVideoDurationSeconds(file)).rejects.toThrow(/could not verify/i);
    },
  );

  it('reports unreadable media, timeouts, and invalid input distinctly', async () => {
    setupVideo(undefined, 'error');
    const file = new File(['video'], 'reel.mp4', { type: 'video/mp4' });
    await expect(getVideoDurationSeconds(file)).rejects.toThrow(/could not read.*metadata/i);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setupVideo(undefined, null);
    await expect(getVideoDurationSeconds(file, { timeoutMs: 1 })).rejects.toThrow(/too long to load/i);
    await expect(getVideoDurationSeconds(new File(['image'], 'photo.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow(/readable video/i);
  });

  it('converts metadata extraction exceptions into a verification error', async () => {
    const objectUrl = 'blob:broken-metadata';
    vi.stubGlobal('URL', class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => objectUrl);
      static revokeObjectURL = vi.fn();
    });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options);
      if (tagName === 'video') {
        Object.defineProperty(element, 'duration', {
          configurable: true,
          get() {
            throw new Error('metadata decoder failure');
          },
        });
        queueMicrotask(() => element.dispatchEvent(new Event('loadedmetadata')));
      }
      return element;
    });
    const file = new File(['video'], 'reel.mp4', { type: 'video/mp4' });

    await expect(getVideoDurationSeconds(file)).rejects.toThrow(/could not verify/i);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(objectUrl);
  });
});
