# naijacloud

A single CLI that does two jobs:

- **`naijacloud login` / `logout` / `whoami`** — authenticate against NaijaCloud from your terminal.
- **`naijacloud mcp`** — run an [MCP](https://modelcontextprotocol.io) server over stdio so an AI agent (Claude Code, Claude Desktop, …) can manage your NaijaCloud hosting: list projects and services, trigger and inspect deploys, pull build logs, attach domains, and set environment variables.

Think of it as what the Vercel CLI is for Vercel, with the agent-facing half exposed as MCP tools.

---

## Install

### npm

If you have Node.js >= 20 installed, you can install via `npm`:

```bash
npm install -g naijacloud-cli
```

You can also execute commands directly via `npx`, although this won't add `naijacloud` to your `PATH`:

```bash
npx naijacloud-cli login
```

### macOS

**Homebrew:**

```bash
brew install naijacloud
```

### Linux

**apt (Debian, Ubuntu):**

```bash
curl -s https://packages.naijacloud.com/keys/naijacloud.gpg | sudo gpg --dearmor -o /usr/share/keyrings/naijacloud.gpg
echo "deb [signed-by=/usr/share/keyrings/naijacloud.gpg] https://packages.naijacloud.com/deb stable main" | sudo tee /etc/apt/sources.list.d/naijacloud.list
sudo apt update
sudo apt install naijacloud
```

**yum/dnf (RedHat, Fedora, CentOS):**

```bash
echo -e "[naijacloud]\nname=naijacloud\nbaseurl=https://packages.naijacloud.com/rpm/\nenabled=1\ngpgcheck=1\ngpgkey=https://packages.naijacloud.com/keys/naijacloud.gpg" | sudo tee /etc/yum.repos.d/naijacloud.repo
sudo yum install naijacloud
```

Or install a single package straight from a [release](https://github.com/TGod-Ajayi/nc-cli/releases), with no repository:

```bash
sudo dpkg -i naijacloud_0.1.0_amd64.deb        # Debian, Ubuntu
sudo rpm -i naijacloud-0.1.0.x86_64.rpm        # RedHat, Fedora, CentOS
```

### Windows

**WinGet:**

```powershell
winget install NaijaCloud.CLI
```

**Scoop:**

```powershell
scoop install naijacloud
```

### Install script (macOS, Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/TGod-Ajayi/nc-cli/main/install.sh | sh
```

> **Read the script before you pipe it to a shell.** Piping a URL straight into `sh` executes whatever that server returns, and a compromised or swapped host owns your account the moment you run it — this is a real supply-chain attack path, not a formality. Read it first:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/TGod-Ajayi/nc-cli/main/install.sh | less   # inspect
> curl -fsSL https://raw.githubusercontent.com/TGod-Ajayi/nc-cli/main/install.sh -o install.sh
> sh install.sh                                              # then run
> ```
>
> The raw script is also in this repo: [`install.sh`](install.sh).

The script downloads the release archive for your platform, **verifies its SHA-256 against the release's published checksums**, unpacks it into `~/.local/share/naijacloud` and symlinks `~/.local/bin/naijacloud`. Nothing needs `sudo`, nothing is written outside your home directory, and Node is not required — the download is a self-contained executable. If `~/.local/bin` is not on your PATH it tells you the line to add.

Override any of it with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NAIJACLOUD_VERSION` | `latest` | Release to install, e.g. `0.2.0` |
| `NAIJACLOUD_REPO_SLUG` | `TGod-Ajayi/nc-cli` | GitHub `owner/repo` to install from |
| `NAIJACLOUD_BASE_URL` | the GitHub release | Mirror or internal artifact host |
| `NAIJACLOUD_HOME` | `~/.local/share/naijacloud` | Where the binary lives |
| `NAIJACLOUD_BIN_DIR` | `~/.local/bin` | Where the symlink goes |

> Every channel above except npm ships the same standalone executable, which embeds its own runtime — so `brew`, `apt`, `yum`, `scoop` and `winget` installs work on machines with no Node at all. Packaging details, and what a release runs, are in [`packaging/README.md`](packaging/README.md).

### From source (development)

```bash
npm install          # `prepare` builds automatically
npm run build        # or build explicitly: compiles src/ -> build/, chmod +x build/cli.js
node build/cli.js --help
```

---

## Log in

```bash
naijacloud login
```

You are prompted for your NaijaCloud email and password (the password is not echoed). NaijaCloud's control plane has **no personal-access-token feature** — its `login` mutation exchanges email + password for a bearer token — so that is what this does. Your password is never written to disk; only the returned token is.

The token is validated immediately against the API, and **nothing is saved if validation fails**. On success it is written to `~/.naijacloud/config.json` with mode `0600` (owner read/write only), inside a `0700` directory.

Non-interactive alternatives, for CI or scripting:

```bash
naijacloud login --email you@example.com --password "$NC_PASSWORD"
naijacloud login --token "$NC_ACCESS_TOKEN"     # store a token you already hold
```

Check and clear:

```bash
naijacloud whoami    # prints the account, or "Not logged in..." and exits 1
naijacloud logout    # deletes ~/.naijacloud/config.json (friendly no-op if absent)
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOSTING_API_TOKEN` | — | Access token. **Takes precedence over the stored credentials**, so an MCP host can override the account per-server (CI, a second account). |
| `HOSTING_API_BASE_URL` | `https://api.naijacloud.com` | API base URL |
| `HOSTING_API_TIMEOUT_MS` | `30000` | Per-request timeout |

Token resolution order is `HOSTING_API_TOKEN` → `~/.naijacloud/config.json`. If neither is present, every tool call fails immediately with `Not logged in. Run 'naijacloud login' first.` — never a raw 401.

---

## Deploy a static site

```bash
naijacloud deploy
```

That is the whole command. In a directory it has not seen before it asks four questions, deploys, and writes the answers to `naijacloud.json` — so every run after the first takes no arguments at all:

```
$ naijacloud deploy
No naijacloud.json here — a few questions, then this is the last time.

  Site name         [acme-marketing]:
  Build command     (from package.json; 'none' to skip) [npm run build]:
  Output directory  (detected) [dist]:
  Single-page app?  (detected: React Router) [Y/n]:

Running `npm run build`
Packaged 18 files, 2.1 MB → 640 KB compressed
Uploading 640 KB
Created site acme-marketing
  QUEUED
  BUILDING
  RUNNING
https://acme-marketing.naijacloud.com
Wrote naijacloud.json (+ .naijacloud/schema.json for your editor)
```

Defaults are detected locally — the output directory from the conventional build folders, the build command from `package.json`, the SPA fallback from the framework in your dependencies. Nothing is guessed over the network.

The pipeline is: run the build, archive the output, request a presigned upload slot, PUT the bytes straight to storage, then release. The first deploy creates a site; every later one replaces it in place — same site, same URL, atomic cutover, with the previous version still serving if the new build fails.

### `naijacloud.json`

```json
{
  "$schema": ".naijacloud/schema.json",
  "version": 1,
  "name": "acme-marketing",
  "serviceId": "svc_01HX…",
  "build": "npm run build",
  "output": "dist",
  "spa": true,
  "ignore": ["**/*.map"]
}
```

| Field | Purpose |
| --- | --- |
| `name` | Site name, used for the `*.naijacloud.com` subdomain. First deploy only. |
| `serviceId` | Written by the first successful deploy. **Its presence is what makes the next deploy a redeploy.** |
| `build` | Run locally before archiving. A non-zero exit aborts before anything is uploaded. |
| `output` | Directory to deploy, relative to the manifest. May also be a single `.html` file. |
| `spa` | Serve the entry file for unmatched paths, so client-side routes survive a refresh. |
| `index` | Entry file, when it is not `index.html`. |
| `ignore` | Globs excluded from the archive. |

Commit it. The `serviceId` is not a secret — it is only actionable with credentials for the owning team — and committing it is what lets CI deploy from a clean checkout with no linking step and no extra configuration.

`.git`, `node_modules`, `.naijacloud` and **every `.env` file** are excluded from the archive unconditionally, whatever `ignore` says. A static bundle is world-readable by definition, so there is no legitimate case for uploading one.

### Options

| Flag | Effect |
| --- | --- |
| `--prebuilt` | Skip the manifest's build command; the output is already built. |
| `--new` | Create a new site, ignoring the manifest's `serviceId`. |
| `--yes` | Accept detected defaults instead of prompting. Required for a first deploy in CI. |
| `--no-wait` | Return as soon as the build is queued. |
| `--json` | Machine-readable result on stdout. |
| `--name` `--output` `--index` `--spa` / `--no-spa` | One-off overrides of the manifest fields. |

A positional path deploys that directory directly: `naijacloud deploy ./dist` treats it as already built.

Resolution order, highest first: flags → environment (`NAIJACLOUD_SERVICE_ID`, `NAIJACLOUD_OUTPUT`, `NAIJACLOUD_NAME`) → `naijacloud.json` → local detection → the prompt. In CI there is nobody to prompt, so a first deploy there needs `--yes` (or a committed manifest); without one it fails naming the flags it needed rather than hanging on stdin, or quietly creating a new site on every build.

Exit status is non-zero when the build command fails, when the deployment ends `FAILED`, or when the wait times out (`NAIJACLOUD_DEPLOY_TIMEOUT_MS`, default 15 minutes) — so `naijacloud deploy` can gate a pipeline directly.

### The schema ships with the CLI

`naijacloud.json` is validated against a schema generated from the same object that parses it, so editor completion and the CLI can never disagree.

```bash
naijacloud schema             # print the JSON Schema
naijacloud schema --write     # write .naijacloud/schema.json (self-ignoring)
```

The first deploy writes that local copy for you and points `$schema` at it. There is no hosted schema URL: completion works offline, and matches the CLI you actually have installed rather than whatever a website is serving. The generated file also ships in the package at [`schema/naijacloud.schema.json`](schema/naijacloud.schema.json).

Unknown keys are reported and preserved, never rejected — an older CLI can still deploy a repo whose manifest a newer one wrote.

---

## Register with Claude Code

Log in **first**, then add the server:

```bash
naijacloud login

claude mcp add --transport stdio naijacloud -- naijacloud mcp
```

No token goes into the MCP config — the server reads the credentials `naijacloud login` already stored. To scope a server to a different account, add `--env HOSTING_API_TOKEN=<token>`.

If you installed from source and `naijacloud` is not on your PATH, register the absolute path to the built entrypoint instead:

```bash
claude mcp add --transport stdio naijacloud -- node /absolute/path/to/naijacloud-cli/build/cli.js mcp
```

For **Claude Desktop**, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "naijacloud": {
      "command": "naijacloud",
      "args": ["mcp"]
    }
  }
}
```

### Test it by hand

```bash
npx @modelcontextprotocol/inspector node build/cli.js mcp
```

The Inspector opens a browser UI where you can list the tools and call them individually — the quickest way to confirm the server works before wiring it into an agent.

---

## Tools

All eleven tools, as the agent sees them:

| Tool | Parameters | Notes |
| --- | --- | --- |
| `list_projects` | — | Every project across all your teams. Read-only. |
| `get_project` | `projectId` | Project + its environments + the services in each. **This is how you get a `serviceId`.** Read-only. |
| `list_deployments` | `serviceId` \| `projectId` | Exactly one. `projectId` fans out across the project's services. Read-only. |
| `get_deployment` | `deploymentId` | Status, branch, commit, and failure reason. Read-only. |
| `create_deployment` | `serviceId`, `branch?`, `commit?` | Triggers a build + release. Read the environment note below. |
| `delete_deployment` | `deploymentId`, `confirm` | **Cancels** — see below. Requires `confirm: true`. |
| `get_deployment_logs` | `deploymentId`, `limit?` | Build/runtime lines with level and stream. Read-only. |
| `list_domains` | `serviceId` \| `projectId` | Custom domains + the DNS records they need. Read-only. |
| `add_domain` | `serviceId`, `domain` | Attaches a domain; returns the DNS target to point at. |
| `list_env_vars` | `serviceId` \| `projectId` | **Values always masked.** Read-only. |
| `set_env_var` | `serviceId`, `key`, `value`, `target?`, `secret?`, `confirm` | Upserts one variable. Requires `confirm: true`. |

### Safety behaviour

- **`delete_deployment` and `set_env_var` are confirm-gated.** Without `confirm: true` they return an error and perform no action, so an agent has to come back deliberately after checking with you.
- **Values are never echoed.** `list_env_vars` replaces every value with `********` and reports only its length; `set_env_var` does not include the value it wrote in its response. NaijaCloud's API returns env var values in full, so this masking is done here.
- **Tokens are never logged.** Not in tool output, not in error messages, not in diagnostics.
- **stdout is protocol-only.** Under `naijacloud mcp` every diagnostic goes to stderr, so nothing can corrupt the MCP stream.
- **Errors are short and typed.** API failures surface as a status code plus the platform's message, never a stack trace. Auth failures always produce the "Not logged in" guidance.

---

## How this maps onto NaijaCloud's actual API

Worth knowing, because the resource model is **not** Vercel's.

**The control plane is GraphQL, not REST.** It lives at `https://api.naijacloud.com/graphql` and authenticates with `Authorization: Bearer <accessToken>`. NaijaCloud's published documentation covers the dashboard only — there is no REST API reference and no `/v1/...` surface (every such path 404s). The operations in [`src/api-client.ts`](src/api-client.ts) were taken from the live schema by introspection, so they are the real operation names and argument types rather than invented paths. You can re-derive the schema yourself:

```bash
curl -sS -X POST https://api.naijacloud.com/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ __schema { mutationType { fields { name } } } }"}'
```

**The hierarchy is `Team → Project → Environment → Service → Deployment`.** Deployments, custom domains and environment variables all belong to a **service**, not to a project. That is why most tools take a `serviceId`, with `projectId` accepted as a convenience that fans out over the project's services in one nested query. `get_project` is the discovery hop that turns a project into service ids.

Three places where the requested tool shape and the platform genuinely disagree, and what this CLI does about it:

- **`delete_deployment` cancels; it does not delete.** NaijaCloud exposes `cancelDeployment` and no delete mutation — deployment history is immutable. The tool keeps the requested name but its description says plainly that it stops an in-flight deployment (only effective while `QUEUED`/`BUILDING`/`TESTING`/`DEPLOYING`) and does not roll back a live release.
- **`create_deployment` cannot pick a branch or commit.** `triggerDeploy(serviceId)` takes no source override; it builds the tip of the branch configured on the service. The `branch` parameter is therefore treated as an **assertion** — it is checked against the service's configured branch and the call is rejected on a mismatch — and `commit` is rejected outright. Both fail loudly rather than silently deploying something other than what was asked for.
- **Preview vs production is a property of the service, not a flag.** Services live inside a project environment, so `create_deployment` deploys into whichever environment the service belongs to; deploying a service in `prod` **is** a production deploy. The response reports the environment name and whether it is a preview environment.

**Environment variable scopes.** NaijaCloud's scopes are `PROD`, `UAT`, `DEV` and `ALL`. The tool's `target` parameter maps onto them:

| `target` | NaijaCloud scope |
| --- | --- |
| `production` *(default)* | `PROD` |
| `preview` | `UAT` — NaijaCloud's pre-production scope; there is no `PREVIEW` |
| `development` | `DEV` |
| `all` | `ALL` |

`setEnvVars` upserts by key (the platform has a separate `deleteEnvVar` mutation for removal), so setting one variable leaves the service's others untouched. The response reports `needsRedeploy` when the service must be redeployed for the change to take effect.

---

## Project layout

```
.
├── package.json
├── tsconfig.json
├── install.sh              # curl | sh installer (downloads a release binary)
├── schema
│   └── naijacloud.schema.json    # generated from src/deploy-static/manifest.ts
├── scripts
│   ├── build-binary.mjs    # esbuild + Node SEA -> standalone executable
│   └── render-packaging.mjs # fills the package manifests from real checksums
├── packaging               # Homebrew / nfpm / Scoop / WinGet + how to release
├── .github/workflows       # ci.yml, release.yml
└── src
    ├── cli.ts              # entrypoint: arg parsing and dispatch
    ├── terminal.ts         # stderr prompts; refuses to block without a TTY
    ├── api
    │   ├── transport.ts    # GraphQL execute/authed, errors, configuration
    │   ├── types.ts        # the schema subset the CLI surfaces
    │   ├── fields.ts       # shared field selections
    │   ├── account.ts      # me, login
    │   ├── projects.ts     # teams, projects, environments, services
    │   ├── deployments.ts  # history, trigger, cancel, logs
    │   ├── domains.ts      # custom domains
    │   ├── env-vars.ts     # environment variables
    │   ├── static-sites.ts # presigned upload, deploy, redeploy
    │   └── index.ts        # barrel — callers import from here
    ├── auth
    │   └── credentials.ts  # the 0600 credential file and token resolution
    ├── commands
    │   ├── auth.ts         # login / logout / whoami
    │   ├── deploy.ts       # build → archive → upload → release → poll
    │   └── schema.ts       # JSON Schema generation + the `schema` command
    ├── deploy-static
    │   ├── manifest.ts     # naijacloud.json: schema, detection, file selection
    │   └── zip.ts          # dependency-free ZIP writer (node:zlib)
    ├── mcp
    │   └── server.ts       # the MCP server and its eleven tools
    └── scripts
        └── write-schema.ts # build step emitting schema/naijacloud.schema.json
```

Built with **TypeScript 7** (the Go-native compiler). Note that TS 7 no longer includes `@types/*` packages automatically — `tsconfig.json` names them explicitly under `types`.

```bash
npm run build       # compile src/ -> build/, regenerate schema/naijacloud.schema.json
npm run typecheck   # types only, no emit
npm run inspector   # build/cli.js mcp under the MCP Inspector
npm run binary      # standalone executable for this platform, into dist-bin/
npm run packaging   # render the Homebrew / Scoop / WinGet manifests
```
