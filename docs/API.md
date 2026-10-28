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

## Authenticated user endpoints

### `GET /api/v1/users/me`

Returns the authenticated user's public profile fields (`id`, `username`,
`displayName`, `bio`, and `avatarUrl`). Email and account internals are not
returned by this endpoint.

### `PATCH /api/v1/users/me`

Updates one or more of `username`, `displayName`, `bio`, and `avatarUrl`.
Unknown fields are rejected. Username conflicts return `409`; invalid profile
data returns `400`. `avatarUrl` accepts an HTTP(S) URL only. This phase has no
binary image-upload or object-storage integration.

### `GET /api/v1/users/search?q=<text>&limit=<n>&after=<username>`

Searches active users by escaped username or display name, excluding the
authenticated user. Query text must contain 2–80 characters; page size is
1–50 (default 30). Results are ordered by username and include `nextCursor`
when another page is available. Private email and account status are excluded.

### `GET /api/v1/users/:userId`

Returns an active user's public profile, real follower/following counts, and
whether the authenticated viewer follows that user. Email and other private
fields are excluded.

### `POST /api/v1/users/:userId/follow` and `DELETE /api/v1/users/:userId/follow`

Follow or unfollow an active user. Self-following is rejected. Responses return
the confirmed following state; repeated requests are safe.

### `GET /api/v1/users/:userId/followers` and `/following`

Return real public users in pages of 1–50 entries (default 30). Pass the
returned `nextCursor` as `after` to fetch the next page.

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

Conversation, message, and follow collections are created by Mongoose when the
backend connects to MongoDB. Existing user collections require no migration.
Profile-photo upload, posts, Reels, highlights, and tagged-post APIs are not
implemented in this backend yet.
The Android Create screen keeps the selected photo and caption in place but
does not claim that a post was published. Feed, post interactions, and activity
feed APIs are also not implemented.

## Status codes and errors

- `200`: API identity or ready health response.
- `400`: malformed JSON or invalid request payload.
- `404`: unknown route.
- `429`: request rate limit exceeded.
- `500`: unexpected server error, returned without internals.
- `503`: readiness dependency unavailable.
- `401`: missing, invalid, expired, or inactive-account access token.
- `409`: profile username is already in use.
