const chunkSize = 20 * 1024 * 1024;
const chunkedThreshold = 20 * 1024 * 1024;

export class CloudinaryUploadError extends Error {
  constructor(status, message) {
    super(cloudinaryStatusMessage(status, message));
    this.name = 'CloudinaryUploadError';
    this.status = status;
  }
}

export function cloudinaryStatusMessage(status, providerMessage) {
  if (status === 401) return 'Cloudinary rejected the upload signature. Retry to request a fresh signature.';
  if (status === 403) {
    return 'Cloudinary denied the upload. Check that the backend API key has asset create/upload permission for this cloud.';
  }
  if (status === 413) return 'This file is too large for Cloudinary. Choose a smaller file and try again.';
  return providerMessage || `Cloudinary upload failed (${status}).`;
}

export async function validateMediaFile(file, purpose) {
  if (!file) throw new Error('Choose a file to upload.');
  const isVideo = purpose === 'reel' || (purpose !== 'profile' && file.type.startsWith('video/'));
  const maximum = purpose === 'profile'
    ? 10 * 1024 * 1024
    : purpose === 'reel'
      ? 250 * 1024 * 1024
      : 100 * 1024 * 1024;
  if (file.size < 1 || file.size > maximum) {
    throw new Error(`Choose a file smaller than ${Math.round(maximum / 1024 / 1024)} MB.`);
  }
  const header = await readHeader(file.slice(0, 16));
  const ext = file.name.split('.').pop()?.toLowerCase();
  const imageFormat = identifyImageFormat(header);
  const videoFormat = identifyVideoFormat(header);
  const valid = isVideo
    ? Boolean(videoFormat && ['mp4', 'mov'].includes(ext))
    : Boolean(imageFormat && ['jpg', 'jpeg', 'png', 'webp'].includes(ext));
  if (!valid) {
    throw new Error(isVideo
      ? 'Choose a valid MP4 or MOV video file.'
      : 'Choose a valid JPEG, PNG, or WebP image file.');
  }
  return { resourceType: isVideo ? 'video' : 'image' };
}

function readHeader(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not inspect the selected file.'));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('Could not inspect the selected file.'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export async function uploadFileToCloudinary(upload, file, { signal, onProgress = () => {} } = {}) {
  const isChunked = upload.resourceType === 'video' && file.size > chunkedThreshold;
  if (!isChunked) {
    const form = createSignedForm(upload, file);
    return sendChunk(upload.uploadUrl, form, {
      signal,
      onProgress: (loaded, total) => onProgress(Math.round((loaded / total) * 100)),
    });
  }

  const uploadId = crypto.randomUUID();
  let finalResponse;
  for (let start = 0; start < file.size; start += chunkSize) {
    if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end, file.type);
    const form = createSignedForm(upload, chunk, file.name);
    finalResponse = await sendChunk(upload.uploadUrl, form, {
      signal,
      uploadId,
      contentRange: `bytes ${start}-${end - 1}/${file.size}`,
      onProgress: (loaded) => onProgress(Math.round(((start + loaded) / file.size) * 100)),
    });
  }
  return finalResponse;
}

function createSignedForm(upload, file, filename = file.name) {
  const form = new FormData();
  form.append('file', file, filename || 'upload');
  form.append('api_key', upload.apiKey);
  form.append('timestamp', String(upload.timestamp));
  form.append('public_id', upload.publicId);
  form.append('allowed_formats', upload.allowedFormats.join(','));
  form.append('overwrite', 'false');
  form.append('signature', upload.signature);
  return form;
}

function sendChunk(url, form, { signal, uploadId, contentRange, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 300000;
    xhr.withCredentials = false;
    if (uploadId) xhr.setRequestHeader('X-Unique-Upload-Id', uploadId);
    if (contentRange) xhr.setRequestHeader('Content-Range', contentRange);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onerror = () => reject(new Error('Cloudinary upload failed due to a network error.'));
    xhr.ontimeout = () => reject(new Error('Cloudinary upload timed out. Retry the upload.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
    xhr.onload = () => {
      let result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error('Cloudinary returned an invalid upload response.'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new CloudinaryUploadError(xhr.status, result?.error?.message));
        return;
      }
      resolve(result);
    };
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', abort);
    xhr.send(form);
  });
}

function identifyImageFormat(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') return 'png';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'webp';
  return null;
}

function identifyVideoFormat(bytes) {
  if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') return null;
  const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
  return brand === 'qt  ' ? 'mov' : 'mp4';
}
