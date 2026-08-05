#!/usr/bin/env node
/**
 * Builds a standalone `naijacloud` executable — no Node installation required
 * on the target machine.
 *
 * This is what makes Homebrew, apt, yum, Scoop and WinGet possible at all:
 * those channels ship a binary, not a node_modules tree. npm and npx keep using
 * `build/cli.js` and are unaffected by any of this.
 *
 * How it works (Node's Single Executable Application support):
 *
 *   1. esbuild bundles src/cli.ts and its dependencies into one CommonJS file
 *      (SEA blobs are CJS-only, hence the format conversion).
 *   2. `node --experimental-sea-config` turns that file into a blob.
 *   3. The blob is injected into a copy of the `node` binary with postject.
 *   4. macOS binaries are re-signed, because injecting invalidates the
 *      signature and Gatekeeper refuses to run the result otherwise.
 *
 * Cross-compilation is not possible: step 3 needs a `node` binary for the
 * target platform, so each platform is built on its own CI runner. Run with
 * `--node <path>` to inject into a downloaded runtime instead of the running
 * one.
 *
 * Usage:
 *   node scripts/build-binary.mjs [--out dist-bin] [--node /path/to/node]
 */

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const outDir = resolve(root, flag("out", "dist-bin"));
const nodeBinary = resolve(flag("node", process.execPath));
const work = join(outDir, ".work");

/**
 * Artifact naming follows the convention every downstream packager already
 * expects (`linux_amd64`, not Node's `linux_x64`), so Homebrew, nfpm, Scoop and
 * WinGet can all point at the same URLs.
 */
const OS_NAMES = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCH_NAMES = { x64: "amd64", arm64: "arm64" };

const osName = OS_NAMES[process.platform];
const archName = ARCH_NAMES[process.arch];
if (!osName || !archName) {
  throw new Error(`Unsupported build host: ${process.platform}/${process.arch}.`);
}

const target = `${osName}_${archName}`;
const isWindows = process.platform === "win32";
const binaryName = isWindows ? "naijacloud.exe" : "naijacloud";
/** Each build lands in its own directory, so packagers can archive the folder. */
const stageDir = join(outDir, `naijacloud_${pkg.version}_${target}`);
const artifact = join(stageDir, binaryName);

function step(message) {
  process.stderr.write(`• ${message}\n`);
}

/* -------------------------------------------------------------------------- */
/* 1. Bundle                                                                  */
/* -------------------------------------------------------------------------- */

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const bundlePath = join(work, "bundle.cjs");

step(`Bundling src/cli.ts → ${bundlePath}`);
await (await import("esbuild")).build({
  entryPoints: [join(root, "src/cli.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: bundlePath,
  minify: false, // keep stack traces readable; size is not the constraint here
  legalComments: "none",
  define: {
    // The binary has no package.json beside it, so the version is inlined here.
    // A non-bundled run leaves the identifier undeclared and falls back to
    // reading package.json — see CLIENT_VERSION in src/api/transport.ts.
    __NAIJACLOUD_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    // Dynamic `import()` of a bundled module resolves through require() here;
    // esbuild rewrites those calls, so nothing else is needed at runtime.
    js: "/* naijacloud CLI — bundled for single-executable packaging */",
  },
});

/* -------------------------------------------------------------------------- */
/* 2. Blob                                                                    */
/* -------------------------------------------------------------------------- */

const seaConfig = join(work, "sea-config.json");
const blobPath = join(work, "naijacloud.blob");

writeFileSync(
  seaConfig,
  `${JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      // The snapshot would run top-level code at build time; this CLI reads
      // argv and the environment on startup, so it must not be snapshotted.
      useSnapshot: false,
      useCodeCache: true,
    },
    null,
    2,
  )}\n`,
);

step("Generating the SEA blob");
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

/* -------------------------------------------------------------------------- */
/* 3. Inject                                                                  */
/* -------------------------------------------------------------------------- */

mkdirSync(stageDir, { recursive: true });
rmSync(artifact, { force: true });
copyFileSync(nodeBinary, artifact);
chmodSync(artifact, 0o755);

// macOS refuses to run a binary whose signature no longer matches, and the
// injection changes the bytes — so strip the signature first, re-sign after.
if (process.platform === "darwin") {
  step("Removing the existing signature");
  try {
    execFileSync("codesign", ["--remove-signature", artifact], { stdio: "inherit" });
  } catch {
    process.stderr.write("  (nothing to remove)\n");
  }
}

step(`Injecting the blob into ${binaryName}`);
const postjectArgs = [
  artifact,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];
if (process.platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");

execFileSync(process.execPath, [require.resolve("postject/dist/cli.js"), ...postjectArgs], {
  stdio: "inherit",
});

if (process.platform === "darwin") {
  step("Re-signing (ad-hoc; CI replaces this with the Developer ID identity)");
  const identity = process.env["MACOS_SIGN_IDENTITY"] ?? "-";
  execFileSync("codesign", ["--sign", identity, "--force", artifact], { stdio: "inherit" });
}

/* -------------------------------------------------------------------------- */
/* 4. Verify                                                                  */
/* -------------------------------------------------------------------------- */

step("Verifying");
const reported = execFileSync(artifact, ["--version"], { encoding: "utf8" }).trim();
if (reported !== pkg.version) {
  throw new Error(`Binary reports version ${reported}, expected ${pkg.version}.`);
}

rmSync(work, { recursive: true, force: true });

// The archive is what actually ships: Homebrew, Scoop and install.sh all fetch
// one of these, and nfpm reads the binary out of the same staging directory.
const archive = isWindows ? `${stageDir}.zip` : `${stageDir}.tar.gz`;
rmSync(archive, { force: true });

step(`Archiving → ${archive}`);
if (isWindows) {
  // PowerShell's Compress-Archive is the one zip tool present on every runner.
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Compress-Archive -Path "${artifact}" -DestinationPath "${archive}"`],
    { stdio: "inherit" },
  );
} else {
  execFileSync("tar", ["-czf", archive, "-C", stageDir, binaryName], { stdio: "inherit" });
}

process.stderr.write(
  `\nnaijacloud ${reported} (${target})\n  ${artifact}\n  ${archive}\n`,
);
