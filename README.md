# CliQHeart

CliQHeart is a native Android social app foundation with a separately deployable
TypeScript/Express API. Phase 0 establishes the app shell, navigation, API
connectivity boundary, configuration, initial MongoDB model, and developer
workflow. It does not implement account creation, sign-in, a social feed, or
media features.

## Technology

- Android: Kotlin, XML, AndroidX, Material 3, ViewBinding, Navigation Component,
  ViewModel, Retrofit, and OkHttp.
- Backend: Node.js, TypeScript, Express, Zod, Mongoose, and MongoDB.
- Android package: `com.cliqheart.app`.

## Prerequisites

- Node.js 20 or newer and npm.
- Android Studio with a compatible JDK and Android SDK Platform 37.
- MongoDB Atlas account and a dedicated least-privilege application database
  user for a live backend connection.

The project uses the checked-in Gradle wrapper. No global Gradle installation is
required. Do not add MongoDB credentials or API secrets to Android files.

## Install and run the backend

From the repository root in PowerShell:

```powershell
Set-Location backend
npm ci
Copy-Item .env.example .env
```

Edit `backend/.env` locally with an Atlas connection URI and the database name.
The environment file is ignored by Git. Configure a new database password after
rotating any credential previously shared in chat, source, or logs. Do not use
an Atlas administrator account.

Start the development API:

```powershell
npm run dev
```

In another terminal, verify its readiness:

```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
```

Readiness reports failure when MongoDB is unavailable. It does not include
connection details. The exact required environment variables and API response
contract are described in [docs/API.md](./docs/API.md) and
[docs/DATABASE_SETUP.md](./docs/DATABASE_SETUP.md).

## Open and run Android

Open the repository root (the directory containing `settings.gradle.kts`) in
Android Studio and allow Gradle sync to finish. The debug API URL defaults to
`http://10.0.2.2:4000/api/v1/`, the emulator's route to the development host.
Run the `app` configuration on an emulator or physical device.

Build and run local checks from PowerShell:

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
```

The app's Sign Up and Log In screens are validation-only placeholders; they
never create a session or claim successful authentication. Legal documents are
explicitly marked pending. See [docs/ANDROID_SETUP.md](./docs/ANDROID_SETUP.md)
for physical-device networking and release configuration.

## Backend development commands

Run these commands from `backend\`:

```powershell
npm ci
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
```

The automated backend suite uses an isolated HTTP app and schema checks; it
does not require production Atlas credentials. Use `npm run test:watch` for
watch-mode tests.

## Project documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [API](./docs/API.md)
- [MongoDB Atlas setup](./docs/DATABASE_SETUP.md)
- [Android setup](./docs/ANDROID_SETUP.md)
- [Phase 0 checklist and limitations](./docs/PHASE_0_CHECKLIST.md)

## Troubleshooting

- **Backend exits during startup:** check required settings in `backend/.env`,
  Atlas network access, and the application user's database permissions. Never
  work around Atlas IP restrictions by opening access to all addresses.
- **Android reports the API unavailable:** start the backend and confirm
  `GET /api/v1/health` is reachable. The emulator uses `10.0.2.2`, not
  `localhost`.
- **A physical device cannot reach the API:** configure a reachable LAN address
  and allow the development port through the computer's firewall; do not use a
  public Wi-Fi network for an unprotected development API.
- **Gradle cannot find Java or the SDK:** configure Android Studio's Gradle JDK
  and Android SDK location. Keep machine-specific `local.properties`
  untracked.
