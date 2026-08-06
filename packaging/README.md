# Distribution

How `naijacloud` reaches a user's machine, what each channel needs before its
first release, and what a release actually runs.

Everything except npm ships the **standalone binary** built by
[`scripts/build-binary.mjs`](../scripts/build-binary.mjs), which wraps
`bun build --compile`: the CLI is bundled and embedded into a copy of the Bun
runtime. The result has no dependency on Node being installed — which is what
makes Homebrew, apt, yum, Scoop and WinGet possible at all.

Bun **cross-compiles**, so all five platforms are built on one Linux runner in
about twelve seconds, and Bun's linker ad-hoc signs its own Mach-O output — no
macOS host and no `codesign` step are needed to produce a runnable darwin
binary. Because a cross-compiled artifact cannot be executed on the machine that
produced it, the `smoke` job runs each one on its native runner before the
release proceeds.

---

## Channels

| Channel    | Command                         | Artifact                                | Needs                     |
| ---------- | ------------------------------- | --------------------------------------- | ------------------------- |
| npm        | `npm install -g naijacloud-cli` | `build/` (JS)                           | `NPM_TOKEN`               |
| npx        | `npx naijacloud-cli login`      | same                                    | —                         |
| Homebrew   | `brew install naijacloud`       | `*_darwin_*.tar.gz`, `*_linux_*.tar.gz` | a tap repo                |
| apt        | `apt install naijacloud`        | `.deb`                                  | an apt repo + signing key |
| yum/dnf    | `yum install naijacloud`        | `.rpm`                                  | a yum repo + signing key  |
| Scoop      | `scoop install naijacloud`      | `*_windows_amd64.zip`                   | a bucket repo             |
| WinGet     | `winget install NaijaCloud.CLI` | same `.zip`                             | a PR to winget-pkgs       |
| install.sh | `curl … \| sh`                  | the platform's archive                  | nothing                   |

Artifact names are fixed across all of them:

```
naijacloud_<version>_<os>_<arch>.tar.gz    darwin/linux, amd64/arm64
naijacloud_<version>_windows_amd64.zip
naijacloud_<version>_checksums.txt
naijacloud_<version>_<arch>.deb  /  naijacloud-<version>.<arch>.rpm
```

---

## One-time setup

Nothing below is created by the release workflow; each has to exist first.

### Homebrew

Create **`TGod-Ajayi/homebrew-tap`** with a `Formula/` directory. The workflow
commits [the rendered formula](templates/homebrew/naijacloud.rb) into it on every
release, so `brew install TGod-Ajayi/tap/naijacloud` works immediately, and
`brew install naijacloud` once the tap is tapped.

Homebrew core (plain `brew install naijacloud`, no tap) has its own bar —
notability, a stable release history, no `HEAD`-only versions — and is worth
applying for only after the tap has been live for a while.

### apt and yum

The workflow builds `.deb` and `.rpm` files with
[nfpm](https://nfpm.goreleaser.com/) and attaches them to the release, which
covers `dpkg -i` / `rpm -i`. Repository hosting is a separate decision, because
`apt install naijacloud` needs a signed, indexed repo:

- **Hosted:** Cloudsmith, Packagecloud, or JFrog. Simplest; a token in CI and
  one `push` step per package.
- **Self-hosted:** `aptly` (or `reprepro`) and `createrepo_c` behind a CDN, with
  a GPG key whose public half users import.

Either way, publish the key at a stable URL and document the two-line install in
the README. The packages themselves declare **no dependency on nodejs** — the
binary carries its own runtime.

### Scoop

Create **`TGod-Ajayi/scoop-bucket`** with a `bucket/` directory. The rendered
[manifest](templates/scoop/naijacloud.json) carries `checkver` and `autoupdate`,
so Scoop's own bots can pick up later releases even if a workflow run is missed.

### WinGet

The [manifests](templates/winget) are submitted as a pull request to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) — the `winget`
job in the release workflow does this with `winget-releaser`, which needs a
classic PAT (`public_repo`) stored as `WINGET_TOKEN` and a fork of winget-pkgs on
that account. The first submission is reviewed by a human; later ones are usually
automatic.

The package ships as a `zip` with a `portable` nested installer, so there is no
MSI to sign and no elevation prompt.

### Secrets the workflow reads

| Secret                | Used for                            | Missing means                    |
| --------------------- | ----------------------------------- | -------------------------------- |
| `NPM_TOKEN`           | `npm publish --provenance`          | npm step is skipped              |
| `TAP_TOKEN`           | pushing to the tap and bucket repos | those steps are skipped          |
| `WINGET_TOKEN`        | the winget-pkgs PR                  | that job fails, release survives |
| `MACOS_SIGN_IDENTITY` | Developer ID signing                | binaries are ad-hoc signed       |

Steps are conditional on their secret existing, so a first release with none of
them still produces a complete GitHub release.

---

## Code signing

macOS binaries are **ad-hoc signed by Bun's own linker**, on whichever host
built them. That is enough for a binary the user installed themselves via
Homebrew or `install.sh` (Homebrew clears the quarantine attribute, and so does
`install.sh`), but a binary downloaded in a browser will be blocked by
Gatekeeper until it is notarized.

Signing properly with a Developer ID Application identity requires a macOS
runner — `codesign` and `xcrun notarytool` only exist there — so it means adding
a darwin-only job back to the release workflow. Windows binaries are unsigned;
SmartScreen may warn until the download builds reputation, which an EV
certificate would fix.

None of this blocks a first release — it is the difference between a warning and
a smooth install.

---

## Cutting a release

1. Bump `version` in `package.json`, commit.
2. Tag and push: `git tag v0.2.0 && git push --tags`.
3. The [release workflow](../.github/workflows/release.yml) does the rest:
   cross-compiles five binaries on one runner, runs each on its native platform
   to confirm it starts and reports the expected version, generates checksums,
   builds `.deb`/`.rpm`, renders every manifest from the **published** checksums,
   creates the GitHub release, publishes to npm, and updates the tap, the bucket
   and winget-pkgs.

The workflow refuses to run if the tag and `package.json` disagree, and `smoke`
is `fail-fast` on purpose: rendering a formula whose hashes point at artifacts
that were never uploaded — or at one that will not start — is the classic
packaging failure.

### By hand

Requires [Bun](https://bun.sh); every target builds from any machine.

```bash
npm run binary:all                   # all five: dist-bin/naijacloud_<v>_<os>_<arch>[.tar.gz|.zip]
(cd dist-bin && shasum -a 256 *.tar.gz *.zip > naijacloud_<v>_checksums.txt)
npm run packaging -- --checksums dist-bin/naijacloud_<v>_checksums.txt
```

`npm run binary` alone builds just the host platform.

`npm run packaging` writes `dist-packaging/` and fails loudly if any platform's
checksum is missing.

---

## Known gaps

- **Binary size.** 62 MB on darwin_arm64, 82 MB on darwin_amd64, ~104 MB on
  Linux and ~110 MB on Windows; 23–37 MB compressed, which is what a user
  actually downloads. That is the embedded Bun runtime, and it is the price of
  not requiring Node on the target machine. `--minify` saves about 1 MB and
  costs readable stack traces, so it is off. A Go or Rust rewrite is the only
  way substantially below this.
- **The tap and the bucket do not exist yet.** The source repository is
  `TGod-Ajayi/nc-cli` — override it with `NAIJACLOUD_REPO_SLUG` — but
  `TGod-Ajayi/homebrew-tap` and `TGod-Ajayi/scoop-bucket` still have to be
  created by hand; their URLs are literals in the release workflow.
- **The repository is private.** Every install path here reads from public
  GitHub release assets, so none of them work until it is made public: the
  install script's unauthenticated call to `api.github.com/repos/.../releases/latest`
  404s, and Homebrew, Scoop and WinGet cannot fetch the archives. `ubuntu-24.04-arm`
  is also free for public repositories only; a private repo needs a paid larger
  runner or a QEMU cross-build for `linux_arm64`.
