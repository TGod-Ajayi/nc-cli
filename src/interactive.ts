/**
 * Arrow-key selection, for the interactive navigator.
 *
 * terminal.ts covers questions with typed answers; this covers picking one item
 * out of a list, which is what every level of `naijacloud project` does. Both
 * write to **stderr** and read stdin in raw mode, for the same reason: stdout
 * belongs to command output, and a table printed from inside the navigator has
 * to stay pipeable.
 *
 * Nothing here works without a TTY, and that is checked by the caller before
 * the first frame — a menu drawn into a log file is noise nobody can answer.
 */

import process from "node:process";

import { isInteractive, write } from "./terminal.js";

/** ANSI: hide/show the cursor, so the caret does not sit on a moving row. */
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

/** Move up `n` lines and clear everything below, for an in-place redraw. */
function rewind(lines: number): string {
  return lines > 0 ? `\u001b[${lines}A\u001b[0J` : "\u001b[0J";
}

const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const CYAN = "\u001b[36m";
const RESET = "\u001b[0m";

/** Colour is skipped when stderr is not a terminal, or when NO_COLOR is set. */
function colours(): boolean {
  return process.stderr.isTTY === true && !process.env["NO_COLOR"];
}

function paint(text: string, code: string): string {
  return colours() ? `${code}${text}${RESET}` : text;
}

export interface Choice<T> {
  /** Primary text. */
  label: string;
  /** Dimmed detail shown after the label — status, type, counts. */
  hint?: string;
  /** Returned when this row is picked. */
  value: T;
  /** Rendered but unselectable, for a capability that is not built yet. */
  disabled?: boolean;
  /** Visually separates this row from the one above it. */
  separated?: boolean;
}

/** How many rows to show at once before the list scrolls. */
const WINDOW = 12;

/**
 * Presents `choices` and returns the picked value, or `null` if the user backed
 * out with q or Escape.
 *
 * Ctrl-C throws rather than returning null: quitting a menu and aborting the
 * program are different intentions, and only the caller knows whether backing
 * out means "go up a level" or "we are done".
 */
export async function select<T>(
  title: string,
  choices: readonly Choice<T>[],
  options: { footer?: string } = {},
): Promise<T | null> {
  if (choices.length === 0) return null;

  const stdin = process.stdin;
  const firstEnabled = choices.findIndex((choice) => !choice.disabled);
  // An all-disabled list still renders, so the user can read *why* there is
  // nothing to pick, then back out.
  let cursor = firstEnabled === -1 ? 0 : firstEnabled;
  let offset = 0;
  let drawn = 0;

  // Padded against every label, not just the visible ones, so the hint column
  // does not jump sideways as the list scrolls.
  const labelWidth = Math.max(...choices.map((choice) => choice.label.length));

  const frame = (): string => {
    // Keep the cursor inside the visible window before deciding what to show.
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + WINDOW) offset = cursor - WINDOW + 1;

    const visible = choices.slice(offset, offset + WINDOW);
    const lines = [paint(title, BOLD)];

    for (const [index, choice] of visible.entries()) {
      const absolute = offset + index;
      const active = absolute === cursor;
      const marker = active ? "❯" : " ";

      // Pad before colouring: the escape codes have no width on screen but
      // would be counted by padEnd, shifting every coloured row left.
      const padded = choice.hint ? choice.label.padEnd(labelWidth) : choice.label;
      let label = padded;
      if (choice.disabled) label = paint(padded, DIM);
      else if (active) label = paint(padded, CYAN);

      const hint = choice.hint ? `  ${paint(choice.hint, DIM)}` : "";
      if (choice.separated) lines.push("");
      lines.push(`${marker} ${label}${hint}`);
    }

    if (choices.length > WINDOW) {
      lines.push(paint(`  ${cursor + 1}/${choices.length}`, DIM));
    }
    lines.push(paint(options.footer ?? "↑↓ move · ↵ select · q back", DIM));

    return `${lines.join("\n")}\n`;
  };

  const render = (): void => {
    const text = frame();
    write(rewind(drawn) + text);
    drawn = text.split("\n").length - 1;
  };

  /** Advances the cursor past disabled rows, wrapping at both ends. */
  const move = (step: number): void => {
    for (let attempt = 0; attempt < choices.length; attempt += 1) {
      cursor = (cursor + step + choices.length) % choices.length;
      if (!choices[cursor]!.disabled) return;
    }
  };

  const previousRaw = stdin.isRaw ?? false;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  write(HIDE_CURSOR);
  render();

  return await new Promise<T | null>((resolve, reject) => {
    const cleanup = (): void => {
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      // Wipe the menu on the way out: what the selection *produced* is the
      // useful thing to leave on screen, not the list it came from.
      write(rewind(drawn) + SHOW_CURSOR);
    };

    const onData = (chunk: string): void => {
      switch (chunk) {
        case "\u001b[A": // Up
        case "k":
          move(-1);
          render();
          return;
        case "\u001b[B": // Down
        case "j":
          move(1);
          render();
          return;
        case "\r":
        case "\n": {
          const choice = choices[cursor];
          if (!choice || choice.disabled) return;
          cleanup();
          resolve(choice.value);
          return;
        }
        case "q":
        case "\u001b": // Escape
          cleanup();
          resolve(null);
          return;
        case "\u0003": // Ctrl-C
          cleanup();
          reject(new Error("Cancelled."));
          return;
        default:
          return;
      }
    };

    stdin.on("data", onData);
  });
}

/**
 * Fails before the first frame when there is no terminal to draw on.
 * `alternative` is the non-interactive command that does the same job.
 */
export function requireInteractive(what: string, alternative: string): void {
  if (isInteractive()) return;
  throw new Error(
    `${what} needs an interactive terminal. Use the direct command instead:\n  ${alternative}`,
  );
}

/** A heading printed above whatever a navigator screen renders. */
export function heading(path: string, detail?: string): void {
  write(`\n${paint(path, BOLD)}${detail ? `  ${paint(detail, DIM)}` : ""}\n\n`);
}

/** Waits for any key, so a rendered screen is not swallowed by the next menu. */
export async function pause(message = "↵ continue"): Promise<void> {
  const stdin = process.stdin;
  const previousRaw = stdin.isRaw ?? false;

  write(`\n${paint(message, DIM)}`);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: string): void => {
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      write(`\r\u001b[0J`);
      if (chunk === "\u0003") reject(new Error("Cancelled."));
      else resolve();
    };
    stdin.on("data", onData);
  });
}
