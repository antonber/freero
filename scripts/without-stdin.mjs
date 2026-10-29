// Runs a command with no stdin (`node scripts/without-stdin.mjs <command> [args…]`), for `npm run dev`.
//
// Why: under `concurrently` on Windows, `tsx watch` reads its stdin pipe (Enter reruns) and the server
// it starts inherits that same pipe. The first ESM import of `node:process` (the MCP SDK's Node shim
// does one) builds `process.stdin` for its exports, and opening a pipe that another process has a
// read pending on blocks — the server hangs during startup and never listens. With no stdin, nothing
// is shared. This file never touches `process.stdin` itself.
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/without-stdin.mjs <command> [args…]');
  process.exit(2);
}
// A shell on Windows resolves `tsx` to node_modules/.bin/tsx.cmd (npm puts .bin on PATH).
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
