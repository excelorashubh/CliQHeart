# API

All endpoints are under `/api/v1`. Responses are JSON. Private endpoints require
`Authorization: Bearer <accessToken>` from the login response. Access tokens are
validated for signature, issuer, audience, type, expiry, and an active account.

## `GET /api/v1`

Identifies the API, version, and the repository documentation path
(`docs/API.md`) without revealing server configuration.

## `GET /api/v1/health`

Returns readiness information: application name, API status, ISO timestamp,
runtime environment, database connectivity, and application version. The
database status is limited to a safe connected/disconnected indicator. When a
mandatory database dependency is unavailable, the endpoint returns HTTP 503.
It does not return a URI, host, username, password, IP allowlist, stack trace,
or internal path.

Example response when ready:

```json
{
  "application": "CliQHeart",
  "status": "ok",
  "timestamp": "2026-10-26T00:00:00.000Z",
  "environment": "development",
  "database": "connected",
  "version": "0.1.0"
}
```

The API root includes `application`, `apiVersion`, `documentation`, `status`,
and `version`. The timestamp is generated when the health request is handled.
The health example is illustrative and does not claim an Atlas connection is
configured.

## Authentication and sessions

### `POST /api/v1/auth/register` and `POST /api/v1/auth/login`

Both endpoints create a session and return an access token and public user
response. Native clients also receive the rotating refresh token in JSON.
Browser clients send `X-Session-Transport: cookie` from an allowed `Origin`;
the refresh token is then set only in an HttpOnly cookie and omitted from JSON.
New registrations are explicitly active; pending, suspended, deleted, and
unknown-status accounts cannot authenticate.

### `GET /api/v1/auth/username-availability?username=<username>`

Public signup helper that validates a normalized username and returns only
`{"available":true,"message":"Username available"}` or
`{"available":false,"message":"Username already exists"}`. Invalid usernames
return `400`; checks are rate limited. This result is advisory only: registration
still enforces the unique username index to prevent concurrent duplicates.

### `POST /api/v1/auth/refresh`

Rotates the session refresh token and issues a new access token. Native clients
send `{"refreshToken":"<refresh token>"}` and receive the replacement token in
JSON. Browser clients send the trusted-origin cookie transport header and
receive a rotated HttpOnly cookie. A session's `expiresAt` is fixed at creation
to `min(REFRESH_TOKEN_TTL, 365 days)` and is not extended by rotation. The
backend rejects expired and revoked sessions even before TTL cleanup.

### `POST /api/v1/auth/logout` and `POST /api/v1/auth/logout-all`

Logout revokes the active refresh session and immediately invalidates its
session-bound access tokens. Native clients send their refresh token in JSON;
browser clients use the cookie transport and the response clears the cookie.
Logout-all requires an access token and revokes every session for that user.

Browser cookie requests require `X-Session-Transport: cookie`, an exact
configured `Origin`, credentialed CORS, and HTTPS. The backend always
permits `http://localhost:5173` and `http://127.0.0.1:5173` for local
development. Its production browser origin is configured by `FRONTEND_URL`
and may also be listed in `ALLOWED_ORIGINS` (legacy `CORS_ORIGINS` remains
supported). CORS preflight permits the API methods and `Authorization`,
`Content-Type`, and `X-CSRF-Token` headers without requiring authentication.
Requests with no `Origin` remain available to native and server clients, which
still require normal authentication where applicable. The cookie is always
`HttpOnly; Secure; SameSite=None` and scoped to `/api/v1/auth`, including when
the Render service's `NODE_ENV` is accidentally left at `development`.

## Authenticated user endpoints

### `GET /api/v1/users/me`

Returns the authenticated user's public profile fields (`id`, `username`,
`displayName`, `bio`, and `avatarUrl`) and real post, Reel, follower, and
following counts. Email and account internals are not returned by this endpoint.

### `PATCH /api/v1/users/me`

Updates one or more of `username`, `displayName`, `bio`, and `avatarUrl`.
Unknown fields are rejected. Username conflicts return `409`; invalid profile
data returns `400`. `avatarUrl` accepts an HTTP(S) URL. To use a verified
Cloudinary profile image, send its owned `avatarMediaId`; the API resolves the
URL from verified media metadata and prevents reusing another account's upload.
Send `avatarMediaId: null` to remove the current profile photo.

### `GET /api/v1/users/search?q=<text>&limit=<n>&after=<username>`

Searches active users by escaped username or display name, excluding the
authenticated user. Query text must contain 2–80 characters; page size is
1–50 (default 30). Results are ordered by username and include `nextCursor`
when another page is available. Each result includes `isFollowing` for the
authenticated viewer. Private email and account status are excluded.

### `GET /api/v1/users/:userId`

Accepts an active user's MongoDB ID or username. Returns the public profile,
real post, Reel, follower, and following counts, and whether the authenticated
viewer follows that user. Email and other private fields are excluded.
Use `GET /api/v1/users/by-username/:username` when resolving a username directly,
including usernames that happen to look like a MongoDB ObjectId.

### `POST /api/v1/users/:userId/follow` and `DELETE /api/v1/users/:userId/follow`

Follow or unfollow an active user. Self-following is rejected. Responses return
the confirmed following state; repeated requests are safe.

### `GET /api/v1/users/:userId/followers` and `/following`

Return real public users in pages of 1–50 entries (default 30). Pass the
returned `nextCursor` as `after` to fetch the next page.

### Saved posts and profile tags

- `POST /api/v1/posts/:postId/save` and `DELETE /api/v1/posts/:postId/save`
  save or remove an authenticated user's private bookmark. `GET
  /api/v1/users/me/saved?limit=<n>&after=<bookmarkId>` returns only the current
  user's saved posts, with a page size of 1–50.
- `GET /api/v1/users/:userId/tagged?limit=<n>&after=<tagId>` returns active
  published posts tagging an active profile, identified by MongoDB ID or
  username. The owner of a post may add an active user with
  `POST /api/v1/posts/:postId/tags` and `{"userId":"<user ObjectId>"}`. A user
  may remove their own tag with `DELETE /api/v1/posts/:postId/tags/me`.

### Notifications

`GET /api/v1/notifications?limit=<n>&after=<notificationId>` returns the
authenticated user's paginated notification feed. `GET
/api/v1/notifications/unread-count` returns its unread count. Use
`PATCH /api/v1/notifications/:notificationId/read` or
`PATCH /api/v1/notifications/read-all` to mark notifications read. The current
supported events are new followers, post tags, and direct messages.

## Media and content endpoints

All media and content endpoints require an active access token. `POST
/api/v1/media/signature` accepts `{"purpose":"profile|post|story|reel",
"resourceType":"image|video"}` and returns a short-lived Cloudinary upload
signature, an upload URL, and the media record ID. The browser sends the file
directly to Cloudinary, then calls `POST /api/v1/media/:mediaId/confirm`.
Confirmation reads the asset from Cloudinary and checks ownership through the
server-generated public ID, resource type, format, size, and HTTPS URL. The
backend secret is never returned. `DELETE /api/v1/media/:mediaId` removes an
unattached owned upload; media still referenced by active content or a profile
cannot be deleted.

Accepted image formats are JPEG, PNG, and WebP. Video formats are MP4 and MOV.
Maximum sizes are 10 MiB for profile photos, 100 MiB for post/story uploads,
and 250 MiB for Reels. Reels must be no longer than 180 seconds.

- `POST /api/v1/posts` publishes an owned verified image or video with an
  optional caption. `GET /api/v1/posts` returns the authenticated feed;
  `GET /api/v1/posts/:postId` returns a post detail;
  `GET /api/v1/users/:userId/posts` returns a user's posts; the owner can
  remove a post with `DELETE /api/v1/posts/:postId`.
- `POST /api/v1/stories` publishes a verified image or video. Stories expire
  after 24 hours. `GET /api/v1/stories` returns unexpired stories belonging
  to the authenticated user and accounts they follow. Owners can remove their
  own stories with `DELETE /api/v1/stories/:storyId`.
- `POST /api/v1/reels` publishes a verified video of up to 180 seconds.
  `GET /api/v1/reels` returns the authenticated feed;
  `GET /api/v1/reels/:reelId` returns a Reel detail;
  `GET /api/v1/users/:userId/reels` returns a user's Reels; owners can remove
  their own Reels with `DELETE /api/v1/reels/:reelId`.

The Cloudinary API key is a public identifier returned with approved direct
upload signatures. `CLOUDINARY_API_SECRET` must be configured on the backend
and never in Vite environment variables, Android resources, or API responses.
Upload settings are documented in `backend/.env.example`.

## Messaging endpoints

### `GET /api/v1/conversations`

Returns up to 50 authenticated-user conversations with the other participant's
public profile and latest message preview.

### `POST /api/v1/conversations`

Accepts `{"participantId":"<user ObjectId>"}` and creates or returns the
one-to-one conversation for the authenticated user and an active participant.

### `GET /api/v1/conversations/:conversationId/messages?limit=<n>&before=<ISO date>`

Returns the authorized conversation's messages in chronological order. The
page size is 1–100 (default 30); `before` pages toward older messages.

### `POST /api/v1/conversations/:conversationId/messages`

Accepts `{"text":"..."}` (1–4000 characters), persists the message, and updates
the conversation's last-message timestamp. Only participants may read or send
messages. Delivery is request/response; realtime push is not implemented.

Conversation, message, follow, media, post, story, and reel collections are
created by Mongoose when the backend connects to MongoDB. Existing user
collections require no migration. Comments, likes, bookmarks, and notifications
are not implemented. Android retains bearer-token authentication and uses the
media endpoints for image posts; story and Reel creation is currently exposed
only by the website.

## Status codes and errors

- `200`: API identity or ready health response.
- `400`: malformed JSON or invalid request payload.
- `404`: unknown route.
- `429`: request rate limit exceeded.
- `500`: unexpected server error, returned without internals.
- `503`: readiness dependency unavailable.
- `401`: missing, invalid, expired, or inactive-account access token.
- `409`: profile username is already in use.
