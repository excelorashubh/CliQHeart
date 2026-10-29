export function getReelPath(reelId) {
  return `/reels/${encodeURIComponent(reelId)}`;
}

export function getReelUrl(reelId, origin = window.location.origin) {
  return new URL(getReelPath(reelId), origin).toString();
}
