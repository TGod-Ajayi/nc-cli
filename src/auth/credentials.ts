/**
 * Where the access token lives.
 *
 * Credentials go in ~/.naijacloud/config.json with mode 0600, inside a 0700
 * directory. The only thing persisted is the token NaijaCloud's `login`
 * mutation returns, plus a little non-sensitive identity so `whoami` need not
 * hit the network. The password is never written to disk.
 *
 * This module is deliberately free of commands and of any API import: the
 * transport reads tokens from here, so a dependency in the other direction
 * would be a cycle.
 */

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

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
