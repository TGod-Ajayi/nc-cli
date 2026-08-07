#!/usr/bin/env node
/**
 * Builds standalone `naijacloud` executables — no Node installation required on
 * the target machine.
 *
 * This is what makes Homebrew, apt, yum, Scoop and WinGet possible at all:
 * those channels ship a binary, not a node_modules tree. npm and npx keep using
 * `build/cli.js` and are unaffected by any of this.
 *
 * How it works: `bun build --compile` bundles src/cli.ts and embeds it in a
 * copy of the Bun runtime. Unlike Node's SEA support this **cross-compiles**,
 * so one Linux runner can produce every platform's artifact, and Bun's linker
 * ad-hoc signs its own Mach-O output — no `codesign` strip/re-sign step, and
 * nothing here needs a macOS host.
 *
 * Usage:
 *   node scripts/build-binary.mjs                    # the host platform
 *   node scripts/build-binary.mjs --target linux_arm64
 *   node scripts/build-binary.mjs --target all       # every platform
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/* -------------------------------------------------------------------------- */
/* Targets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Artifact naming follows the convention every downstream packager already
 * expects (`linux_amd64`, not Bun's `linux-x64`), so Homebrew, nfpm, Scoop and
 * WinGet can all point at the same URLs.
 */
const TARGETS = {
  darwin_arm64: "bun-darwin-arm64",
  darwin_amd64: "bun-darwin-x64",
  linux_amd64: "bun-linux-x64",
  linux_arm64: "bun-linux-arm64",
  windows_amd64: "bun-windows-x64",
};

/**
 * Short alias shipped alongside the binary; see the Alias section below.
 * Not `nc` — that name belongs to netcat on virtually every Unix machine.
 */
const ALIAS_NAME = "njc";

const OS_NAMES = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCH_NAMES = { x64: "amd64", arm64: "arm64" };
const hostTarget = `${OS_NAMES[process.platform]}_${ARCH_NAMES[process.arch]}`;

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outDir = resolve(root, flag("out", "dist-bin"));
const requested = flag("target", hostTarget);
const targets = requested === "all" ? Object.keys(TARGETS) : [requested];

for (const target of targets) {
  if (!TARGETS[target]) {
    throw new Error(`Unknown target "${target}". Known: ${Object.keys(TARGETS).join(", ")}, all.`);
  }
}

function step(message) {
  process.stderr.write(`• ${message}\n`);
}

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

/** Fails with a readable message rather than a raw ENOENT if Bun is absent. */
try {
  execFileSync("bun", ["--version"], { stdio: "pipe" });
} catch {
  throw new Error("bun is required to build the binaries — see https://bun.sh/docs/installation");
}

/**
 * The CLI's own ZIP writer, reused rather than shelled out to.
 *
 * `zip` is not on the Windows runner images, and `Compress-Archive` cannot run
 * on the Linux box that cross-builds the Windows target — no external tool is
 * present in both places, which is the whole reason src/deploy-static/zip.ts
 * exists. Loading it here keeps one archiving path on every host.
 *
 * It is loaded from build/, so `npm run build` has to have run: `npm run
 * binary` and the workflows all do that first. Only needed for a Windows
 * target, so a plain `--target linux_arm64` still runs against a bare checkout.
 */
let createZip;
if (targets.some((target) => target.startsWith("windows"))) {
  const writer = join(root, "build/deploy-static/zip.js");
  if (!existsSync(writer)) {
    throw new Error(`${writer} is missing — run \`npm run build\` before building the binaries.`);
  }
  // A file URL, not a path: bare `D:\...` is not a valid import specifier.
  ({ createZip } = await import(pathToFileURL(writer).href));
}

const built = [];

for (const target of targets) {
  const isWindows = target.startsWith("windows");
  const binaryName = isWindows ? "naijacloud.exe" : "naijacloud";
  /** Each build lands in its own directory, so packagers can archive the folder. */
  const stageDir = join(outDir, `naijacloud_${pkg.version}_${target}`);
  const artifact = join(stageDir, binaryName);

  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  step(`Compiling ${target}`);
  execFileSync(
    "bun",
    [
      "build",
      "--compile",
      `--target=${TARGETS[target]}`,
      join(root, "src/cli.ts"),
      // The binary has no package.json beside it, so the version is inlined.
      // A non-bundled run leaves the identifier undeclared and falls back to
      // reading package.json — see CLIENT_VERSION in src/api/transport.ts.
      "--define",
      `__NAIJACLOUD_VERSION__=${JSON.stringify(pkg.version)}`,
      "--outfile",
      artifact,
    ],
    { stdio: "inherit", cwd: root },
  );

  /* ------------------------------------------------------------------------ */
  /* Alias                                                                    */
  /* ------------------------------------------------------------------------ */

  // `njc` is the short name for the same executable. A relative symlink beside
  // the binary costs nothing and survives tar, so anyone who just unpacks the
  // archive onto their PATH gets both names. Windows has no equivalent in a
  // .zip, so there the alias is created by the installer instead — Scoop makes
  // a second shim, WinGet a second execution alias.
  if (!isWindows) {
    symlinkSync(binaryName, join(stageDir, ALIAS_NAME));
  }

  // Only the host's own artifact can be executed here; the rest are verified by
  // the smoke-test job in the release workflow, on a runner that can run them.
  let reported = "(cross-compiled, not run)";
  if (target === hostTarget) {
    step("Verifying");
    reported = execFileSync(artifact, ["--version"], { encoding: "utf8" }).trim();
    if (reported !== pkg.version) {
      throw new Error(`Binary reports version ${reported}, expected ${pkg.version}.`);
    }

    // The alias is a real entrypoint, not documentation — a broken symlink here
    // would otherwise only surface once someone had installed the release.
    if (!isWindows) {
      const aliased = execFileSync(join(stageDir, ALIAS_NAME), ["--version"], {
        encoding: "utf8",
      }).trim();
      if (aliased !== pkg.version) {
        throw new Error(`${ALIAS_NAME} reports version ${aliased}, expected ${pkg.version}.`);
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Archive                                                                  */
  /* ------------------------------------------------------------------------ */

  // The archive is what actually ships: Homebrew, Scoop and install.sh all
  // fetch one of these, and nfpm reads the binary out of the staging directory.
  const archive = isWindows ? `${stageDir}.zip` : `${stageDir}.tar.gz`;
  rmSync(archive, { force: true });

  step(`Archiving → ${archive}`);
  if (isWindows) {
    // Flat, single-entry archive — the same shape `zip -j` produced, and what
    // Scoop expects. The alias is not in here; on Windows the installer makes
    // it, as the Alias section above explains.
    const { buffer } = createZip([{ path: binaryName, contents: readFileSync(artifact) }]);
    writeFileSync(archive, buffer);
  } else {
    // The alias is stored as a symlink, not a second copy of the binary, so the
    // archive stays the size of one executable.
    execFileSync("tar", ["-czf", archive, "-C", stageDir, binaryName, ALIAS_NAME], {
      stdio: "inherit",
    });
  }

  built.push({ target, artifact, archive, reported });
}

process.stderr.write("\n");
for (const { target, artifact, archive, reported } of built) {
  process.stderr.write(`naijacloud ${reported} (${target})\n  ${artifact}\n  ${archive}\n`);
}
