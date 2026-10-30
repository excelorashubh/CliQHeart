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

Rotates the session refresh token and issues a new access token together with
the current public user profile; browser session restoration does not need a
second `GET /users/me` request. Native clients
send `{"refreshToken":"<refresh token>"}` and receive the replacement token in
JSON. Browser clients send the trusted-origin cookie transport header and
receive a rotated HttpOnly cookie. A session's `expiresAt` is fixed at creation
to `min(REFRESH_TOKEN_TTL, 365 days)` and is not extended by rotation. The
backend rejects expired and revoked sessions even before TTL cleanup.
Access tokens use `ACCESS_TOKEN_TTL` (15 minutes by default); expiration or
signature failures on protected routes return `401`, which allows web and
Android clients to attempt their existing refresh flow. Database and other
unexpected authentication-validation failures remain server errors.

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
The API applies a shared limit of 600 requests per IP per 15 minutes to versioned
API routes; health checks, CORS preflights, and authentication routes with
dedicated limits are excluded. Authentication and other sensitive operations
also have stricter route-specific limits: login is
limited to 10 failed attempts per 15 minutes, registration to 10 attempts per
hour, refresh to 30 failed attempts per 15 minutes, and username availability
to 30 requests per 15 minutes. Refresh checks without a supplied browser cookie
or native refresh token do not consume the refresh failure budget. Successful
login and refresh requests are excluded from failed-attempt budgets. The
limiters use the process-local express-rate-limit memory store;
if the service is scaled to multiple instances, configure a shared store before
relying on a single cluster-wide quota.

On Render, the app trusts exactly one proxy hop for client IP resolution;
local and test environments do not trust forwarded IP headers.

## Professional accounts

Users created before professional account support and new registrations remain
`PERSONAL` by default. Professional account types are `CREATOR` and `BUSINESS`;
they are account categories and do not grant system or moderation privileges.
The existing user identity, posts, messages, and follow relationships remain
attached to the same user record when its account type changes.

All professional endpoints below require the current access token. The server
uses the token subject as the owner; client-supplied owner IDs are not accepted.

- `GET /api/v1/professional/me` returns the current account type and resumable
  onboarding draft.
- `PATCH /api/v1/professional/onboarding` saves one strict step at a time:
  `type`, `category`, `profile`, or `confirmation`.
- `POST /api/v1/professional/convert` requires
  `{"confirmPublicProfile":true}` and a complete saved onboarding draft.
- `PATCH /api/v1/professional/profile` updates only validated business contact
  and display preferences. Contact details are private unless the owner enables
  `displayContactInfo`; public-profile responses never include the saved draft.
- `POST /api/v1/professional/switch-to-personal` switches the same account back
  without deleting posts or connections.
- `GET /api/v1/professional/dashboard?days=7|30|90` returns live follower,
  following, post, and reel totals with privacy-safe daily activity.
- `GET|POST|PATCH|DELETE /api/v1/professional/campaigns` lists, creates, edits,
  or deletes owner-scoped promotion drafts. Only draft campaigns are supported.

Analytics store at most one event per signed-in viewer, professional profile or
content item, and UTC day for views. Follow/unfollow events are recorded when
the corresponding relationship mutation commits. The dashboard does not
backfill historical views or follower changes; it does not claim impressions,
reach, audience demographics, or daily active users. No payment provider,
campaign approval, or ad-delivery integration is configured, so promotion
drafts do not charge, activate, or deliver ads. Raw analytics events are
automatically removed after 120 days.

## Authenticated user endpoints

### `GET /api/v1/users/me`

Returns the authenticated user's profile fields (`id`, `username`,
`displayName`, `bio`, `avatarUrl`, and account type) and real post, Reel,
follower, and following counts. Professional category and contact details are
returned only according to the professional profile's public display settings.
Email, onboarding drafts, and other account internals are not returned.

### `PATCH /api/v1/users/me`

Updates one or more of `username`, `displayName`, `bio`, and `avatarMediaId`.
Omitting `avatarMediaId` leaves the current photo unchanged. Unknown fields,
including client-supplied `avatarUrl`, are rejected. Username conflicts return
`409`; invalid profile data returns `400`. To replace a Cloudinary profile
photo, send the ID from the authenticated user's verified profile upload; the
API resolves its URL from owned media metadata. Send `avatarMediaId: null` to
intentionally remove the current profile photo. The API removes the saved
profile reference and deletes the previous Cloudinary asset only when its
stored ownership and managed-profile metadata match. A `photoCleanupWarning`
in the successful response means the profile photo was removed, but Cloudinary
asset cleanup could not be confirmed.

### `DELETE /api/v1/users/me`

Permanently deactivates the authenticated account after verifying the current
password. No account ID is accepted from the client. The API removes incoming
and outgoing follow records, revokes all refresh sessions, and removes
notifications where the account is the actor or recipient. Follower and
following counts are calculated from follow records, so removing these records
immediately updates surviving users' counts without counter arithmetic. The
user record is retained with `accountStatus: deleted`; unrelated posts,
messages, and media are not deleted. The endpoint returns `204` on success.
On MongoDB deployments with transaction support, cleanup and deactivation are
atomic. On standalone deployments, cleanup uses idempotent edge/notification
deletes before soft deletion, so a failed attempt can be retried while the
account remains active. Follow mutations also use transactions and lock both
active user records so they cannot race past account deletion.
### `GET /api/v1/users/search?q=<text>&limit=<n>&after=<username>`

Searches active users by escaped username or display name, excluding the
authenticated user. Query text must contain 2–80 characters; page size is
1–50 (default 30). Results are ordered by username and include `nextCursor`
when another page is available. Each result includes `isFollowing` for the
authenticated viewer. Private email and account status are excluded.

### `GET /api/v1/users/suggestions?limit=<n>&after=<username>`

Returns 1–50 active accounts (default 5), excluding the authenticated user and
accounts they already follow. Results are ordered by username; pass the
returned `nextCursor` as `after` to fetch the next page. Public profile fields
include `id`, `username`, `displayName`, `avatarUrl`, and a `mutualCount` with
up to two `mutualUsernames` for recommendation labels. Email and account
internals are excluded. Suggestions are not an advertising or paid placement
source.

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
  save or remove an authenticated user's private bookmark. `POST
  /api/v1/reels/:reelId/save` and `DELETE /api/v1/reels/:reelId/save` do the
  same for Reels. `GET /api/v1/users/me/saved?kind=posts|reels&limit=<n>&after=<bookmarkId>`
  returns only the current user's saved content, with a page size of 1–50.
- `GET /api/v1/users/:userId/tagged?limit=<n>&after=<tagId>` returns active
  published Posts and Reels tagging an active profile, identified by MongoDB
  ID or username. The owner may tag an active user with
  `POST /api/v1/posts/:postId/tags` or `POST /api/v1/reels/:reelId/tags`,
  each accepting `{"userId":"<user ObjectId>"}`. A user may remove their own
  tag with `DELETE /api/v1/posts/:postId/tags/me` or
  `DELETE /api/v1/reels/:reelId/tags/me`.

### Notifications

`GET /api/v1/notifications?limit=<n>&after=<notificationId>` returns the
authenticated user's paginated notification feed. `GET
/api/v1/notifications/unread-count` returns its unread count. Use
`PATCH /api/v1/notifications/:notificationId/read` or
`PATCH /api/v1/notifications/read-all` to mark notifications read. Supported
events include new followers, post tags, direct messages, likes, comments,
replies, and reposts.

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
The configured backend API key must have asset create/upload permission for the
same Cloudinary cloud; restricted keys without this permission receive an
upload denial. The backend API secret is never returned.

Accepted image formats are JPEG, PNG, and WebP. Video formats are MP4 and MOV.
Maximum sizes are 5 MiB for profile photos, 100 MiB for post/story uploads,
and 250 MiB for Reels. Reels must be no longer than 180 seconds.

- `POST /api/v1/posts` publishes an owned verified image or video with an
  optional caption. `GET /api/v1/posts?limit=<n>&after=<postId>` returns a
  cursor-paginated authenticated feed and includes `isFollowing` per author so
  the web feed can label non-followed authors accurately;
  `GET /api/v1/posts/:postId` returns a post detail;
  `GET /api/v1/users/:userId/posts` returns a user's posts; the owner can
  remove a post with `DELETE /api/v1/posts/:postId`.
- `POST /api/v1/stories` publishes a verified image or video. Stories expire
  after 24 hours. `GET /api/v1/stories` returns unexpired stories belonging
  to the authenticated user and accounts they follow. Owners can remove their
  own stories with `DELETE /api/v1/stories/:storyId`.
- `GET /api/v1/stories/:storyId` returns a visible, unexpired story.
  `POST /api/v1/stories/:storyId/view` records one authenticated viewer per
  story and returns the persisted view count and current viewer's like state.
  Only the owner can retrieve the paginated viewer list from
  `GET /api/v1/stories/:storyId/views`.
- `POST` and `DELETE /api/v1/stories/:storyId/like` persist story likes.
  `POST /api/v1/stories/:storyId/reactions` accepts one of the supported quick
  reaction emojis; `POST /api/v1/stories/:storyId/report` records an
  idempotent report. `POST /api/v1/stories/:storyId/reply` sends a
  story-associated message using the normal conversation system and requires
  `text` and an idempotency `clientMessageId`.
- `POST /api/v1/reels` publishes a verified video of up to 180 seconds.
  `GET /api/v1/reels?limit=<n>&after=<reelId>` returns the authenticated,
  cursor-paginated Reel feed with `isFollowing` per author;
  `GET /api/v1/reels/:reelId` returns a Reel detail;
  `GET /api/v1/users/:userId/reels` returns a user's Reels; owners can remove
  their own Reels with `DELETE /api/v1/reels/:reelId`.

### Likes, comments, replies, and reposts

All engagement routes require an active access token. The API derives the actor
from that token; client-supplied user IDs are not accepted.

- `POST` and `DELETE /api/v1/posts/:postId/like` and
  `/api/v1/reels/:reelId/like` add or remove the current user's like. Each
  response includes the resulting `liked` state and `likeCount`. Content feed
  and detail responses also include `likeCount`, `commentCount`, `repostCount`,
  `isLiked`, `isReposted`, and `isSaved`.
- `GET /api/v1/posts/:postId/comments?limit=<n>&after=<commentId>` and the
  matching Reel route return chronologically ordered top-level comments and
  their replies in a `comments` array, with `parentCommentId` identifying
  replies. The cursor paginates top-level comments; `limit` is 1–50 (default
  20).
- `POST /api/v1/posts/:postId/comments` and the matching Reel route accept
  `{"text":"...","parentCommentId":"<optional comment ObjectId>"}`. Text is
  trimmed and limited to 1–2200 characters. `PATCH /api/v1/comments/:commentId`
  edits the commenter's own comment. `DELETE /api/v1/comments/:commentId`
  removes the commenter's own comment and, for a top-level comment, its replies.
- `POST` and `DELETE /api/v1/comments/:commentId/like` like or unlike a
  comment or reply. The response includes the current `liked` state and
  `likeCount`.
- `POST` and `DELETE /api/v1/posts/:postId/repost` and the matching Reel route
  add or remove the current user's standard repost. Reposts are stored as
  references to the original content; profile responses identify them with
  `repostedBy` and `repostedAt` while retaining the original creator and media.

Like, repost, and bookmark writes are idempotent and backed by unique compound
indexes. Engagement mutations are rate-limited. Saved items are private: only
the authenticated owner can list them. Likes, comments, and reposts referencing
deleted content are removed when the owner deletes that content.

The Cloudinary API key is a public identifier returned with approved direct
upload signatures. `CLOUDINARY_API_SECRET` must be configured on the backend
and never in Vite environment variables, Android resources, or API responses.
Upload settings are documented in `docs/WEB_SETUP.md`; configure them in the
ignored local `backend/.env` file and in the backend deployment environment.

## Messaging endpoints

### `GET /api/v1/conversations`

Returns up to 50 authenticated-user conversations with the other participant's
public profile and latest message preview.

### `POST /api/v1/conversations`

Accepts `{"participantId":"<user ObjectId>"}` and creates or returns the
one-to-one conversation for the authenticated user and an active participant.

### `GET /api/v1/conversations/:conversationId/messages?limit=<n>&before=<message ObjectId>`

Returns the authorized conversation's messages in chronological order. The
page size is 1–100 (default 30); `before` is the oldest message ObjectId from
the current page and pages toward older messages.

### `POST /api/v1/conversations/:conversationId/messages`

Accepts `{"text":"...","clientMessageId":"<stable retry key>"}` (text is
1–4000 characters). `clientMessageId` is optional and makes retries
idempotent for that sender and conversation. The endpoint persists the message,
updates conversation metadata and the recipient's unread count, and returns the
saved message. Only participants may read or send messages.
Message sends are additionally limited to 60 requests per authenticated account
per minute; rate-limited requests return `429`.

`PATCH /api/v1/conversations/:conversationId/read` marks received messages as
read. `GET /api/v1/messages/unread-count` returns the authenticated user's
aggregate unread count.

The authenticated Socket.IO endpoint runs on the API origin at `/socket.io`
and accepts the access token in the handshake auth payload. Participants may
join only conversations they belong to. It broadcasts `conversation:created`,
`conversation:updated`, `message:new`, `message:sent`, `message:delivered`,
`message:read`, `typing:start`, `typing:stop`, and `unread:update` events.
Sockets are disconnected when their access token expires or their session is
revoked; clients refresh the session before reconnecting. Redis pub/sub via
`REDIS_URL` is required when running multiple backend instances; without it,
real-time events are local to a single backend instance.
Presence is not exposed: the account privacy model has no online-visibility
setting, so the API does not publish online status.

Conversation, message, follow, media, post, story, Reel, like, comment,
comment-like, repost, bookmark, and notification collections are created by
Mongoose when the backend connects to MongoDB. For a database that has the
legacy `bookmark_user_post_unique` index, run `npm run db:migrate-bookmark-index`
from `backend/` with the target database configured before deploying this
version. The migration creates the content-type-aware unique bookmark index
before dropping the legacy index, preserving existing saved posts while
allowing Post and Reel IDs to coexist. The command modifies database indexes;
use the intended target and normal backup/deployment procedures.

Android retains bearer-token authentication and uses the media endpoints for
image posts; story and Reel creation is currently exposed only by the website.

## Status codes and errors

- `200`: API identity or ready health response.
- `400`: malformed JSON or invalid request payload.
- `404`: unknown route.
- `429`: request rate limit exceeded.
- `500`: unexpected server error, returned without internals.
- `503`: readiness dependency unavailable.
- `401`: missing, invalid, expired, or inactive-account access token.
- `409`: profile username is already in use.
