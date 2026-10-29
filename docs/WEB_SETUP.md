# CliQHeart Web

The website is a separate React + JavaScript + Vite application in `web/`.
It calls the existing `/api/v1` backend directly; it does not create another
database, backend, or user account system.

## Run locally

Requirements: Node.js 20 or newer and npm.

In PowerShell:

```powershell
Set-Location web
npm install
```

The single ignored `web/.env` file is set to the production API:

```text
VITE_API_BASE_URL=https://cliqheart.onrender.com/api/v1
```

For local-backend development, change that one value to
`http://localhost:4000/api/v1`. The web client sends requests directly to the
configured API host, including during local development, so the backend must
allow `http://localhost:5173` in both CORS and its cookie-auth origin check.

Run the frontend:

```powershell
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. The backend
configuration always includes `http://localhost:5173` and
`http://127.0.0.1:5173`, and also honors production origins listed in
`ALLOWED_ORIGINS` (or the legacy `CORS_ORIGINS`). The configured
`FRONTEND_URL` is also included in the same allowlist.
Do not use wildcard origins.

For the current Render deployment, set these on the **backend API service**:

```text
NODE_ENV=production
FRONTEND_URL=https://cliqhearts.onrender.com
ALLOWED_ORIGINS=https://cliqhearts.onrender.com,http://localhost:5173,http://127.0.0.1:5173
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=365d
```

The backend accepts the legacy `CORS_ORIGINS` variable for existing
deployments, but `ALLOWED_ORIGINS` takes precedence. The frontend build should
use `VITE_API_BASE_URL=https://cliqheart.onrender.com/api/v1`.
For media uploads, configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
and `CLOUDINARY_API_SECRET` on the backend only. The API key is returned with
short-lived, purpose-scoped upload signatures; the API secret must never be
added to a `VITE_*` variable or browser bundle. Cloudinary settings are
optional for auth and messaging, but uploads return a clear service error until
they are configured. The key must belong to the configured cloud and permit
asset creation/uploads for signed browser uploads; keep its permissions scoped
to the minimum required and do not grant account-administration access.

For the Render backend, set `CLOUDINARY_CLOUD_NAME=dapomdxat`,
`CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in the service's Environment
settings using credentials from the same Cloudinary account. Save the changes
and redeploy or restart the backend. Keep the API secret in Render's backend
environment only; do not put credentials in the frontend or deployment logs.

## Build and static deployment

From `web\`:

```powershell
npm run test
npm run build
npm run preview
```

Deploy the contents of `web/dist/` to a static host. Configure
`VITE_API_BASE_URL` as a build-time environment variable. Static builds call the configured API directly, so the production backend must
allow the exact deployed website origin in `CORS_ORIGINS`. Configure SPA
fallback/rewrite rules so application paths such as `/profile/<id>` and
`/messages/<id>` serve `index.html`. For the CliQHeart Render static site, add a
Dashboard rewrite rule with Source `/*`, Destination `/index.html`, and Action
`Rewrite`. The deployed website currently returns HTTP 404 for direct requests
to `/professional/dashboard` until this rule is in place. Redeploy the backend
API after changes to `backend/src/modules/professional/` so its
`/api/v1/professional/*` routes are available. Add the site's exact origin to
backend `CORS_ORIGINS`. Never put backend secrets in Vite environment variables; every
`VITE_*` value is visible to browser users.

## Authentication notes

The website uses short-lived in-memory access tokens and an HttpOnly refresh
cookie. It sends `X-Session-Transport: cookie` on login, registration, refresh,
and logout; cookies are never read by JavaScript. The provider restores the
session during startup from the user profile returned with the refresh response,
before protected routing, and retries a protected request at most once after a
shared refresh. Temporary network, server, and rate-limit failures retain the
cookie and show a recoverable retry state that respects `Retry-After`.

The Android client uses the same refresh-session records with bearer refresh
tokens encrypted by its Android Keystore-backed store. Refresh rotation replaces
the stored credential; simultaneous requests share one synchronized refresh.
Logout clears local credentials immediately and keeps an encrypted pending
revocation token for retry on the next launch if the network is unavailable.

The backend sets an immutable `expiresAt` no later than 365 days after session
creation. `REFRESH_TOKEN_TTL` can shorten this period but is capped at 365 days;
set it to `365d` in Render to meet the full product lifetime. Access tokens
include a session ID and are rejected after that session is revoked. Session
expiry is checked in application queries; MongoDB TTL is cleanup only.

Browser cookie auth requires HTTPS, credentialed CORS, and exact frontend
origins. Set Render `FRONTEND_URL` and `ALLOWED_ORIGINS` to the values above. Production
uses `Secure; HttpOnly; SameSite=None` independently of `NODE_ENV` because the
API and website may be on different sites. Browser privacy settings can block third-party cookies;
for reliable production login persistence, deploy the API on a same-site custom
domain or reverse proxy it under the website origin.

Messaging uses an authenticated Socket.IO connection on the configured API
origin in addition to the authenticated REST API. It renews the short-lived
access token using the existing HttpOnly refresh cookie when the socket token
expires; logout, logout-all, and account deletion disconnect affected sockets.
Configure `REDIS_URL` (`redis://` or `rediss://`) when the backend runs multiple
instances so message, read, and conversation events reach clients connected to
other instances. Without Redis, keep the backend to one instance for realtime
delivery. Persisted messages and unread/read state remain available through REST
after a reconnect.

Registration now creates the active account and session in one onboarding flow;
the browser and Android navigate into the app only after session creation
returns a valid access token and user profile. Production Terms of Service and
Privacy Policy URLs must still be supplied by the product before launch. Users
holding refresh tokens created by the old seven-day format must sign in once after deployment; old
tokens are not persisted in plaintext or scanned across the sessions table.

The reported inactive-account issue was checked against registration, the
model default, and login authorization. Current new registrations explicitly
persist `accountStatus: "active"`; login still rejects pending, suspended,
deleted, and unknown states. Existing pending accounts are not automatically
activated. No account data migration or status bypass was made.

## Implemented backend integration

The website reuses:

- `POST /auth/register`, `POST /auth/login`
- `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`
- `GET /users/me`, `PATCH /users/me`
- `GET /users/search`, `GET /users/:userId`
- `POST` and `DELETE /users/:userId/follow`
- `GET /users/:userId/followers` and `/following`
- `GET` and `POST /conversations`
- `GET` and `POST /conversations/:conversationId/messages`
- `PATCH /conversations/:conversationId/read`, `GET /messages/unread-count`
- `POST /media/signature`, `POST /media/:mediaId/confirm`, and `DELETE /media/:mediaId`
- post, story, and Reel publishing and feed endpoints

The client-side routes include `/`, `/login`, `/signup` (also `/register`),
`/search` (the legacy `/explore` and `/discover` URLs redirect here),
`/profile`, `/profile/:userId`,
`/profile/edit`, `/messages`, `/messages/:conversationId`, `/settings`,
`/create`, `/post/:postId`, `/reels`, `/notifications`,
`/professional/onboarding`, `/professional/dashboard`, and
`/professional/promotions`. `/professional` redirects to the dashboard route
for professional accounts and to setup for personal accounts. Routes requiring
an account redirect signed-out visitors to `/login`. Create supports posts,
24-hour stories, and short Reels. Uploads are signed by the API and sent
directly from the browser to Cloudinary; the backend verifies the uploaded
asset before it can be attached to a profile or published.

Messaging is request/response. There is no realtime transport, read/unread
state, or notification API. Message lists refresh when opened or manually
refreshed; the website does not describe this as realtime.

## Media and content features

The backend implements authenticated Cloudinary media signing, asset
confirmation and owner deletion, profile-photo uploads, post and story
publishing, and Reels. Supported images are JPEG, PNG, and WebP; videos are MP4
and MOV. Upload limits are enforced again against Cloudinary's resource
metadata: 5 MiB for profile photos, 100 MiB for posts and stories, and 250
MiB for Reels. Reels are limited to 180 seconds, and stories expire after 24
hours. Unattached uploads can be deleted from the upload UI; content-attached
media cannot be deleted independently.

The Search page's Explore section and Home feed load real authenticated API
responses. Empty states reflect actual API results, and errors can be retried;
the browser does not show fabricated posts or claim a failed publish succeeded.
Notifications, comments, likes, and bookmarks are not implemented.

The Android client still uses bearer-token authentication and remains
compatible with the existing API. Its Create screen can publish image posts
through the same signed-upload and server-confirmation flow; story and Reel
creation is currently available from the website.

The backend search response adds `isFollowing` as an additive public field;
existing Android clients can ignore it without a contract change.

The frontend test suite runs with `npm run test`; tests stub the API base to a
reserved `.invalid` hostname and mock network responses. Tests do not depend on
the local `.env` file and never authenticate against a production service.
