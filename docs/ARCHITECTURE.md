# Architecture

## Android

The Android app is a native Kotlin application with XML layouts and Material
components. `MainActivity` owns a Navigation Component host; feature fragments
own screen interactions and use ViewBinding. `ApiClient` handles authenticated
Retrofit requests, bearer-token refresh, and secure token storage. The Create
screen publishes image posts by obtaining a scoped media signature, uploading
directly to Cloudinary without forwarding the bearer token, confirming the
asset with the API, and attaching it to a post.

`core/network` holds the Retrofit service, its time-bounded OkHttp client, and
the health repository. `BuildConfig.API_BASE_URL` is set per Android build
variant: debug targets the emulator host by default; release uses a reserved
`.invalid` HTTPS URL until a real service URL is supplied through a Gradle
property. API health requests run through Retrofit's suspend API and
`viewModelScope`. `core/security` provides AES-GCM token storage backed by
Android Keystore; its shared-preference ciphertext is excluded from Android
backup and device transfer. MongoDB configuration never appears in Android
code.

The main shell includes Home, Discover, Create, Activity, and Profile tabs.
Story and Reel publishing is currently available from the web client; Android
continues to use the same bearer-authenticated API for image posts.

## Backend

The backend is an independent TypeScript project in `backend/`. Configuration
is parsed in `src/config`, MongoDB lifecycle is contained in `src/db`, models
are in `src/models`, and Express composition and versioned HTTP routes are
contained in `src/app.ts`. `src/server.ts` owns process startup and shutdown.
Tests use Node's test runner and Supertest without production credentials.
The API supports account authentication, messaging, user follows, media
uploads, posts, stories, and Reels. The website requests short-lived signed
Cloudinary uploads; the backend verifies each uploaded resource before
attaching it to a profile or published content. Cloudinary API credentials
remain in the backend environment.

## Data flow and trust boundaries

Android and web clients -> versioned HTTPS API -> Express validation and
middleware -> service and Mongoose model -> MongoDB Atlas. The web client
uploads media directly to Cloudinary only after an authenticated API request
returns a scoped signature; the backend later verifies the Cloudinary asset.
Clients do not connect to MongoDB. Server-side secrets are loaded from the
backend's ignored `.env` file and must not be logged or returned.

## Extension points

Comments, likes, bookmarks, notifications, and moderation tools remain future
work. Mutating media and content routes require authenticated access and enforce
ownership before attaching or deleting assets.
