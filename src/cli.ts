#!/usr/bin/env node
/**
 * `naijacloud` entrypoint — dispatches login / logout / whoami / mcp.
 *
 * Under `naijacloud mcp` stdout is owned by the MCP protocol, so this file
 * writes help, errors and diagnostics to stderr and keeps stdout for command
 * output only.
 */

import process from "node:process";

import { login, logout, whoami, TOKEN_ENV_VAR } from "./auth.js";
import { CLIENT_VERSION, DEFAULT_API_BASE_URL } from "./api-client.js";

const USAGE = `naijacloud — CLI and MCP server for NaijaCloud hosting

Usage
  naijacloud login [options]   Authenticate and store credentials (mode 0600)
  naijacloud logout            Delete stored credentials
  naijacloud whoami            Show the authenticated account
  naijacloud mcp               Run the MCP server over stdio
  naijacloud --help            Show this message
  naijacloud --version         Show the version

Login options
  --email <email>              Email, instead of being prompted
  --password <password>        Password, instead of being prompted
  --token <token>              Store an access token you already have (CI)

Environment
  ${TOKEN_ENV_VAR}          Access token; overrides the stored credentials
  HOSTING_API_BASE_URL         API base URL (default ${DEFAULT_API_BASE_URL})
  HOSTING_API_TIMEOUT_MS       Per-request timeout in ms (default 30000)

Register with Claude Code
  claude mcp add --transport stdio naijacloud -- naijacloud mcp
`;

const VERSION = CLIENT_VERSION;

/** Minimal `--flag value` / `--flag=value` parser for the login options. */
function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || !arg.startsWith("--")) continue;

    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }

    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      index += 1;
    } else {
      flags.set(arg.slice(2), "");
    }
  }

  return flags;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stderr.write(USAGE);
    process.exitCode = command === undefined ? 1 : 0;
    return;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  switch (command) {
    case "login": {
      const flags = parseFlags(rest);
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

    case "mcp": {
      // Imported lazily so `login`/`logout`/`whoami` never pay to load the MCP SDK.
      const { startMcpServer } = await import("./mcp-server.js");
      await startMcpServer();
      // The stdio transport keeps the process alive; returning here is correct.
      return;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      process.exitCode = 1;
      return;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
