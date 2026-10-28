// Server tests (KAI-174). Every test file opens its own in-memory Postgres (PGlite, WASM) and
// applies every migration in beforeAll, so a worker is heavy: by default Vitest starts one per
// core minus one, which on a large machine running other suites or `npm run verify` at the same
// time starves the workers — openTestDb then misses the 10 s hook timeout, workers die
// (ERR_IPC_CHANNEL_CLOSED) and, once seen, a module came back half-transformed
// ("SyntaxError: Unexpected token '}'", then an empty `./repo` namespace). Fewer workers finish
// the suite as fast and keep that headroom; the longer timeouts cover a loaded machine (password
// hashing and PGlite slow down most there).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    maxWorkers: '50%',
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
