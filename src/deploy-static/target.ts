/**
 * "Where should this site live?" — the environment question.
 *
 * Asked by `naijacloud init` and by the first run of `naijacloud deploy`, for
 * the same reason the other manifest questions are shared: a first deploy is an
 * init that also ships the site, and the two must not drift.
 *
 * Services belong to an environment, so a static site should too. Without this
 * question the only way to place one is `--env`, which nobody passes on a first
 * run — the flag would have made environment-aware deploys an opt-in that the
 * default path quietly skipped, leaving sites outside the tree that
 * `naijacloud project` walks.
 *
 * Answering is still optional. Letting the platform place the site is a real
 * choice and stays the default, so the zero-config path remains one keypress.
 */

import { listEnvironmentChoices } from "../api/index.js";
import type { EnvironmentChoice } from "../api/index.js";
import { select } from "../interactive.js";
import { write } from "../terminal.js";

/** Sentinel for "don't target anything" — distinct from a cancelled prompt. */
const PLATFORM_DECIDES = "";

export interface EnvironmentAnswer {
  /** Undefined means the platform places the site, as it always has. */
  environmentId: string | undefined;
  /** True when the user backed out; the caller should abort. */
  cancelled: boolean;
}

function describe(choice: EnvironmentChoice): string {
  const parts = [choice.teamName];
  if (choice.isPreview) parts.push("preview");
  return parts.join(" · ");
}

/**
 * Offers every environment the account can reach, plus the platform default.
 *
 * Never throws for an API problem: someone running `init` on a machine with no
 * credentials, or offline, should still get a manifest — they simply get one
 * without an `environmentId`, which is exactly the pre-existing behaviour.
 */
export async function askEnvironment(options: {
  interactive: boolean;
  /** Already settled by --env or an existing manifest; skips the question. */
  settled?: string | undefined;
}): Promise<EnvironmentAnswer> {
  if (options.settled !== undefined) {
    return { environmentId: options.settled, cancelled: false };
  }
  if (!options.interactive) {
    return { environmentId: undefined, cancelled: false };
  }

  let choices: EnvironmentChoice[];
  try {
    choices = await listEnvironmentChoices();
  } catch {
    // Not logged in, or no network. The manifest is still worth writing.
    return { environmentId: undefined, cancelled: false };
  }

  if (choices.length === 0) {
    // Nothing to choose between, so asking would be a question with one answer.
    return { environmentId: undefined, cancelled: false };
  }

  const picked = await select<string>(
    "  Where should this site live?",
    [
      {
        label: "Let NaijaCloud place it",
        hint: "creates a new project",
        value: PLATFORM_DECIDES,
      },
      ...choices.map((choice) => ({
        label: `${choice.projectName} / ${choice.environmentName}`,
        hint: describe(choice),
        value: choice.environmentId,
        separated: false,
      })),
    ],
    { footer: "  ↑↓ move · ↵ select · q cancel" },
  );

  if (picked === null) return { environmentId: undefined, cancelled: true };
  if (picked === PLATFORM_DECIDES) {
    write("  Environment      NaijaCloud will place it\n");
    return { environmentId: undefined, cancelled: false };
  }

  const chosen = choices.find((choice) => choice.environmentId === picked);
  if (chosen) {
    write(`  Environment      ${chosen.projectName} / ${chosen.environmentName}\n`);
  }
  return { environmentId: picked, cancelled: false };
}
