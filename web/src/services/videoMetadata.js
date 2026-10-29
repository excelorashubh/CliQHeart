export function getVideoDurationSeconds(file, { timeoutMs = 15000 } = {}) {
  if (!(file instanceof Blob) || !file.type.startsWith('video/')) {
    return Promise.reject(new Error('Choose a readable video file to verify its duration.'));
  }

  let objectUrl;
  try {
    objectUrl = URL.createObjectURL(file);
  } catch {
    return Promise.reject(new Error('Could not read this video’s metadata. Choose another video or retry.'));
  }
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let timeoutId;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
    const finish = (error, duration) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(duration);
    };
    const onLoadedMetadata = () => {
      try {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          finish(new Error('Could not verify this video’s duration. Choose another video or retry.'));
          return;
        }
        finish(null, duration);
      } catch {
        finish(new Error('Could not verify this video’s duration. Choose another video or retry.'));
      }
    };
    const onError = () => {
      finish(new Error('Could not read this video’s metadata. Choose another video or retry.'));
    };

    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onError);
    timeoutId = setTimeout(() => {
      finish(new Error('Video metadata took too long to load. Retry the upload.'));
    }, timeoutMs);
    try {
      video.src = objectUrl;
    } catch {
      finish(new Error('Could not read this video’s metadata. Choose another video or retry.'));
    }
  });
}
