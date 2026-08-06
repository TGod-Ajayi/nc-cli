#!/usr/bin/env node
/**
 * `naijacloud` entrypoint — dispatches login / logout / whoami / mcp.
 *
 * Installed under two names: `naijacloud` and the shorter `njc`. Both are the
 * same executable, so every command below works either way.
 *
 * Under `naijacloud mcp` stdout is owned by the MCP protocol, so this file
 * writes help, errors and diagnostics to stderr and keeps stdout for command
 * output only.
 */

import process from "node:process";

import { CLIENT_VERSION, DEFAULT_API_BASE_URL } from "./api/index.js";
import { TOKEN_ENV_VAR } from "./auth/credentials.js";
import { login, logout, whoami } from "./commands/auth.js";
import { ALIAS, PROGRAM, programName } from "./program-name.js";

/** Column where every description starts, matching the option lists below. */
const DESCRIPTION_COLUMN = 28;

const COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["login [options]", "Authenticate and store credentials (mode 0600)"],
  ["logout", "Delete stored credentials"],
  ["whoami", "Show the authenticated account"],
  ["init [dir]", "Write a naijacloud.json, without deploying"],
  ["deploy [dir]", "Build, upload and release a static site"],
  ["schema [--write]", "Print the naijacloud.json JSON Schema"],
  ["mcp", "Run the MCP server over stdio"],
  ["--help", "Show this message"],
  ["--version", "Show the version"],
];

/**
 * Padded rather than hard-coded, so the descriptions stay in one column for
 * both `naijacloud` and the seven-characters-shorter `njc`.
 */
function usage(program: string): string {
  const lines = COMMANDS.map(([command, description]) => {
    const label = `${program} ${command}`;
    return `  ${label.padEnd(DESCRIPTION_COLUMN)} ${description}`;
  }).join("\n");

  return `${program} — CLI and MCP server for NaijaCloud hosting

Usage
${lines}

Login options
  --email <email>              Email, instead of being prompted
  --password <password>        Password, instead of being prompted
  --token <token>              Store an access token you already have (CI)

Init options
  --name/--output/--index      Manifest values, instead of being prompted
  --spa / --no-spa             Serve the entry file for unmatched paths
  --yes                        Accept detected defaults instead of prompting
  --force                      Rewrite an existing naijacloud.json

Deploy options
  --name <name>                Site name (first deploy only)
  --output <dir>               Directory to deploy, overriding the manifest
  --index <file>               Entry file, when it is not index.html
  --spa / --no-spa             Serve the entry file for unmatched paths
  --prebuilt                   Skip the manifest's build command
  --new                        Create a new site, ignoring the manifest's serviceId
  --yes                        Accept detected defaults instead of prompting
  --no-wait                    Return once queued, without waiting for the build
  --json                       Machine-readable result on stdout

  Configuration is read from naijacloud.json; the first deploy asks for what
  it needs and writes the file, so later runs take no arguments at all.

Schema options
  --write [path]               Write the schema (default .naijacloud/schema.json)

Environment
  ${TOKEN_ENV_VAR}            Access token; overrides the stored credentials
  HOSTING_API_BASE_URL         API base URL (default ${DEFAULT_API_BASE_URL})
  HOSTING_API_TIMEOUT_MS       Per-request timeout in ms (default 30000)
  HOSTING_UPLOAD_TIMEOUT_MS    Upload timeout in ms (default 600000)
  NAIJACLOUD_DEPLOY_TIMEOUT_MS Deploy wait timeout in ms (default 900000)

Register with Claude Code
  claude mcp add --transport stdio naijacloud -- ${program} mcp

  Installed as both '${PROGRAM}' and '${ALIAS}'; the two are the same program.
`;
}

const VERSION = CLIENT_VERSION;

interface ParsedArgs {
  flags: Map<string, string>;
  /** Arguments that are not flags or flag values, in order. */
  positionals: string[];
}

/**
 * Minimal `--flag value` / `--flag=value` parser.
 *
 * `booleans` names the flags that take no value, so `naijacloud deploy --spa
 * dist` keeps `dist` as a positional instead of swallowing it as the value of
 * `--spa`.
 */
function parseArgs(args: string[], booleans: ReadonlySet<string> = new Set()): ParsedArgs {
  const flags = new Map<string, string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];
    if (!booleans.has(name) && next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, "");
    }
  }

  return { flags, positionals };
}

/** Flags with no value, so the parser leaves the following token alone. */
const INIT_BOOLEANS = new Set(["spa", "no-spa", "yes", "force", "json"]);

const DEPLOY_BOOLEANS = new Set([
  "spa",
  "no-spa",
  "prebuilt",
  "new",
  "yes",
  "wait",
  "no-wait",
  "json",
]);

/**
 * Reads a `--x` / `--no-x` pair as a tri-state: explicitly on, explicitly off,
 * or unspecified so a lower-priority source (manifest, detection) decides.
 */
function tristate(flags: Map<string, string>, name: string): boolean | undefined {
  if (flags.has(`no-${name}`)) return false;
  if (flags.has(name)) return true;
  return undefined;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const program = programName();

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stderr.write(usage(program));
    process.exitCode = command === undefined ? 1 : 0;
    return;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  switch (command) {
    case "login": {
      const { flags } = parseArgs(rest);
      const options: Parameters<typeof login>[0] = {};

      const email = flags.get("email");
      const password = flags.get("password");
      const token = flags.get("token");
      if (email) options.email = email;
      if (password) options.password = password;
      if (token) options.token = token;

      await login(options);
      return;
    }

    case "logout":
      logout();
      return;

    case "whoami":
      await whoami();
      return;

    case "init": {
      const { flags, positionals } = parseArgs(rest, INIT_BOOLEANS);
      const { init } = await import("./commands/init.js");

      await init({
        dir: positionals[0],
        name: flags.get("name") || undefined,
        output: flags.get("output") || undefined,
        index: flags.get("index") || undefined,
        spa: tristate(flags, "spa"),
        yes: flags.has("yes"),
        force: flags.has("force"),
        json: flags.has("json"),
      });
      return;
    }

    case "deploy": {
      const { flags, positionals } = parseArgs(rest, DEPLOY_BOOLEANS);
      // Imported lazily so the auth commands never pay to load zod and the
      // archive machinery.
      const { deploy } = await import("./commands/deploy.js");

      await deploy({
        dir: positionals[0],
        name: flags.get("name") || undefined,
        output: flags.get("output") || undefined,
        index: flags.get("index") || undefined,
        spa: tristate(flags, "spa"),
        prebuilt: flags.has("prebuilt"),
        createNew: flags.has("new"),
        yes: flags.has("yes"),
        json: flags.has("json"),
        wait: tristate(flags, "wait") ?? true,
      });
      return;
    }

    case "schema": {
      const { flags } = parseArgs(rest);
      const { schemaCommand } = await import("./commands/schema.js");
      schemaCommand({ write: flags.get("write") });
      return;
    }

    case "mcp": {
      // Imported lazily so `login`/`logout`/`whoami` never pay to load the MCP SDK.
      const { startMcpServer } = await import("./mcp/server.js");
      await startMcpServer();
      // The stdio transport keeps the process alive; returning here is correct.
      return;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${usage(program)}`);
      process.exitCode = 1;
      return;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
