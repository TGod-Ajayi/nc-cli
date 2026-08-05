# naijacloud

A single CLI that does two jobs:

- **`naijacloud login` / `logout` / `whoami`** — authenticate against NaijaCloud from your terminal.
- **`naijacloud mcp`** — run an [MCP](https://modelcontextprotocol.io) server over stdio so an AI agent (Claude Code, Claude Desktop, …) can manage your NaijaCloud hosting: list projects and services, trigger and inspect deploys, pull build logs, attach domains, and set environment variables.

Think of it as what the Vercel CLI is for Vercel, with the agent-facing half exposed as MCP tools.

---

## Install

### Option 1 — npm (global)

```bash
npm install -g naijacloud-cli
```

Or from a local checkout, without publishing:

```bash
git clone https://github.com/naijacloud/naijacloud-cli
cd naijacloud-cli
npm install -g .
```

Either way you get a `naijacloud` executable on your PATH.

### Option 2 — install script

```bash
curl -fsSL https://your-domain.example/install.sh | sh
```

> **Read the script before you pipe it to a shell.** Piping a URL straight into `sh` executes whatever that server returns, and a compromised or swapped host owns your account the moment you run it — this is a real supply-chain attack path, not a formality. Read it first:
>
> ```bash
> curl -fsSL https://your-domain.example/install.sh | less   # inspect
> curl -fsSL https://your-domain.example/install.sh -o install.sh
> sh install.sh                                              # then run
> ```
>
> The raw script is also in this repo: [`install.sh`](install.sh).

The script checks for Node (it will **not** install Node for you — it points you at [nodejs.org](https://nodejs.org/en/download) if it is missing or older than 20), downloads the project to `~/.local/share/naijacloud`, builds it, and symlinks the CLI to `~/.local/bin/naijacloud`. Nothing needs `sudo` and nothing is written outside your home directory. If `~/.local/bin` is not on your PATH it tells you the line to add.

Override any of it with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NAIJACLOUD_REPO` | `https://github.com/naijacloud/naijacloud-cli` | Repo or tarball host to install from |
| `NAIJACLOUD_VERSION` | `main` | Git ref / release tag |
| `NAIJACLOUD_HOME` | `~/.local/share/naijacloud` | Where the source lives |
| `NAIJACLOUD_BIN_DIR` | `~/.local/bin` | Where the symlink goes |

### Option 3 — from source (development)

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
├── install.sh          # curl | sh installer
├── README.md
└── src
    ├── cli.ts          # entrypoint; dispatches login / logout / whoami / mcp
    ├── auth.ts         # credential file (0600) + login / logout / whoami
    ├── api-client.ts   # GraphQL client, token resolution, error mapping
    └── mcp-server.ts   # the MCP server and its eleven tools
```

Built with **TypeScript 7** (the Go-native compiler). Note that TS 7 no longer includes `@types/*` packages automatically — `tsconfig.json` names them explicitly under `types`.

```bash
npm run build       # compile
npm run typecheck   # types only, no emit
npm run inspector   # build/cli.js mcp under the MCP Inspector
```
