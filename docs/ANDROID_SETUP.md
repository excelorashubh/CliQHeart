# Android setup

## Requirements

- Android Studio with a Gradle-compatible JDK.
- Android SDK Platform 37 (as configured by the current project).
- An emulator or an Android device with USB debugging enabled for
  instrumentation tests.

Open the repository root in Android Studio and let Gradle sync. The launcher is
the native Android application in `app/`; the application ID is
`com.cliqheart.app`.

## Emulator API networking

Start the backend on port 4000 and run a debug build. Its default base URL is
`http://10.0.2.2:4000/api/v1/`. `10.0.2.2` is the Android emulator's special
host route; `localhost` inside the emulator is the emulator itself.

Cleartext traffic is enabled only in the debug manifest variant for this local
development URL. Release builds reject cleartext traffic.

## Physical device networking

Connect the device and development computer to a trusted network. Find the
computer's reachable LAN address, allow inbound development traffic on port
4000 through the local firewall, and build with that address:

```powershell
.\gradlew.bat :app:assembleDebug "-PcliqheartDevApiBaseUrl=http://<LAN-IP>:4000/api/v1/"
```

Use a private LAN; do not expose the development server or an unauthenticated
API on a public network. Return to the emulator default when switching back to
the emulator.

## Release API URL

The release URL defaults to `https://api.example.invalid/api/v1/`, a reserved
placeholder that cannot accidentally point at a real service. Configure a real
HTTPS API before producing a release build:

```powershell
.\gradlew.bat :app:assembleRelease "-PcliqheartApiBaseUrl=https://<your-api-host>/api/v1/"
```

Never put database credentials, signing keys, or server secrets in Gradle
properties committed to source or inside the APK.

## Build and tests

```powershell
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:connectedDebugAndroidTest
```

Instrumentation tests require an available emulator or attached device. The
welcome, login, and registration screens are Phase 0 previews; successful
form validation does not make an account or authenticate a user.
