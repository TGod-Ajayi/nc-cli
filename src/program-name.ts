/**
 * The name this CLI was invoked as.
 *
 * It ships under two: `naijacloud` and the shorter `njc`, installed as the same
 * executable by every channel. Anything the CLI prints for the reader to type
 * back — usage, examples, "run this next" hints — uses the one they actually
 * typed, so a `njc` user is never told to run `naijacloud`.
 *
 * Not exported to the MCP server, which has no invoked name to report and
 * quotes the canonical one instead.
 */

import { basename } from "node:path";
import process from "node:process";

/** The canonical name, used whenever the invoked one cannot be determined. */
export const PROGRAM = "naijacloud";

/**
 * The short name every install channel also puts on the PATH.
 *
 * Not `nc` — that is netcat, which exists on essentially every Unix machine.
 */
export const ALIAS = "njc";

/** Names this CLI is installed as; anything else is someone's own alias. */
const KNOWN_NAMES = new Set<string>([PROGRAM, ALIAS]);

/**
 * The name the binary was actually invoked as, so `njc --help` documents `njc`
 * and not the longer name the reader did not type.
 *
 * The two ways this ships disagree about where that name lives, so both are
 * consulted, most authoritative first:
 *
 *   - Compiled with `bun build --compile`, `argv0` is the invoked path but
 *     `argv[1]` is a virtual `/$bunfs/root/naijacloud` fixed at build time —
 *     which would report `naijacloud` no matter which name was typed.
 *   - Under Node, `argv0` is "node" and `argv[1]` is the bin symlink npm
 *     created, which Node does not resolve to its target.
 *
 * Anything unrecognised falls back to the canonical name: a bare
 * `node build/cli.js` would otherwise advertise a "cli" command that exists
 * nowhere.
 *
 * Read on each call rather than cached, so it stays a pure function of argv and
 * tests can exercise both names in one process.
 */
export function programName(): string {
  for (const candidate of [process.argv0, process.argv[1]]) {
    if (candidate === undefined) continue;
    const name = basename(candidate).replace(/\.(js|mjs|cjs|exe)$/i, "");
    if (KNOWN_NAMES.has(name)) return name;
  }
  return PROGRAM;
}
