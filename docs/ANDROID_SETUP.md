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

Start the backend on port 4000 and select the `emulatorDebug` build variant.
Its centralized `BuildConfig.API_BASE_URL` defaults to
`http://10.0.2.2:4000/api/v1/`. `10.0.2.2` is the Android emulator's special
host route; `localhost` inside the emulator is the emulator itself.

Build it from PowerShell with:

```powershell
.\gradlew.bat :app:assembleEmulatorDebug
```

Cleartext traffic is enabled only in the debug manifest variant for this local
development URL. Release builds reject cleartext traffic.

## Physical device networking

Select the `deviceDebug` build variant. The device variant has no fallback API
host, so the build fails fast unless the computer's current LAN IPv4 is
configured. The phone must use the computer's LAN address, never its own IP or
`10.0.2.2`.

```powershell
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' |
  Sort-Object RouteMetric |
  Select-Object -First 1
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex |
  Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $lanIp) { throw 'No LAN IPv4 address found on the active network adapter.' }
Write-Host "Using computer LAN IPv4: $lanIp"
.\gradlew.bat :app:assembleDeviceDebug "-PcliqheartDeviceApiBaseUrl=http://$($lanIp):4000/api/v1/"
```

To run from Android Studio, place the same property in the user's
`%USERPROFILE%\.gradle\gradle.properties` (not a committed project file),
updating the address when the computer's DHCP lease changes:

```properties
cliqheartDeviceApiBaseUrl=http://<COMPUTER-LAN-IP>:4000/api/v1/
```

Both URLs must end with `/` for Retrofit. Keep the computer and phone on the
same trusted Wi-Fi network. Do not expose the development server on a public
network. The native Android client does not use browser CORS; backend
`ANDROID_DEV_ORIGIN` is an optional CORS origin and does not set the API URL or
server bind address.

### Windows connectivity checks

Run these commands on the development computer:

```powershell
Get-NetIPAddress -AddressFamily IPv4 -Type Unicast |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Format-Table InterfaceAlias,IPAddress,PrefixLength
netstat -ano | findstr :4000
Invoke-RestMethod http://localhost:4000/api/v1/health
Get-NetConnectionProfile | Format-Table InterfaceAlias,NetworkCategory
Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow |
  Get-NetFirewallPortFilter |
  Where-Object { $_.Protocol -eq 'TCP' -and $_.LocalPort -eq '4000' }
```

The listener should show `0.0.0.0:4000` or the computer's LAN address, and the
health response should report API status and database status separately. From
the phone, open `http://<COMPUTER-LAN-IP>:4000/api/v1/health` in its browser.
If the phone cannot load it, check that both devices are on the same Wi-Fi,
that the network profile is Private, and that VPN, guest Wi-Fi, or client
isolation is not blocking peer traffic.

If no matching inbound allow rule exists, add only a private-network rule from
an elevated PowerShell session; do not disable Windows Firewall:

```powershell
New-NetFirewallRule -DisplayName 'CliQHeart API 4000 (Private)' -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private
```

## Release API URL

The release URL defaults to `https://cliqheart.onrender.com/api/v1/`. To target a
different production service, configure its HTTPS URL before producing a
release build:

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

Instrumentation tests require an available emulator or attached device. Sign
Up and Log In call the real backend endpoints. Authentication success is
shown only after a successful server response; unavailable-network errors
offer a retry action.
