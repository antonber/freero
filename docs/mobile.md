# Freero phone and tablet apps (iOS / iPadOS and Android)

Status: **built, unsigned, not in the stores** (#177). The shell, push notifications end to end, the
build scripts and a CI workflow producing debug / unsigned builds are in the repo. Listing the apps
needs the owner's Apple Developer Program and Google Play Console accounts, signing keys, a
Firebase project and the stores' reviews (below). Until the server is configured, nothing changes for
anyone: no push is sent and no link opens an app.

## What it is

A thin [Capacitor](https://capacitorjs.com) shell (MIT) in `apps/mobile/native` around a Freero
server's web app, the way the desktop app (`apps/desktop`, Tauri) is: the app's one web view loads the
server's web app as the server serves it — always the server's own version. Everything the web app
does on phones and tablets works the same here: editing boards, the phone layout, touch gestures,
Apple Pencil and stylus (pressure, palm rejection, hover where the device reports it — the web app's
pointer handling), offline copies (#178).

What the apps add:

- **Push notifications** for the notification types the person leaves on under Settings ›
  *Notifications on this device* (the same per-device choice as the desktop app's; on by default in
  the apps, the system asks for permission the first time). They arrive while the app is closed;
  tapping one opens its board, comment or doc. While Freero is open, the bell shows them instead.
- **Links**: `freero://board/<id>` (with `?item=` / `?thread=`), `freero://doc/<id>`, `freero://app`
  — the desktop app's links — and https links to the server's boards and docs (`/board/…`, `/doc/…`)
  once the server vouches for the apps (below). A link to any other site or page never opens in the
  app (`app/mobile/native.ts` `appPathFor`, tested).
- Freero's own icon and launch screen (`apps/mobile/icons.mjs` paints them over Capacitor's
  template from the Freero mark).

### How push works

```
device ── permission, APNs / FCM token ──▶ web app (app/notifications/push.ts)
web app ── PUT /api/mobile/push/devices { platform, token, off } ──▶ server (modules/mobile)
notification created ─▶ modules/notifications notify ─▶ (once committed) modules/mobile pushToUser
pushToUser ─▶ APNs (HTTP/2, ES256 provider token) for iOS / FCM HTTP v1 (service account) for Android
```

- A device is registered **per device and per session**: `push_devices` keeps its token with the
  account and the session it was registered in. When that session ends — signing out, "sign out
  other devices", a password reset, a session policy, an expired session — the row goes (auth's
  `onSessionEnd`, on every instance), and a session found gone when sending drops it too. Signing in
  as someone else on the device registers it for them instead.
- Each device keeps its own list of types turned off; nothing else of the person's settings changes.
- A token Apple or Google reports as dead (the app was removed, the token rotated) is forgotten.
- What is sent: the notification's headline in the person's language (for example "Ana mentioned you
  in Q3 roadmap") and the app path it opens — never the comment's text. It passes through Apple or
  Google to reach the device.
- Push is delivered in addition to the bell, Slack and the email digest (which still mails what stays
  unread).

## Building it

The native projects are committed (`apps/mobile/native/android`, `apps/mobile/native/ios`);
Capacitor itself is installed into `apps/mobile/native` at the versions its lockfile pins — not an
npm workspace, nothing joins the web app's dependencies.

```
npm run mobile:sync                                   # install Capacitor, copy the config into both projects
npm run mobile:android                                # debug APK (JDK 21 + Android SDK; ANDROID_HOME)
node apps/mobile/build.mjs android release            # release bundle (.aab), signed with the upload key if set
npm run mobile:ios                                    # unsigned simulator build (macOS + Xcode 16)
FREERO_INSTANCE_URL=https://your.freero npm run mobile:sync   # self-hosters: the server the apps open
FREERO_INSTANCE_URL=http://10.0.2.2:4000 npm run mobile:android   # an Android emulator against a local server
node apps/mobile/build.mjs icons                      # repaint the icon and launch screens
```

After `mobile:sync`, Android Studio opens `apps/mobile/native/android` and Xcode
`apps/mobile/native/ios/App/App.xcodeproj` (Swift Package Manager, no CocoaPods).

CI (`.github/workflows/mobile.yml`) builds on every change to `apps/mobile`: a debug APK (push off
without `ANDROID_GOOGLE_SERVICES_JSON`) and, once the upload key is set, the signed release bundle
on Linux, an unsigned iOS simulator build on
macOS, as workflow artifacts. A `mobile-v<version>` tag sets the version name; the build number is
the run number.

## Server configuration (the operator)

| Variable | What |
|---|---|
| `PUSH_APNS_KEY`, `PUSH_APNS_KEY_ID`, `PUSH_APNS_TEAM_ID` | The APNs auth key (.p8 contents, with `\n` for line breaks, or base64), its key ID, the Apple team ID. Turns on push to iPhones and iPads. |
| `PUSH_APNS_TOPIC` | The app's bundle ID (default `app.freero.mobile`). |
| `PUSH_APNS_SANDBOX` | `true` for development builds (Xcode-run apps get sandbox tokens). |
| `PUSH_FCM_SERVICE_ACCOUNT` | The Firebase project's service account key (JSON, or base64). Turns on push to Android. |
| `MOBILE_APPLE_APP_ID` | `<Team ID>.<bundle ID>`: serves `/.well-known/apple-app-site-association`, so https board and doc links open the iOS app. |
| `MOBILE_ANDROID_CERT_SHA256` | The SHA-256 fingerprints (comma separated) of the Android app's signing certificates (Play App Signing's *and* the upload key's): serves `/.well-known/assetlinks.json` for Android App Links. `MOBILE_ANDROID_PACKAGE` if the package isn't `app.freero.mobile`. |

Without them: no push is sent (the apps' settings say the server doesn't send push yet), and https
links open in the browser; `freero://` links still open the app.

## Owner steps (outside the code)

The bundle ID / package name is `app.freero.mobile` in both projects (`appId` in
`capacitor.config.json`, `applicationId` in `android/app/build.gradle`, `PRODUCT_BUNDLE_IDENTIFIER` in
the Xcode project). Change it in all three before the first store upload if you want another one;
it can't change afterwards.

### Apple (App Store, iPhone and iPad)

1. Enrol in the **Apple Developer Program** (developer.apple.com/programs, USD 99 a year) as the
   organisation (Kaiten Gaming LLC needs a D-U-N-S number).
2. Certificates, IDs & Profiles → **Identifiers** → register the App ID `app.freero.mobile` with the
   capabilities **Push Notifications** and **Associated Domains**.
3. **Keys** → create a key with *Apple Push Notifications service (APNs)*; download the `.p8` once.
   Set `PUSH_APNS_KEY` (its contents), `PUSH_APNS_KEY_ID`, `PUSH_APNS_TEAM_ID` on the server, and
   `MOBILE_APPLE_APP_ID=<Team ID>.app.freero.mobile`.
4. On a Mac: `npm run mobile:sync`, open `ios/App/App.xcodeproj` in Xcode, select the team under
   Signing & Capabilities (automatic signing creates the profiles), set the version, then Product →
   Archive → Distribute App → App Store Connect.
5. **App Store Connect** → new app (iOS, bundle ID above, SKU, primary language). Fill in the listing:
   name, subtitle, description, keywords, support and privacy policy URLs (freero.app/support,
   freero.app/privacy), screenshots for 6.9" iPhone and 13" iPad (the board on each), the age rating
   questionnaire, **App Privacy** (account email and name, user content, identifiers: the push token —
   used for app functionality, linked to the account, not for tracking), export compliance (the app
   only uses standard HTTPS: `ITSAppUsesNonExemptEncryption` is already `false`).
6. TestFlight the build, then **submit for review**. Give the reviewers a demo account
   (`scripts/seed-reviewer-account.mjs`) and say what the app adds over the website (push
   notifications, opening board links, Apple Pencil on the board): wrapped web apps are reviewed
   against guideline 4.2 (minimum functionality).

### Google (Play Store, phones and tablets)

1. Create a **Google Play Console** developer account (play.google.com/console, USD 25 once) as an
   organisation; verify the identity and the D-U-N-S number.
2. **Firebase** (console.firebase.google.com): a project, add an Android app `app.freero.mobile`,
   download `google-services.json` — store it as the CI secret `ANDROID_GOOGLE_SERVICES_JSON` (or put
   it at `apps/mobile/native/android/app/google-services.json` for a local build; it is not secret
   but stays out of the repo). Project settings → Service accounts → *Generate new private key*: set
   it as `PUSH_FCM_SERVICE_ACCOUNT` on the server.
3. Make the **upload key**: `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA
   -keysize 4096 -validity 10000`. Keep it safe; store it base64-encoded as the CI secret
   `ANDROID_UPLOAD_KEYSTORE_BASE64`, with `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`,
   `ANDROID_UPLOAD_KEY_PASSWORD`. CI then signs the release bundle.
4. Play Console → create the app, enrol in **Play App Signing**, upload the signed `.aab` from the
   `freero-android` artifact to *Internal testing* first.
5. App integrity → App signing: copy the SHA-256 of the **app signing key** and of the **upload key**
   into `MOBILE_ANDROID_CERT_SHA256` (comma separated) on the server, so App Links verify.
6. The store listing (short and full description, phone and 7"/10" tablet screenshots, the icon at
   512×512 from `apps/web/public/icons/icon-512.png`, feature graphic 1024×500), the content rating
   questionnaire, **Data safety** (as for Apple), target audience, then promote to Production and
   send for review.

## Pencil and stylus: checks on real devices

Recorded on real hardware before each store submission (the web app handles pen input; nothing in the
shell changes it). Not yet recorded — they need the devices:

| Check | iPad + Apple Pencil (2nd gen / Pro) | Android tablet + stylus (S Pen) |
|---|---|---|
| Pressure changes the pen's stroke width | — | — |
| Palm resting on the screen while drawing doesn't pan or draw | — | — |
| Hover (Pencil Pro / M2 iPad, S Pen) shows the cursor before touching | — | — |
| Two-finger pan and pinch zoom while the pen tool is on | — | — |
| Push notification opens the right board and comment | — | — |
| `freero://board/<id>` and an https board link open the app | — | — |
