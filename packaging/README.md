# Distribution

How `naijacloud` reaches a user's machine, what each channel needs before its
first release, and what a release actually runs.

Everything except npm ships the **standalone binary** built by
[`scripts/build-binary.mjs`](../scripts/build-binary.mjs): esbuild bundles the
CLI into one CommonJS file, Node's single-executable support turns that into a
blob, and the blob is injected into a copy of the `node` runtime. The result has
no dependency on Node being installed — which is what makes Homebrew, apt, yum,
Scoop and WinGet possible at all.

Node's SEA **cannot cross-compile** (injection needs a `node` binary for the
target platform), so each platform is built on its own CI runner.

---

## Channels

| Channel | Command | Artifact | Needs |
| --- | --- | --- | --- |
| npm | `npm install -g naijacloud-cli` | `build/` (JS) | `NPM_TOKEN` |
| npx | `npx naijacloud-cli login` | same | — |
| Homebrew | `brew install naijacloud` | `*_darwin_*.tar.gz`, `*_linux_*.tar.gz` | a tap repo |
| apt | `apt install naijacloud` | `.deb` | an apt repo + signing key |
| yum/dnf | `yum install naijacloud` | `.rpm` | a yum repo + signing key |
| Scoop | `scoop install naijacloud` | `*_windows_amd64.zip` | a bucket repo |
| WinGet | `winget install NaijaCloud.CLI` | same `.zip` | a PR to winget-pkgs |
| install.sh | `curl … \| sh` | the platform's archive | nothing |

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

Create **`naijacloud/homebrew-tap`** with a `Formula/` directory. The workflow
commits [the rendered formula](templates/homebrew/naijacloud.rb) into it on every
release, so `brew install naijacloud/tap/naijacloud` works immediately, and
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

Create **`naijacloud/scoop-bucket`** with a `bucket/` directory. The rendered
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

| Secret | Used for | Missing means |
| --- | --- | --- |
| `NPM_TOKEN` | `npm publish --provenance` | npm step is skipped |
| `TAP_TOKEN` | pushing to the tap and bucket repos | those steps are skipped |
| `WINGET_TOKEN` | the winget-pkgs PR | that job fails, release survives |
| `MACOS_SIGN_IDENTITY` | Developer ID signing | binaries are ad-hoc signed |

Steps are conditional on their secret existing, so a first release with none of
them still produces a complete GitHub release.

---

## Code signing

macOS binaries are **ad-hoc signed** by default. That is enough for a binary the
user installed themselves via Homebrew or `install.sh` (Homebrew clears the
quarantine attribute, and so does `install.sh`), but a binary downloaded in a
browser will be blocked by Gatekeeper until it is notarized.

To sign properly, set `MACOS_SIGN_IDENTITY` to a Developer ID Application
identity in the build environment, and add a notarization step
(`xcrun notarytool submit`) after the archive is created. Windows binaries are
unsigned; SmartScreen may warn until the download builds reputation, which an
EV certificate would fix.

None of this blocks a first release — it is the difference between a warning and
a smooth install.

---

## Cutting a release

1. Bump `version` in `package.json`, commit.
2. Tag and push: `git tag v0.2.0 && git push --tags`.
3. The [release workflow](../.github/workflows/release.yml) does the rest:
   builds five binaries, verifies each reports the expected version, generates
   checksums, builds `.deb`/`.rpm`, renders every manifest from the **published**
   checksums, creates the GitHub release, publishes to npm, and updates the tap,
   the bucket and winget-pkgs.

The workflow refuses to run if the tag and `package.json` disagree, and the
matrix is `fail-fast` on purpose: rendering a formula whose hashes point at
artifacts that were never uploaded is the classic packaging failure.

### By hand

```bash
npm run binary                       # one platform: dist-bin/naijacloud_<v>_<os>_<arch>[.tar.gz]
(cd dist-bin && shasum -a 256 *.tar.gz *.zip > naijacloud_<v>_checksums.txt)
npm run packaging -- --checksums dist-bin/naijacloud_<v>_checksums.txt
```

`npm run packaging` writes `dist-packaging/` and fails loudly if any platform's
checksum is missing.

---

## Known gaps

- **No `LICENSE` file.** `package.json` says MIT and every manifest here claims
  MIT, but the repository has no license text. WinGet's `LicenseUrl` points at
  `blob/main/LICENSE`, which will 404 until one is added — needed before the
  first WinGet submission.
- **Binary size.** ~110 MB uncompressed, ~35 MB compressed: that is the embedded
  Node runtime, and it is the price of not requiring Node on the target machine.
  A Go or Rust rewrite is the only way substantially below this; `--minify` and
  dropping the code cache would save single-digit megabytes.
- **Placeholder URLs.** `naijacloud/naijacloud-cli`, the tap and the bucket are
  assumed names. Override the first with `NAIJACLOUD_REPO_SLUG`; the tap and
  bucket URLs are literals in the release workflow.
- **`ubuntu-24.04-arm`** is free for public repositories only; a private repo
  needs a paid larger runner or a QEMU cross-build for `linux_arm64`.
