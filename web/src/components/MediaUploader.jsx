import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaApi } from '../services/api.js';
import { uploadFileToCloudinary, validateMediaFile } from '../services/cloudinaryUpload.js';

const acceptByPurpose = {
  profile: 'image/jpeg,image/png,image/webp',
  post: 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime',
  story: 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime',
  reel: 'video/mp4,video/quicktime',
};

export function MediaUploader({ purpose, onReady, disabled = false }) {
  const [file, setFile] = useState(null);
  const [media, setMedia] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
      const { resourceType } = await validateMediaFile(selectedFile, purpose);
      const signed = await mediaApi.signature(purpose, resourceType);
      mediaId = signed.media?.id;
      if (
        !mediaId ||
        !signed.upload?.signature ||
        !signed.upload?.uploadUrl ||
        signed.upload.resourceType !== resourceType ||
        !Number.isInteger(signed.upload.maxBytes)
      ) {
        throw new Error('The API returned an incomplete upload signature.');
      }
      if (selectedFile.size > signed.upload.maxBytes) {
        throw new Error(`This file exceeds the ${Math.round(signed.upload.maxBytes / 1024 / 1024)} MB upload limit.`);
      }
      await uploadFileToCloudinary(signed.upload, selectedFile, {
        signal: abortController.signal,
        onProgress: setProgress,
      });
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
      if (reason?.name !== 'AbortError') setError(reason.message || 'Media upload failed.');
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }

  async function chooseFile(event) {
    const next = event.target.files?.[0] ?? null;
    if (media?.id) {
      try {
        await mediaApi.remove(media.id);
        onReady?.(null);
      } catch (reason) {
        setError(`Could not remove the previous upload: ${reason.message}`);
        event.target.value = '';
        return;
      }
    }
    setFile(next);
    setMedia(null);
    setProgress(0);
    setError('');
    if (next) await upload(next);
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
      onReady?.(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (reason) {
      setError(reason.message || 'Could not remove the upload.');
    } finally {
      setBusy(false);
    }
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
    <div className="media-uploader-preview">
      {media?.resourceType === 'video'
        ? <video src={media.secureUrl} poster={media.thumbnailUrl} controls preload="metadata" />
        : media?.secureUrl || preview
          ? <img src={media?.thumbnailUrl || media?.secureUrl || preview} alt="Selected media preview" />
          : <p>{purpose === 'reel' ? 'Choose an MP4 or MOV video' : 'Choose a JPEG, PNG, or WebP image'}</p>}
    </div>
    <div className="media-uploader-actions">
      <button type="button" className="button button--outline" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
        {file ? 'Choose another file' : 'Choose media'}
      </button>
      {busy && <button type="button" className="text-link" onClick={cancel}>Cancel upload</button>}
      {file && !busy && !media && <button type="button" className="text-link" onClick={() => upload()}>Retry</button>}
      {media && !busy && <button type="button" className="text-link" onClick={removeUpload}>Remove upload</button>}
      {busy && <span role="status">Uploading… {progress}%</span>}
    </div>
    {busy && <progress max="100" value={progress} aria-label="Upload progress" />}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
