#!/usr/bin/env node
// Builds Freero's phone and tablet apps (#177, docs/mobile.md): a Capacitor shell (MIT) in
// apps/mobile/native around a Freero server's web app, like the desktop app's Tauri shell. Not an
// npm workspace: Capacitor is installed into apps/mobile/native at the versions its lockfile pins.
//
//   node apps/mobile/build.mjs sync               install + copy the config into the native projects
//   node apps/mobile/build.mjs android [release]   debug APK (or an unsigned release bundle, .aab)
//   node apps/mobile/build.mjs ios                 an unsigned simulator build (macOS + Xcode)
//   node apps/mobile/build.mjs icons               repaint Freero's icon and launch screens
//
// FREERO_INSTANCE_URL: the server the app opens (default https://freero.app; self-hosters build
// their own). FREERO_VERSION_NAME / FREERO_VERSION_CODE: the store version (CI sets them).
// Android needs a JDK 21 and the Android SDK (ANDROID_HOME); iOS needs macOS with Xcode.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NATIVE = path.join(HERE, 'native');
const WIN = process.platform === 'win32';
const [mode = 'sync', variant = 'debug'] = process.argv.slice(2);

function run(cmd, args, cwd = NATIVE) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: WIN });
  // A command that never started (not found, not executable) has no status: say why.
  if (r.error) console.error(`Could not run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** The server the app opens: https only (http only for a local server while developing). */
function instance() {
  const raw = process.env.FREERO_INSTANCE_URL?.trim() || 'https://freero.app';
  const u = new URL(raw);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '10.0.2.2';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('FREERO_INSTANCE_URL must be https (http only for a local server)');
  return u;
}

function sync() {
  if (!fs.existsSync(path.join(NATIVE, 'node_modules/@capacitor/cli'))) run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('npx', ['cap', 'sync']);
  // `cap sync` copied capacitor.config.json into both projects (generated, git-ignored there): point
  // them at the chosen server.
  const server = instance();
  for (const f of ['android/app/src/main/assets/capacitor.config.json', 'ios/App/App/capacitor.config.json']) {
    const file = path.join(NATIVE, f);
    if (!fs.existsSync(file)) continue;
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.server = { ...cfg.server, url: server.origin, cleartext: server.protocol === 'http:' };
    fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  return server;
}

if (mode === 'icons') {
  run(process.execPath, [path.join(HERE, 'icons.mjs')], HERE);
} else if (mode === 'sync') {
  console.log(`Synced the native projects for ${sync().origin}.`);
} else if (mode === 'android') {
  const server = sync();
  const props = [`-PfreeroHost=${server.hostname}`, `-PfreeroVersionName=${process.env.FREERO_VERSION_NAME || '1.0'}`, `-PfreeroVersionCode=${process.env.FREERO_VERSION_CODE || '1'}`];
  const task = variant === 'release' ? 'bundleRelease' : 'assembleDebug';
  run(WIN ? 'gradlew.bat' : './gradlew', [task, ...props, '--no-daemon'], path.join(NATIVE, 'android'));
  console.log(variant === 'release' ? 'Release bundle: apps/mobile/native/android/app/build/outputs/bundle/release/' : 'Debug APK: apps/mobile/native/android/app/build/outputs/apk/debug/');
} else if (mode === 'ios') {
  if (process.platform !== 'darwin') throw new Error('The iOS app builds on macOS with Xcode (or in CI: .github/workflows/mobile.yml).');
  const server = sync();
  run('xcodebuild', [
    '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-sdk', 'iphonesimulator',
    '-derivedDataPath', 'ios/build', `FREERO_HOST=${server.hostname}`,
    `MARKETING_VERSION=${process.env.FREERO_VERSION_NAME || '1.0'}`, `CURRENT_PROJECT_VERSION=${process.env.FREERO_VERSION_CODE || '1'}`,
    'CODE_SIGNING_ALLOWED=NO', 'build',
  ]);
  console.log('Simulator app: apps/mobile/native/ios/build/Build/Products/Release-iphonesimulator/App.app');
} else {
  console.error('Usage: node apps/mobile/build.mjs sync | android [release] | ios | icons');
  process.exit(1);
}
