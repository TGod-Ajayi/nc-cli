/**
 * Credential storage and the `login` / `logout` / `whoami` commands.
 *
 * Credentials live in ~/.naijacloud/config.json with mode 0600. The only
 * thing persisted is the access token NaijaCloud's `login` mutation returns
 * (plus a little non-sensitive identity for `whoami`). The password is never
 * written to disk, and the token is never printed back in full.
 */

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { apiBaseUrl, getCurrentUser, loginWithPassword } from "./api-client.js";
import type { User } from "./api-client.js";

export const CONFIG_DIR = join(homedir(), ".naijacloud");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Env var that overrides the stored token (CI, or a second account). */
export const TOKEN_ENV_VAR = "HOSTING_API_TOKEN";

export interface StoredCredentials {
  /** NaijaCloud access token (JWT) sent as `Authorization: Bearer <token>`. */
  accessToken: string;
  /** Cached identity so `whoami` need not hit the network. Not authoritative. */
  user?: { id: string; email: string; name: string | null };
  /** API base URL this token was issued against. */
  apiBaseUrl?: string;
  savedAt?: string;
}

export type TokenSource = "env" | "file";

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/* -------------------------------------------------------------------------- */
/* Credential file read / write                                               */
/* -------------------------------------------------------------------------- */

export function readStoredCredentials(): StoredCredentials | null {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, "utf8");
  } catch {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredCredentials).accessToken === "string" &&
      (parsed as StoredCredentials).accessToken.length > 0
    ) {
      return parsed as StoredCredentials;
    }
  } catch {
    // fall through
  }
  throw new Error(
    `Credential file ${CONFIG_FILE} is malformed. Run 'naijacloud logout' then 'naijacloud login' to recreate it.`,
  );
}

/** Writes credentials with owner-only permissions (dir 0700, file 0600). */
export function writeStoredCredentials(credentials: StoredCredentials): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // `mode` on writeFileSync is masked by the process umask, so chmod explicitly
  // afterwards to guarantee 0600 even when the file already existed.
  writeFileSync(CONFIG_FILE, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(CONFIG_FILE, 0o600);
}

/** Deletes the credential file. Returns false if there was nothing to delete. */
export function deleteStoredCredentials(): boolean {
  try {
    readFileSync(CONFIG_FILE);
  } catch {
    return false;
  }
  rmSync(CONFIG_FILE, { force: true });
  return true;
}

/**
 * Token resolution order: HOSTING_API_TOKEN, then ~/.naijacloud/config.json.
 * Returns null when neither is present — callers turn that into the
 * "Not logged in" message rather than letting a 401 escape.
 */
export function resolveToken(): ResolvedToken | null {
  const fromEnv = process.env[TOKEN_ENV_VAR]?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };

  const stored = readStoredCredentials();
  if (stored) return { token: stored.accessToken, source: "file" };

  return null;
}

/* -------------------------------------------------------------------------- */
/* Interactive prompts                                                        */
/* -------------------------------------------------------------------------- */

/** Prompts go to stderr so stdout stays clean for piping. */
function write(text: string): void {
  process.stderr.write(text);
}

async function promptLine(question: string, { hidden = false } = {}): Promise<string> {
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    throw new Error(
      "Interactive login needs a TTY. Use flags instead:\n" +
        "  naijacloud login --email you@example.com --password '<password>'\n" +
        "  naijacloud login --token '<access-token>'",
    );
  }

  write(question);

  return await new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    const previousRaw = stdin.isRaw ?? false;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = (): void => {
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        switch (char) {
          case "\r":
          case "\n":
            write("\n");
            cleanup();
            resolve(chunks.join(""));
            return;
          case "\u0003": // Ctrl-C
            write("\n");
            cleanup();
            reject(new Error("Cancelled."));
            return;
          case "\u007f": // Backspace
          case "\b":
            if (chunks.length > 0) {
              chunks.pop();
              if (!hidden) write("\b \b");
            }
            break;
          default:
            // Ignore other control characters.
            if (char < " ") break;
            chunks.push(char);
            if (!hidden) write(char);
            break;
        }
      }
    };

    stdin.on("data", onData);
  });
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

export interface LoginOptions {
  email?: string;
  password?: string;
  /** Skip the password flow and store a token you already have. */
  token?: string;
}

/**
 * Authenticates and stores the resulting access token.
 *
 * NaijaCloud's control plane has no personal-access-token concept: the
 * documented way in is the `login(email, password)` mutation, which returns a
 * bearer token. So this prompts for email + password by default, and accepts
 * `--token` for CI where a token has already been obtained.
 */
export async function login(options: LoginOptions = {}): Promise<void> {
  const base = apiBaseUrl();

  let accessToken: string;

  if (options.token) {
    accessToken = options.token.trim();
    write(`Validating token against ${base} ...\n`);
  } else {
    const email = options.email ?? (await promptLine("NaijaCloud email: "));
    const password =
      options.password ?? (await promptLine("Password (hidden): ", { hidden: true }));

    if (!email.trim()) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");

    write(`Signing in to ${base} ...\n`);
    const payload = await loginWithPassword(email.trim(), password);
    accessToken = payload.accessToken;
  }

  // Validate immediately against `me` — nothing is written if this fails.
  let user: User;
  try {
    user = await getCurrentUser(accessToken);
  } catch (error) {
    if (options.token && error instanceof Error) {
      throw new Error(
        `The token passed to --token was rejected by NaijaCloud (${error.message}). Nothing was saved.`,
      );
    }
    throw error;
  }

  writeStoredCredentials({
    accessToken,
    user: { id: user.id, email: user.email, name: displayName(user) },
    apiBaseUrl: base,
    savedAt: new Date().toISOString(),
  });

  process.stdout.write(`Logged in as ${user.email}\n`);
  write(`Token saved to ${CONFIG_FILE} (mode 0600).\n`);
}

export function logout(): void {
  const existed = deleteStoredCredentials();
  if (existed) {
    process.stdout.write(`Logged out. Removed ${CONFIG_FILE}\n`);
  } else {
    process.stdout.write("Not logged in — nothing to remove.\n");
  }

  if (process.env[TOKEN_ENV_VAR]) {
    write(
      `Note: ${TOKEN_ENV_VAR} is still set in this environment and will keep ` +
        "taking precedence over the credential file.\n",
    );
  }
}

export async function whoami(): Promise<void> {
  const resolved = resolveToken();
  if (!resolved) {
    process.stdout.write("Not logged in. Run 'naijacloud login' first.\n");
    process.exitCode = 1;
    return;
  }

  const user = await getCurrentUser(resolved.token);
  const origin = resolved.source === "env" ? `${TOKEN_ENV_VAR} env var` : CONFIG_FILE;

  const name = displayName(user);
  process.stdout.write(
    [
      `${user.email}${name ? ` (${name})` : ""}`,
      `  user id:  ${user.id}`,
      `  plan:     ${user.plan}`,
      `  status:   ${user.status}`,
      `  api:      ${apiBaseUrl()}`,
      `  token:    from ${origin}`,
      "",
    ].join("\n"),
  );
}

function displayName(user: User): string | null {
  if (user.name) return user.name;
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}
