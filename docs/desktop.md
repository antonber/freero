# Freero desktop app (Windows and macOS)

Status: **built, unsigned** (#176). The shell, its build scripts and the CI workflow that produces
installers are in the repo; signing, notarisation and the update channel need the owner's
certificates and keys (below). Without them everything still builds — as unsigned installers that
Windows SmartScreen and macOS Gatekeeper warn about.

## What it is

A thin [Tauri 2](https://tauri.app) shell (MIT / Apache-2.0) around a Freero instance:
`apps/desktop/src-tauri` (Rust, ~300 lines) and one page of its own, `apps/desktop/ui/index.html`
(choosing the server). Tauri uses the system's webview (WebView2 on Windows, WKWebView on macOS),
so installers are a few MB instead of Electron's ~100 MB.

- **One window showing the instance's web app**, as the server serves it — always the server's
  own version, no second copy of the app to keep in step. Offline copies (#178) and the service
  worker work as in a browser.
- **Which server**: the operator's, `https://freero.app`, unless the build says otherwise
  (`FREERO_INSTANCE_URL` at build time), the person chose another one (Freero › Change server…,
  kept in the app's config folder as `settings.json`) or the app is started with
  `FREERO_INSTANCE_URL` set. Only https servers are accepted (http only on `localhost`). Changing
  it restarts the app.
- **Links**: `freero://board/<id>` (and `?item=` / `?thread=`), `freero://doc/<id>`,
  `freero://app`, `freero://open?url=<a page of the chosen server>`. A link to any other site or
  scheme is never opened inside the app (`src/links.rs`, tested). A second launch (how Windows
  passes a link) hands it to the running app. https links from email open in the browser: making
  `https://<instance>/board/…` open the app needs Universal Links / App Links tied to the
  operator's domain and a signed build, so it waits for the owner's certificates.
- **Menus**: Freero (About, Settings…, Change server…, Check for updates…, Quit), File (Dashboard,
  Close window), Edit (undo, redo, cut, copy, paste, select all — so the system shortcuts work on
  macOS), View (Back, Forward, Reload, Full screen), Window. In English for now.
- **Notifications**: the web app's inbox items as the system's notifications, for the types the
  person leaves on under Settings › "Notifications on this computer" (per device, kept in the
  browser storage of that device; `app/notifications/device.ts`), only while Freero isn't the
  window in front. The same setting works in a browser that allows notifications.
- **What the page may ask the app**: only the notification plugin's commands, and only from the
  chosen server's origin (a capability added at start, `lib.rs`). Changing the server is a command
  only the app's own page may call: a page a server sent can never point the app elsewhere.

## Building it

Locally (needs [Rust](https://rustup.rs); on Windows the "Desktop development with C++" workload
of Visual Studio Build Tools and WebView2, which Windows 11 has; on macOS the Xcode command line
tools):

```
npm run desktop:dev                                    # runs it against the default server
FREERO_INSTANCE_URL=http://localhost:4000 npm run desktop:dev
npm run desktop:build                                  # installers in apps/desktop/src-tauri/target/release/bundle/
```

The Tauri CLI is fetched by `npx` at a pinned version (`apps/desktop/build.mjs`); the desktop app
is not an npm workspace, so it adds nothing to the web app's dependencies. `Cargo.lock` is
committed: CI builds with `--locked`.

CI (`.github/workflows/desktop.yml`): on every change under `apps/desktop/` it runs the shell's
tests on Linux and builds unsigned installers for Windows (x64: NSIS `.exe`, `.msi`) and macOS
(Apple silicon and Intel: `.dmg`, `.app`), uploaded as workflow artifacts. Run it by hand
(Actions › desktop › Run workflow) with another default server for a self-hosted build. A tag
`desktop-v<version>` makes a **draft** GitHub release with the installers (and, once updates are
set up, the update manifest); publish it after checking.

Releasing a version: bump `version` in `apps/desktop/src-tauri/tauri.conf.json` and
`Cargo.toml`, then tag `desktop-v<version>`.

## The owner's steps

Everything below is set in the GitHub repository's **Settings › Secrets and variables › Actions**.
The workflow picks each up when present; nothing in the code changes.

### macOS: Developer ID and notarisation

1. Join the Apple Developer Program (organisation account, for Kaiten Gaming LLC).
2. In Certificates, Identifiers & Profiles create a **Developer ID Application** certificate
   (Keychain Access › Certificate Assistant › Request a Certificate…, upload the CSR).
3. Export it with its private key from Keychain Access as a `.p12` with a password, and
   base64 it: `base64 -i certificate.p12 | pbcopy`.
4. Make an **app-specific password** for the Apple ID at appleid.apple.com (Sign-In and Security).
5. Secrets:
   - `APPLE_CERTIFICATE` — the base64 `.p12`
   - `APPLE_CERTIFICATE_PASSWORD` — its password
   - `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: Kaiten Gaming LLC (TEAMID)`
     (`security find-identity -v -p codesigning`)
   - `APPLE_ID` — the Apple ID's email; `APPLE_PASSWORD` — the app-specific password;
     `APPLE_TEAM_ID` — the team id.

Tauri signs the app and submits it for notarisation with these (and staples the ticket), so the
`.dmg` opens without Gatekeeper's warning.

### Windows: code signing

Windows SmartScreen trusts signed installers (an EV or OV certificate builds reputation faster;
Azure Trusted Signing is the cheapest current option for organisations in the US).

- **A certificate file (OV/EV with an exportable key)**: secrets `WINDOWS_CERTIFICATE` (the `.pfx`,
  base64) and `WINDOWS_CERTIFICATE_PASSWORD`. The workflow imports it on the runner and gives
  Tauri its thumbprint (`bundle.windows.certificateThumbprint`, sha256, DigiCert's timestamp server);
  nothing in `tauri.conf.json` changes.
- **Azure Trusted Signing or a hardware token / cloud HSM** (most EV certificates today): set
  `bundle.windows.signCommand` to the vendor's signing tool, e.g. for Trusted Signing
  `"signCommand": "trusted-signing-cli -e <endpoint> -a <account> -c <profile> %1"` with
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` as secrets passed to the build step.

### Updates

The app checks the release channel at start (it tells the person when a version is waiting) and
installs on Freero › Check for updates…. Updates are verified with a minisign key, separate from
the code-signing certificates; until there is one, the app never updates itself and says so.

1. `npx @tauri-apps/cli@2 signer generate -w freero-updater.key` — keep the private key and its
   password safe (losing it means existing installs can't verify later updates).
2. Secrets `TAURI_SIGNING_PRIVATE_KEY` (the key file's content) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; repository **variable** `FREERO_UPDATER_PUBKEY` (the
   `.pub` file's content — public, baked into the app).
3. Optionally the variable `FREERO_UPDATER_ENDPOINT`: where the app looks for the update
   manifest. Default: `https://github.com/antonber/freero/releases/latest/download/latest.json`,
   i.e. the latest published desktop release (the "stable" channel). A beta channel is a second
   endpoint (e.g. a pre-release's `latest.json`) baked into a separate build.

With the key present the workflow also builds the update bundles and their signatures and puts
`latest.json` in the draft release.

### Self-hosters

Run the workflow by hand with your server's address (or set the repository variable
`FREERO_INSTANCE_URL` in your fork), or let people pick Change server… in the app. Your own
signing follows the same steps with your certificates.

## Not yet

- https deep links (Universal Links / App Links: need the signed builds and an
  `apple-app-site-association` / `assetlinks.json` served by the instance).
- Menus in the person's language (the web app inside is translated; the native menus are English).
- Clicking a system notification focuses the app but doesn't open the item yet on every platform.
- Linux packages (the code builds there — CI tests on Linux — but nobody asked for them yet).
