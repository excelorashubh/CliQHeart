# Stories Cold-Launch Diagnostics

Date: 2026-10-31

## Result

The exact runtime point where Stories disappear is **not determined**. No authenticated cold launch or live MongoDB comparison was possible, so no production root cause or fix is claimed.

## Runtime evidence

| Stage | Result |
|---|---|
| Android request ID | Not collected |
| Android HTTP status / response count | Not collected |
| Backend authentication / request log | Not collected |
| Backend matched unexpired Stories | Not collected |
| Backend owner/media exclusions | Not collected |
| Backend serialized response count | Not collected |
| Android mapped Story count | Not collected |
| Android rendered tile/record count | Not collected |
| MongoDB Story / Follow / ready Media counts | Not collected |
| Cold-launch acceptance test | Not run |

No live Android or backend log entries are included because none were generated. No access tokens, account identifiers, Story identifiers, or media URLs were collected.

## Environment and validation

- `:app:testEmulatorDebugUnitTest :app:assembleEmulatorDebug`: passed.
- Android unit tests: 12 passed, 0 failed.
- Backend `npm run typecheck`: passed.
- Backend `npm test`: 130 passed, 0 failed.
- Backend Stories route test uses mocked model records; it validates the API contract, not production MongoDB data.
- `adb devices -l` showed no connected device. The available `Pixel_8a` AVD remained offline after a 120-second boot attempt. The app was not installed or launched.
- No authenticated live backend/database session was available.

## Instrumentation added

The Android client logs request start, HTTP status, response record count, mapped record/owner counts, and empty-state reason/visibility. The backend logs `stories_feed_counts` with its request ID, followed-owner count, matched unexpired Story count, owner/media serialization exclusions, and final serialized count. These events contain counts and a correlation request ID only.

The backend route currently queries Stories for the authenticated viewer plus followed owners and future `expiresAt`; serialization excludes records without an active owner or ready media. Existing schema indexes remain unchanged. No Redis cache or queue changes were made because there is no evidence they address the observed data loss.

## Next required evidence

Install this build on a booted device with the authenticated test account and collect the Android `GET /stories` events plus the matching backend `http_request` and `stories_feed_counts` events. Compare those counts with sanitized MongoDB counts for active own/followed Stories, Follow edges, and ready media to locate the first stage where records disappear.
