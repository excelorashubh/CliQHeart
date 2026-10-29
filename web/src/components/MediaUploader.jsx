import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaApi } from '../services/api.js';
import { uploadFileToCloudinary, validateMediaFile } from '../services/cloudinaryUpload.js';

const acceptByPurpose = {
  profile: 'image/jpeg,image/png,image/webp',
  post: 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime',
  story: 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime',
  reel: 'video/mp4,video/quicktime',
};

export function MediaUploader({ purpose, onReady, currentImageUrl = '', disabled = false }) {
  const [file, setFile] = useState(null);
  const [media, setMedia] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const controller = useRef(null);
  const fileInput = useRef(null);
  const preview = useMemo(() => file ? URL.createObjectURL(file) : '', [file]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => () => controller.current?.abort(), []);

  async function upload(selectedFile = file) {
    if (!selectedFile || busy || disabled) return;
    setError('');
    setMedia(null);
    setProgress(0);
    setBusy(true);
    const abortController = new AbortController();
    controller.current = abortController;
    let mediaId;
    try {
      const uploadFile = purpose === 'profile' ? await cropImage(selectedFile, cropZoom) : selectedFile;
      const { resourceType } = await validateMediaFile(uploadFile, purpose);
      const signed = await mediaApi.signature(purpose, resourceType);
      mediaId = signed.media?.id;
      if (
        !mediaId ||
        !signed.upload?.apiKey ||
        !signed.upload?.cloudName ||
        !Number.isInteger(signed.upload?.timestamp) ||
        !signed.upload?.signature ||
        !signed.upload?.uploadUrl ||
        !signed.upload?.publicId ||
        !Array.isArray(signed.upload?.allowedFormats) ||
        signed.upload.resourceType !== resourceType ||
        !Number.isInteger(signed.upload.maxBytes)
      ) {
        throw new Error('The API returned an incomplete upload signature.');
      }
      const uploadUrl = new URL(signed.upload.uploadUrl);
      if (
        uploadUrl.protocol !== 'https:' ||
        uploadUrl.hostname !== 'api.cloudinary.com' ||
        uploadUrl.pathname !== `/v1_1/${signed.upload.cloudName}/${resourceType}/upload`
      ) {
        throw new Error('The API returned an invalid Cloudinary upload endpoint.');
      }
      if (uploadFile.size > signed.upload.maxBytes) {
        throw new Error(`This file exceeds the ${Math.round(signed.upload.maxBytes / 1024 / 1024)} MB upload limit.`);
      }
      const uploaded = await uploadFileToCloudinary(signed.upload, uploadFile, {
        signal: abortController.signal,
        onProgress: setProgress,
      });
      if (
        uploaded?.public_id !== signed.upload.publicId ||
        uploaded?.resource_type !== resourceType ||
        typeof uploaded?.secure_url !== 'string' ||
        !uploaded.secure_url.startsWith(`https://res.cloudinary.com/${signed.upload.cloudName}/`)
      ) {
        throw new Error('Cloudinary returned an asset that did not match the signed upload.');
      }
      const confirmed = await mediaApi.confirm(mediaId);
      if (confirmed.media?.status !== 'ready') {
        throw new Error('The API did not confirm the uploaded media.');
      }
      setMedia(confirmed.media);
      onReady?.(confirmed.media);
    } catch (reason) {
      if (mediaId) {
        try {
          await mediaApi.remove(mediaId);
        } catch (cleanupError) {
          setError(`${reason.message || 'Media upload failed.'} Cleanup also failed: ${cleanupError.message}`);
          setBusy(false);
          controller.current = null;
          return;
        }
      }
      if (reason?.name !== 'AbortError') {
        const code = reason?.code ? ` (${reason.code})` : '';
        setError(`${reason.message || 'Media upload failed.'}${code}`);
      }
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }

  async function selectFile(next) {
    if (busy || disabled) return;
    if (media?.id) {
      try {
        await mediaApi.remove(media.id);
        onReady?.(null);
      } catch (reason) {
        setError(`Could not remove the previous upload: ${reason.message}`);
        return;
      }
    }
    setFile(next);
    setMedia(null);
    setProgress(0);
    setError('');
    setCropZoom(1);
    if (next) {
      if (purpose === 'profile') {
        try {
          await validateMediaFile(next, purpose);
        } catch (reason) {
          setFile(null);
          setError(reason.message || 'Choose a supported profile photo.');
        }
      } else {
        await upload(next);
      }
    }
  }

  async function chooseFile(event) {
    await selectFile(event.target.files?.[0] ?? null);
    event.target.value = '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) void selectFile(droppedFile);
  }

  function cancel() {
    controller.current?.abort();
  }

  async function removeUpload() {
    if (!media?.id || busy) return;
    setBusy(true);
    setError('');
    try {
      await mediaApi.remove(media.id);
      setMedia(null);
      setFile(null);
      setProgress(0);
      setCropZoom(1);
      onReady?.(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (reason) {
      setError(reason.message || 'Could not remove the upload.');
    } finally {
      setBusy(false);
    }
  }

  function cancelPhotoChange() {
    setFile(null);
    setProgress(0);
    setCropZoom(1);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  return <div className="media-uploader">
    <input
      ref={fileInput}
      type="file"
      accept={acceptByPurpose[purpose]}
      hidden
      disabled={disabled || busy}
      onChange={chooseFile}
    />
    <div
      className={`media-uploader-preview${dragging ? ' is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); if (!disabled && !busy) setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      {media?.resourceType === 'video'
        ? <video src={media.secureUrl} poster={media.thumbnailUrl} controls preload="metadata" />
        : media?.secureUrl
          ? <img src={media.thumbnailUrl || media.secureUrl} alt="Selected media preview" />
          : purpose === 'profile' && preview
            ? <div className="profile-crop-preview"><img src={preview} alt="Cropped profile photo preview" style={{ transform: `scale(${cropZoom})` }} /></div>
            : purpose === 'profile' && currentImageUrl
              ? <img src={currentImageUrl} alt="Current profile photo" />
            : preview
              ? <img src={preview} alt="Selected media preview" />
              : <p>{purpose === 'reel' ? 'Choose an MP4 or MOV video' : 'Choose a JPEG, PNG, or WebP image'}</p>}
    </div>
    {purpose === 'profile' && file && !media && <label className="profile-crop-zoom">
      Crop zoom
      <input type="range" min="1" max="3" step="0.05" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} aria-label="Crop zoom" />
    </label>}
    <div className="media-uploader-actions">
      <button type="button" className="button button--outline" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
        {file ? 'Choose another file' : 'Choose media'}
      </button>
      {busy && <button type="button" className="text-link" onClick={cancel}>Cancel upload</button>}
      {purpose !== 'profile' && file && !busy && !media && <button type="button" className="text-link" onClick={() => upload()}>Retry</button>}
      {purpose === 'profile' && file && !busy && !media && <button type="button" className="button button--primary" onClick={() => upload()}>Upload photo</button>}
      {purpose === 'profile' && file && !busy && !media && <button type="button" className="text-link" onClick={cancelPhotoChange}>Cancel photo change</button>}
      {media && !busy && <button type="button" className="text-link" onClick={removeUpload}>Remove upload</button>}
      {busy && <span role="status">Uploading… {progress}%</span>}
    </div>
    {busy && <progress max="100" value={progress} aria-label="Upload progress" />}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

async function cropImage(file, zoom) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const cropSize = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 800;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the profile photo crop.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, 800, 800);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result
        ? resolve(result)
        : reject(new Error('Could not encode the cropped profile photo.')), 'image/jpeg', 0.9);
    });
    return new File([blob], 'profile-photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
