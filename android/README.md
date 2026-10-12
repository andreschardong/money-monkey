# Money Monkey for Android

A native Android client for the Money Monkey server, in Kotlin with Jetpack Compose. It signs in the same two ways
as the website (a one-time email link, or a passkey) and reads the same API. The screens are being written as a
learning project; see [LEARNING.md](LEARNING.md).

## Set-up

1. Install Android Studio and open the `android/` folder (not the repository root).
2. Create `android/local.properties` (it is not committed):

   ```properties
   sdk.dir=C\:\\Users\\you\\AppData\\Local\\Android\\Sdk
   moneymonkey.host=moneymonkey.example.com
   ```

   `moneymonkey.host` is the server the app talks to. Sign-in links to that host open the app, and its passkeys
   work in the app once the server trusts the app (next section).
3. Run the `app` configuration on an emulator or a phone (Android 9 or newer).

From a terminal: `.\gradlew.bat :app:assembleDebug` builds `app/build/outputs/apk/debug/app-debug.apk`, and
`.\gradlew.bat :app:testDebugUnitTest` runs the unit tests.

## Letting the server trust the app

Passkeys and sign-in links are tied to the server's domain. Android only lets an app use them when the domain says
so, in `https://<host>/.well-known/assetlinks.json`, which lists the app's package name and the SHA-256 fingerprint
of the certificate it is signed with. The server builds that file from one setting:

```text
FOLIO_ANDROID_APPS=com.andreschardong.moneymonkey=AA:BB:...:FF
```

(`Auth__AndroidApps` in the cloud; several fingerprints comma-separated, for example debug and release.)

1. Find the fingerprint. Debug builds are signed with the debug key Android Studio creates on first build:

   ```powershell
   keytool -list -v -keystore $env:USERPROFILE\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

   Copy the `SHA256:` line.
2. Put it in `.env` as `FOLIO_ANDROID_APPS`, then publish the server (`deploy\azure\deploy.ps1`) so
   `https://<host>/.well-known/assetlinks.json` lists it.
3. On the phone or emulator, have Android check the links again:

   ```powershell
   adb shell pm verify-app-links --re-verify com.andreschardong.moneymonkey
   adb shell pm get-app-links com.andreschardong.moneymonkey
   ```

   The domain should show `verified`. From then on a sign-in link opens the app, and **Account → Add a passkey**
   creates a passkey that also works on the website (same domain).

Each computer has its own debug key, so a second development machine adds its fingerprint to the same setting.

## How it's built

| Part | Where |
| --- | --- |
| API client (OkHttp, kotlinx.serialization; amounts as `BigDecimal`) | `data/ApiClient.kt`, `data/Models.kt`, `data/Json.kt` |
| Session cookie kept across restarts | `data/SessionCookieJar.kt` |
| Email links and passkeys (Credential Manager) | `auth/AuthRepository.kt` |
| Object wiring | `AppContainer.kt` |
| Sign-in, Account, navigation | `ui/signin`, `ui/account`, `ui/MoneyMonkeyRoot.kt` |
| Overview data | `ui/overview/OverviewViewModel.kt` |
| Your screens | `ui/overview/OverviewScreen.kt` and onwards, per [LEARNING.md](LEARNING.md) |

The build uses AGP 9 with its built-in Kotlin support (no `org.jetbrains.kotlin.android` plugin), Kotlin 2.4,
Compose with Material 3, and Gradle 9.8 through the wrapper. Versions live in `gradle/libs.versions.toml`.
