#!/usr/bin/env node
// Builds (or runs) Freero's desktop app on this machine: `npm run desktop:build` / `desktop:dev`.
// Needs Rust (rustup.rs) and the platform's webview toolchain (docs/desktop.md "Building it");
// the Tauri CLI comes from npm on demand at a pinned version, so nothing joins the workspace.
// FREERO_INSTANCE_URL picks the server the build opens by default (self-hosters).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAURI_CLI = '@tauri-apps/cli@2.12.4';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src-tauri');
const mode = process.argv[2] === 'dev' ? 'dev' : 'build';

const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (cargo.status !== 0) {
  console.error('The desktop app needs Rust: install it from https://rustup.rs, then run this again (docs/desktop.md).');
  process.exit(1);
}
const run = spawnSync('npx', ['--yes', TAURI_CLI, mode, ...process.argv.slice(3)], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(run.status ?? 1);
