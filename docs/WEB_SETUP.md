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
FRONTEND_URL=https://cliqhearts.onrender.com
ALLOWED_ORIGINS=https://cliqhearts.onrender.com,http://localhost:5173,http://127.0.0.1:5173
REFRESH_TOKEN_TTL=365d
```

The backend accepts the legacy `CORS_ORIGINS` variable for existing
deployments, but `ALLOWED_ORIGINS` takes precedence. The frontend build should
use `VITE_API_BASE_URL=https://cliqheart.onrender.com/api/v1`.
`backend/.env.example` contains only non-secret browser-origin settings.

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
`/messages/<id>` serve `index.html`. Add the site's exact origin to backend
`CORS_ORIGINS`. Never put backend secrets in Vite environment variables; every
`VITE_*` value is visible to browser users.

## Authentication notes

The website uses short-lived in-memory access tokens and an HttpOnly refresh
cookie. It sends `X-Session-Transport: cookie` on login, registration, refresh,
and logout; cookies are never read by JavaScript. The provider refreshes the
session during startup before protected routing, verifies `/users/me`, and
retries a protected request at most once after a shared refresh. Temporary
network failures retain the cookie and show a retry state rather than treating
cached profile data as authenticated.

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

Registration now creates the active account and session in one onboarding flow;
the browser and Android navigate into the app only after session creation and
profile validation. Production Terms of Service and Privacy Policy URLs must
still be supplied by the product before launch. Users holding refresh tokens
created by the old seven-day format must sign in once after deployment; old
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

The client-side routes include `/`, `/login`, `/signup` (also `/register`),
`/search` (the legacy `/explore` and `/discover` URLs redirect here),
`/profile`, `/profile/:userId`,
`/profile/edit`, `/messages`, `/messages/:conversationId`, `/settings`,
`/create`, `/post/:postId`, `/reels`, and `/notifications`. Routes requiring an
account redirect signed-out visitors to `/login`.

Messaging is request/response. There is no realtime transport, read/unread
state, or notification API. Message lists refresh when opened or manually
refreshed; the website does not describe this as realtime.

## Backend-dependent features not yet available

The current backend does not implement a posts/feed retrieval endpoint,
comments, likes, bookmarks,
stories, profile-photo upload, Reels/video processing, notifications, or
publishing. Those pages state the limitation and do not display fabricated
content or claim an unsupported operation succeeded. Profile photos can only
be set to an existing public HTTP(S) image URL through the current profile
update endpoint.

The Search page uses the authenticated user-search endpoint and shows the
Explore empty state until a real posts/feed endpoint is added. It does not
request made-up routes or display placeholder media. The user-search response
includes the viewer's follow state alongside each public profile.

The backend search response adds `isFollowing` as an additive public field;
existing Android clients can ignore it without a contract change.

The frontend test suite runs with `npm run test`; tests stub the API base to a
reserved `.invalid` hostname and mock network responses. Tests do not depend on
the local `.env` file and never authenticate against a production service.
