# Architecture

## Android

The Android app is a native Kotlin application with XML layouts and Material
components. `MainActivity` owns a Navigation Component host; feature fragments
own screen interactions and use ViewBinding. `WelcomeViewModel` publishes the
API health-check state through lifecycle-aware LiveData. Authentication
placeholders validate input locally only and discard the password after an
accepted form; they do not call an account endpoint or persist credentials.

`core/network` holds the Retrofit service, its time-bounded OkHttp client, and
the health repository. `BuildConfig.API_BASE_URL` is set per Android build
variant: debug targets the emulator host by default; release uses a reserved
`.invalid` HTTPS URL until a real service URL is supplied through a Gradle
property. API health requests run through Retrofit's suspend API and
`viewModelScope`. `core/security` provides AES-GCM token storage backed by
Android Keystore; its shared-preference ciphertext is excluded from Android
backup and device transfer. MongoDB configuration never appears in Android
code.

The main shell declares Home, Discover, Create, Activity, and Profile tab
placeholders. It is not reached through a fake login flow and contains no fake
user or social content.

## Backend

The backend is an independent TypeScript project in `backend/`. Configuration
is parsed in `src/config`, MongoDB lifecycle is contained in `src/db`, models
are in `src/models`, and Express composition and versioned HTTP routes are
contained in `src/app.ts`. `src/server.ts` owns process startup and shutdown.
Tests use Node's test runner and Supertest without production credentials.
Validated environment configuration includes explicit CORS origins and
authentication-ready access/refresh token settings. JWT secrets are optional
until authentication is implemented; when configured, they must be distinct
and at least 32 characters. Phase 0 does not issue tokens. The User profile
validator and draft-building service are internal extension points only; they
do not persist a new account or expose a public User endpoint.

## Data flow and trust boundaries

Android -> versioned HTTPS API -> Express validation and middleware -> service
and Mongoose model -> MongoDB Atlas. The mobile app only knows the API URL; it
does not connect to MongoDB. Server-side secrets are loaded from the backend's
ignored `.env` file and must not be logged or returned.

## Extension points

Future work can add authentication, media, feed, messaging, moderation, and
notification modules behind authenticated API boundaries. Phase 0 deliberately
does not add routes that mutate user data without authentication and
authorization.
