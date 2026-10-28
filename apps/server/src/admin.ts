// Operator CLI — the second composition root next to main.ts. Discovers modules/<name>/admin.ts
// (reserved: export default (ctx) => AdminCommand[]) the way main.ts discovers routes, so there is
// no command list to edit.
//
//   npm run admin -- <command> [args]                                  (a checkout)
//   node --import tsx apps/server/src/admin.ts <command> [args]        (the container image)
//
// Same configuration (environment) and database as the server. On Postgres it runs next to the
// running instances; on PGlite (single process) stop the server first. Applies pending migrations
// like a starting instance would (idempotent, under the migration lock).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AdminUsageError, parseAdminArgv, type AdminCommand } from './platform/admin';
import { ConfigError, loadConfig } from './platform/config';
import { createContext, type ServerContext } from './platform/context';
import { closeDb, DatabaseStartupError, discoverMigrations, migrate, openDb } from './platform/db';
import { configureLogger, logError } from './platform/log';
import { mailSettled } from './platform/mail';

const MODULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modules');

type AdminModule = { default: (ctx: ServerContext) => AdminCommand[] };

async function discoverCommands(ctx: ServerContext): Promise<AdminCommand[]> {
  const commands: AdminCommand[] = [];
  for (const d of fs.readdirSync(MODULES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(MODULES_DIR, d.name, 'admin.ts');
    if (fs.existsSync(file)) commands.push(...((await import(pathToFileURL(file).href)) as AdminModule).default(ctx));
  }
  return commands;
}

function help(commands: AdminCommand[]): string {
  const lines = ['Usage: npm run admin -- <command> [args]', '', 'Commands:'];
  for (const c of commands) lines.push(`  ${c.name} ${c.usage}`, `      ${c.summary}`);
  return lines.join('\n');
}

async function main(): Promise<number> {
  const config = loadConfig();
  configureLogger({ level: config.logLevel, environment: config.environment, release: config.release });
  const ctx = createContext(config);
  const commands = await discoverCommands(ctx);
  const { command, positional, flags } = parseAdminArgv(process.argv.slice(2));
  const cmd = commands.find((c) => c.name === command);
  if (!cmd || flags.help) {
    console.log(help(commands));
    return command && !cmd ? 2 : 0;
  }
  await openDb(config.databaseUrl ? { url: config.databaseUrl, poolSize: 2 } : { pgliteDir: config.pgliteDir });
  try {
    await migrate(discoverMigrations(MODULES_DIR));
    await cmd.run({ positional, flags, print: (line) => console.log(line) });
    return 0;
  } catch (e) {
    if (!(e instanceof AdminUsageError)) throw e;
    console.error(`${e.message}\nUsage: npm run admin -- ${cmd.name} ${cmd.usage}`);
    return 2;
  } finally {
    await mailSettled(); // notices the command sent
    await ctx.shutdown();
    await closeDb();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof ConfigError) console.error(err.message);
    else if (err instanceof DatabaseStartupError) console.error(`Cannot open the database: ${err.message}`);
    else logError('admin command failed', err);
    process.exit(1);
  },
);
