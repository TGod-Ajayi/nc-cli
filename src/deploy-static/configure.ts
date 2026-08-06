/**
 * The four questions that fill a `naijacloud.json`.
 *
 * Shared by `naijacloud init` and by the first run of `naijacloud deploy`, so
 * the two cannot drift into asking different things or defaulting differently —
 * a first deploy IS an init that happens to also ship the site.
 *
 * Every answer has a locally-detected default, so the interactive path is
 * mostly keypresses, and the non-interactive path is the same defaults with
 * nobody asked.
 */

import { promptWithDefault, promptYesNo } from "../terminal.js";
import { sanitizeName } from "./manifest.js";
import type { Detected } from "./manifest.js";

export interface ManifestAnswers {
  name: string;
  /** Undefined means "no build step" — the output directory is already built. */
  build: string | undefined;
  output: string;
  spa: boolean;
}

export interface AskOptions {
  /** Ask; when false every answer is taken from the override or the default. */
  interactive: boolean;
  /** Values already settled by a flag, an env var, or an existing manifest. */
  name?: string | undefined;
  build?: string | undefined;
  output?: string | undefined;
  spa?: boolean | undefined;
  /**
   * Whether the build command is worth asking about. A deploy pointed at an
   * explicit directory is being handed output that already exists, so asking
   * how to build it would be noise.
   */
  askBuild?: boolean;
}

/** Answer that clears an inferred build command rather than accepting it. */
const NO_BUILD = "none";

export async function askManifestBasics(
  detected: Detected,
  options: AskOptions,
): Promise<ManifestAnswers> {
  const { interactive } = options;

  const name =
    options.name ??
    (interactive
      ? sanitizeName(await promptWithDefault("  Site name        ", detected.name))
      : detected.name);

  let build = options.build;
  if (build === undefined && options.askBuild !== false) {
    if (interactive && detected.build !== undefined) {
      const answer = await promptWithDefault(
        "  Build command    ",
        detected.build,
        `from package.json; '${NO_BUILD}' to skip`,
      );
      build = answer === NO_BUILD || answer === "" ? undefined : answer;
    } else {
      build = detected.build;
    }
  }

  const outputFallback = detected.output ?? "dist";
  const output =
    options.output ??
    (interactive
      ? await promptWithDefault(
          "  Output directory ",
          outputFallback,
          detected.output ? "detected" : undefined,
        )
      : outputFallback);

  const spa =
    options.spa ??
    (interactive
      ? await promptYesNo(
          "  Single-page app? ",
          detected.spa,
          detected.framework ? `detected: ${detected.framework}` : undefined,
        )
      : detected.spa);

  return { name, build, output, spa };
}
