// Operator commands (`npm run admin -- <command> …`, see apps/server/src/admin.ts). A module offers
// commands through its reserved file modules/<name>/admin.ts:
//   export default (ctx: ServerContext) => AdminCommand[]
// Commands run in their own process against the same database as the server, without HTTP: use
// the module's own service functions, print what was done, and record an audit event
// (platform/audit.ts) for anything that changes an account.

export interface AdminArgs {
  /** Words after the command name. */
  positional: string[];
  /** `--name value` → value; a bare `--flag` → true. */
  flags: Record<string, string | true>;
  /** Prints a line for the operator (stdout). */
  print(line: string): void;
}

export interface AdminCommand {
  /** `<area>:<verb>`, e.g. 'two-factor:reset'. */
  name: string;
  /** What follows the name, e.g. '<email> --operator <name> --reason <text> [--yes]'. */
  usage: string;
  summary: string;
  /** Resolves when done; throw AdminUsageError for a wrong invocation (exit code 2), anything else fails (1). */
  run(args: AdminArgs): Promise<void>;
}

/** The operator called a command wrongly; the message says how to call it. */
export class AdminUsageError extends Error {}

/** Flags that never take a value (so `--yes someone@example.com` keeps the address positional). */
const SWITCHES = new Set(['yes', 'help']);

/** Splits argv into the command, its positional words and its `--flags`. */
export function parseAdminArgv(argv: string[]): { command: string | null; positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (!SWITCHES.has(a.slice(2)) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { command: positional.shift() ?? null, positional, flags };
}

/** A required `--name <text>` flag (non-empty). */
export function requiredFlag(args: AdminArgs, name: string, what: string): string {
  const v = args.flags[name];
  if (typeof v !== 'string' || !v.trim()) throw new AdminUsageError(`--${name} <${what}> is required`);
  return v.trim();
}
