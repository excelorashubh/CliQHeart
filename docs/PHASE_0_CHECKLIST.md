# Phase 0 checklist

## Implemented

- [x] Existing Android project retained and updated to application ID
  `com.cliqheart.app`.
- [x] Kotlin, XML, Material, ViewBinding, lifecycle-aware state, and Navigation
  Component foundation configured.
- [x] Native splash branding, welcome screen, pending legal-document notice,
  login/registration placeholders, and main tab shell added.
- [x] Local form validation and unit tests added; no password is persisted or
  submitted to a fake authentication flow.
- [x] Retrofit health check uses a debug emulator URL and an HTTPS-only release
  configuration.
- [x] Backend project, environment template, versioned health/API routes,
  MongoDB model, security middleware, and automated tests added.
- [x] Root documentation, editor settings, and secret/build output ignore
  rules added.

## Verification

- [x] Android debug build and local unit tests: passed.
- [x] Backend build, typecheck, lint, dependency audit, and test suite: passed
  (21 tests; 0 failures; 0 reported production dependency vulnerabilities).
- [x] Android debug and release builds plus debug instrumentation-test APK
  compilation: passed.
- [x] Android local unit tests: passed (4 tests; 0 failures).
- [ ] Android instrumentation tests on a device: not run; no connected emulator
  or physical device was available.
- [ ] Live MongoDB Atlas connection: not verified; valid credentials and
  network allowlisting were not provided.

## Manual setup and limitations

- Rotate any previously exposed database password, create a least-privilege
  database user, configure Atlas network access, and add the new URI to
  `backend/.env`.
- Configure a real HTTPS API URL before making a release build.
- Publish actual Terms of Service and Privacy Policy before production.
- Authentication, password recovery, social content, messaging, uploads,
  notifications, and moderation remain future phases.
