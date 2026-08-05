# CLI feature gaps — what the dashboard can do that `naijacloud` cannot

Audience: whoever is building out this CLI. This maps the operations the
NaijaCloud dashboard (`nc-dashboard`) actually consumes against what this CLI
and its MCP server expose today, and proposes the command surface to close the
gap.

Source of truth for "what the API can do" is the set of GraphQL documents the
dashboard ships — `modules/*/*.gql` in `nc-dashboard`, all generated against the
live endpoint. Where a feature is called out as missing, the backing operation
was read from those files, not guessed.

Legend: ✅ covered · 🟡 partial · 🔴 absent.

---

## 1. Where the CLI stands

The terminal surface is **auth-only**. [`src/cli.ts`](src/cli.ts) dispatches four
commands:

```
naijacloud login | logout | whoami | mcp
```

Everything operational lives behind the MCP server in
[`src/mcp-server.ts`](src/mcp-server.ts) — eleven tools:

`list_projects` · `get_project` · `list_deployments` · `get_deployment` ·
`create_deployment` · `delete_deployment` (cancel) · `get_deployment_logs` ·
`list_domains` · `add_domain` · `list_env_vars` · `set_env_var`

That is roughly **30 of the ~190 operations** the dashboard uses — about 15% of
the product's surface, and none of it reachable by a human at a prompt. A user
can authenticate from the terminal and then has to open a browser to do anything.

---

## 2. Coverage map

| Domain | Dashboard operations | CLI | MCP |
| --- | --- | --- | --- |
| Auth | `login`, `signup`, `githubLoginUrl`, `googleLoginUrl`, `requestPasswordReset`, `resetPassword`, `me` | 🟡 password only | 🔴 |
| Teams | `myTeams`, `teamMembers`, `inviteToTeam`, `removeMember`, `renameTeam`, `setTeamDefaultRegion`, `setTeamDeploymentPreviews` | 🔴 | 🔴 |
| Billing & usage | `workspaceUsageMeters`, `workspaceBilling`, `workspaceInvoices`, `invoice`, `changeWorkspacePlan` | 🔴 | 🔴 |
| Projects | `createProject`, `updateProject`, `deleteProject`, `createEnvironment`, `deleteEnvironment`, `projectEnvironments` | 🔴 | 🟡 read-only |
| Services | `createService`, `createDatastoreService`, `detectBuild`, `deleteService`, `updateServiceBuild`, `updateServiceSource`, `updateServiceResources`, `updateServiceRegion`, `disconnectServiceRepo`, `serviceConnectionDetails`, `myServices`, `deployLocations` | 🔴 | 🔴 |
| Env vars & secret files | `setEnvVars`, `deleteEnvVar`, `serviceSecretFiles`, `setSecretFile`, `deleteSecretFile` | 🔴 | 🟡 set only |
| Deployments | `triggerDeploy`, `cancelDeployment`, `deploymentLogs`, socket.io live streams | 🔴 | ✅ mostly |
| Domains | `addCustomDomain`, `verifyCustomDomain`, `removeCustomDomain`, `dnsTarget.records` / `.conflicts` | 🔴 | 🟡 add + list |
| PR previews | `servicePreviews`, `prPreview`, `setServicePreviewsEnabled`, `teardownPreview` | 🔴 | 🔴 |
| Cron jobs | `cronRuns`, `cronRun`, `cronRunLogs`, `runCronJob`, `deployCronJob`, `updateCronJob`, `setCronJobSuspended`, `cronStats` | 🔴 | 🔴 |
| Databases (Studio) | `runDatabaseQuery`, `databaseObjects`, `tableColumns`, `tableStats`, `schemaGraph`, `insertRow`, `updateRow`, `deleteRow`, `migrations`, `savedQueries`, `exportDatabase`, `exportTable` | 🔴 | 🔴 |
| Backups | `backups`, `backupSchedule`, `setBackupFrequency`, `runBackupNow`, `restoreBackup`, `deleteBackup`, `backupDownloadUrl`, `restore` | 🔴 | 🔴 |
| Redis / cache | `redisKeys`, `redisValue`, `cacheStats`, `cacheConfig`, `setCacheConfig`, `runCacheCommand` | 🔴 | 🔴 |
| Object storage | ~25 ops — buckets, objects, presigned upload/download, policy, CORS, lifecycle, versioning, credentials | 🔴 | 🔴 |
| Static sites | `createStaticUpload`, `deployStaticSite`, `redeployStaticSite`, `staticSites` | 🔴 | 🔴 |
| GitHub | `githubConnection`, `githubAccounts`, `githubRepositories`, `githubRepositoryBranches`, `githubAppInstallUrl` | 🔴 | 🔴 |
| Metrics | `serviceMetrics`, `serviceUsage`, `liveServiceStats`, `projectUsage`, `webHeadlineMetrics`, `webRequestSeries`, `serviceHeadline` | 🔴 | 🔴 |
| Activity & status | `workspaceActivity`, `platformStatus`, `statusIncidents` | 🔴 | 🔴 |
| Support | `createSupportTicket`, `myTickets`, `myTicket`, `replyToTicket` | 🔴 | 🔴 |

---

## 3. Tier 1 — the reasons a CLI exists

These are the features where a terminal beats the dashboard, not merely
duplicates it. Ordered by impact.

### 3.1 `naijacloud deploy ./dist` — zero-config static deploy ✅

**Status: implemented.** `src/deploy.ts` (pipeline), `src/manifest.ts` (schema,
detection, archive selection), `src/zip.ts` (dependency-free ZIP writer),
`src/schema.ts` (JSON Schema), plus the static-site operations in
`src/api-client.ts`. User-facing docs live in the README; the rest of this
section is the design it was built to.

The flagship. `nc-dashboard/modules/static-sites/static-sites.gql` describes the
whole flow, and it is CLI-shaped end to end:

1. `createStaticUpload(input: { filename, contentType, sizeBytes })` → a
   presigned slot: `{ uploadId, url, method, headers, maxBytes, expiresInSeconds }`.
2. `PUT` the bytes straight to storage — echo `headers` verbatim, send **no**
   `Authorization` header (the signature is in the URL).
3. `deployStaticSite(input: { uploadId, name, indexPath, spaFallback })` →
   `{ site, deployment }`, with the first build already queued.
4. Poll `deployment(id).status` until `RUNNING` / `FAILED`.

`redeployStaticSite(input: { serviceId, uploadId, … })` replaces a site in place,
same URL, atomic cutover — that is `naijacloud deploy` run a second time.

#### The manifest: `naijacloud.json`

**The CLI owns this file.** There is no setup step and nothing to hand-write:
`naijacloud deploy` reads `naijacloud.json` if it is there, and if it is not, it
asks the questions at the prompt and writes the answers out. Every deploy after
the first is argument-free, on a laptop and in CI, doing the same thing both
times.

The manifest is designed to grow — see *Extending it* below. Treat the v1 keys
as a floor, not a fixed schema.

```json
{
  "$schema": ".naijacloud/schema.json",
  "version": 1,
  "name": "acme-marketing",
  "serviceId": "svc_01HX…",
  "build": "npm run build",
  "output": "dist",
  "spa": true,
  "index": "index.html",
  "ignore": ["**/*.map", "coverage/**"]
}
```

| Field | Type | Maps to | Notes |
| --- | --- | --- | --- |
| `$schema` | string | — | Points at the copy the CLI drops in `.naijacloud/`; see *The schema ships with the CLI*. |
| `version` | number | — | Manifest format version. Written from day one so a genuine breaking change has somewhere to announce itself. |
| `name` | string | `DeployStaticSiteInput.name` | First deploy only; ignored once `serviceId` is set. Defaults to the directory name. |
| `serviceId` | string | `RedeployStaticSiteInput.serviceId` | Written back by the first successful deploy. **Its presence is what turns a deploy into a redeploy** — same site, same URL, atomic cutover. |
| `build` | string | — | Run locally before zipping. Skipped by `--prebuilt`. A non-zero exit aborts the deploy before anything is uploaded. |
| `output` | string | the directory that gets zipped | Guessed locally — first existing of `dist`, `build`, `out`, `public`, `_site`. |
| `spa` | boolean | `DeployStaticSiteInput.spaFallback` | Guessed locally from the framework in `package.json` (Vite/CRA/Vue/Svelte SPA templates → true; Astro/Eleventy/Hugo → false). |
| `index` | string | `DeployStaticSiteInput.indexPath` | Only needed when the entry file is not `index.html`. |
| `ignore` | string[] | — | Globs excluded from the archive, on top of the always-excluded set below. |

#### The schema ships with the CLI

No hosted schema URL. Editor completion should work on a plane, behind a
corporate proxy, and for a CLI version that is two releases old — a
`https://naijacloud.com/schema/…` reference gives none of that, and pins every
repo to whatever the website is serving today rather than to the CLI that
actually parses the file.

**One source of truth: a `zod` schema in `src/manifest.ts`**, which is also what
validates the manifest at read time. `zod@4` is already a dependency, and
`z.toJSONSchema()` converts it, so the build emits
`schema/naijacloud.schema.json` from the same object the CLI enforces. Add
`schema` to `files` in [`package.json`](package.json) so it ships, and generate
it in the existing `build` script — the published JSON Schema then cannot drift
from the validator, because it *is* the validator.

Two ways it reaches an editor:

```
naijacloud schema              print the JSON Schema to stdout
naijacloud schema --write      write .naijacloud/schema.json (gitignored)
```

The first-run prompt does the `--write` automatically and sets
`"$schema": ".naijacloud/schema.json"` in the manifest, so completion and
inline validation work in VS Code and the JetBrains IDEs with no configuration
and no network. Regenerating on CLI upgrade is one command; a stale local copy
degrades to weaker editor hints, never to a failed deploy, because the CLI
validates against its own compiled-in schema regardless of what
`$schema` points at.

For teams that would rather commit the schema than gitignore it, `--write
<path>` covers it. Publishing the same file to a URL later remains possible and
purely additive — the generated artifact is the same either way.

#### First run: no manifest

`naijacloud deploy` in a directory with no `naijacloud.json` runs a short
prompt, pre-filled by **local** detection so most answers are a keypress:

```
$ naijacloud deploy
No naijacloud.json here — a few questions, then this is the last time.

  Site name           acme-marketing        (dir name)
  Build command       npm run build         (detected: vite)
  Output directory    dist                  (detected)
  Single-page app?    yes                   (detected)

Deploying dist (18 files, 2.1 MB)…
✓ https://acme-marketing.naijacloud.com
✓ Wrote naijacloud.json (+ .naijacloud/schema.json for your editor)
  Next time, just `naijacloud deploy`.
```

The file is written **after** the deploy succeeds, with the returned
`serviceId` folded in, so a failed first attempt doesn't leave a half-configured
repo behind.

**Detection is local, and is the CLI's own job.** The server-side `detectBuild`
query takes `gitUrl` / `repoFullName` / `branch` / `rootDir` — it inspects a
*connected repository*, so it cannot see an uncommitted working directory and is
the wrong tool here. Reading `package.json` (scripts, framework dependencies,
`packageManager`) and probing for a conventional output directory covers the
static case with no network call at all. `detectBuild` still belongs in the
repo-connected flows in §4 (`init`, `services create`).

**Resolution order**, highest first: CLI flags → environment
(`NAIJACLOUD_SERVICE_ID`, `NAIJACLOUD_OUTPUT`, …) → `naijacloud.json` → local
detection → the prompt above. Anything supplied by flag is never asked for. In a
non-TTY (CI) with no manifest, there is nothing to prompt with, so the run fails
naming the flags it needed instead of hanging on stdin.

**Always excluded from the archive**, not overridable: `.git`, `node_modules`,
`.naijacloud`, and `.env` / `.env.*`. A static bundle ships to a public CDN, so
uploading a `.env` is a credential leak with no legitimate use — the CLI should
drop those paths unconditionally and say so in its output. `naijacloud.json`
itself is excluded too; it is build input, not a build artifact.

**Size check.** `createStaticUpload` returns `maxBytes`; compare the archive
against it before the PUT so an oversized bundle fails locally with the actual
limit instead of a storage-layer error.

**Why the id is committed.** CI deploys from a clean checkout with no link step
and no extra secret beyond `HOSTING_API_TOKEN`, and everyone on the team
redeploys the same site instead of accidentally creating parallel ones. Service
ids are not secrets — the id is only actionable with credentials for the owning
team, so a fork inheriting it cannot deploy over your site. The tradeoff is that
a fork's first `naijacloud deploy` fails on permissions rather than creating its
own site; `--new` is the escape hatch.

**Monorepos.** v1 resolves one manifest by walking up from the working
directory, so `apps/site/naijacloud.json` deploys that app. A multi-target
`"sites": [...]` array is a later addition, not a v1 concern.

#### Extending it

Static deploy is the first consumer of this file, not the only one. The obvious
next tenants, all backed by operations the API already exposes:

- **Web/cron services** — `buildCommand`, `startCommand`, `runtime`,
  `runtimeVersion`, `port`, `rootDir`, `watchPaths`, `monorepoStrategy`,
  `schedule`. Every one is a field `updateServiceBuild` / `createService` already
  accepts, which makes `naijacloud deploy` for a real service a `detectBuild` +
  manifest read away.
- **Targeting** — `projectId`, `environmentId`, `region`, `tier`, so a repo can
  say which project and environment it belongs to (§3.4).
- **Multi-target** — a `"sites"` / `"services"` array for monorepos.
- **Domains** — declared custom domains reconciled on deploy.

Three rules keep that growth cheap:

1. **Additive only.** New capabilities arrive as new keys; existing keys never
   change meaning. Bump `version` only for a real break.
2. **Unknown keys warn, never fail.** An older CLI must tolerate a manifest
   written by a newer one — the alternative is a repo that only one version of
   the CLI can deploy. (This is a `.passthrough()` on the `zod` object, plus a
   one-line notice naming the keys it skipped.)
3. **No secrets, ever.** The file is committed and ships next to the build.
   Credentials go through `env set` / `secrets set`.

Every one of those additions is a change to `src/manifest.ts` alone: the
validator, the generated JSON Schema and this documentation all follow from it.

#### The command

```
naijacloud deploy [dir]          build → zip → upload → deploy; prints the live URL
  --prebuilt                     skip the manifest's build step
  --new                          create a new site, ignoring manifest serviceId
  --name/--output/--spa/--index  one-off overrides; also answer the first-run prompt
  --yes                          accept every detected default, no prompt
  --json                         machine-readable result
```

`naijacloud init` is then just the prompt without the deploy — worth having, but
nobody needs to know it exists.

This is the `vercel` / `netlify deploy` moment. Nothing in the browser does it
well, and the API is already built for it.

### 3.2 `naijacloud logs --follow` — runtime logs

**There is no GraphQL query for runtime logs.** `deploymentLogs` returns *build*
output only, which is what `get_deployment_logs` surfaces today. Live runtime
output exists exclusively over the socket.io gateway:

- Namespace `/logs`, derived from the API origin by replacing `/graphql` with
  `/logs` (`nc-dashboard/lib/logs/socket.ts`).
- Auth: bearer token in the handshake (`auth: { token }`) — exactly what this CLI
  already resolves via [`src/auth.ts`](src/auth.ts).
- Rooms: `joinService { serviceId }` and `joinDeployment { deploymentId }`, both
  acked with `{ ok, room }`; membership is lost on reconnect and must be re-joined.
- Events: `service.log`, `deployment.log`, `deployment.update`, `log.error`
  (`nc-dashboard/lib/logs/useLogStream.ts`,
  `nc-dashboard/lib/logs/useDeploymentUpdates.ts`).

```
naijacloud logs [service]         last N lines, then exit
  --follow / -f                   tail live (service room)
  --deployment <id>               build logs for one deployment
  --since / --level / --stream    client-side filters
```

This is the largest functional hole in the current CLI: a capability the product
has, that only the dashboard can reach.

### 3.3 Terminal verbs for what MCP already does

The API layer in [`src/api-client.ts`](src/api-client.ts) already implements
most of this — it needs a command layer, not new transport code.

```
naijacloud projects [ls|show <id>]
naijacloud services ls                    # myServices — flat, no traversal
naijacloud deploy <service> [--wait]      # triggerDeploy + poll to RUNNING/FAILED
naijacloud deployments [--service|--project]
naijacloud cancel <deployment>
naijacloud env ls|set|rm
naijacloud domains ls|add|verify|rm
```

Every command needs `--json` for scripting and meaningful exit codes (non-zero on
`FAILED`, so CI can gate on `deploy --wait`).

### 3.4 Project linking

Every MCP tool demands a `serviceId` UUID sourced from `get_project`. That is
fine for an agent and unusable by hand. The CLI needs:

```
naijacloud link            # interactive; records the target in naijacloud.json
naijacloud unlink
```

Linking writes `projectId` / `environmentId` / `serviceId` into the same
`naijacloud.json` §3.1 introduces — one committed file describing what this
directory deploys to, not a second parallel one. `.naijacloud/` stays for
generated and per-user state only (the editor schema copy, caches) and is
gitignored.

…plus name resolution everywhere (`--service api` resolving against the linked
project, `--env prod`). Without this, Tier 1 items 3.1, 3.2, 3.5 and 3.6 are all
theoretically available and practically unusable.

### 3.5 `naijacloud db` — SQL console

`runDatabaseQuery(serviceId, statement, maxRows)` is **write-capable** and runs
as the service's own DB user, returning `{ columns, rows, rowCount, truncated,
message, notices, executionMs }` (`nc-dashboard/modules/services/services.gql`).
A terminal is the better client for this than the Studio UI.

```
naijacloud db query "SELECT …"     one-shot, table or --json output
naijacloud db shell                REPL over runDatabaseQuery
naijacloud db tables               databaseObjects
naijacloud db describe <table>     tableColumns
naijacloud db dump [--format]      exportDatabase → download URL
naijacloud db export <table>       exportTable
```

### 3.6 `naijacloud storage` — S3-style object ops

~25 storage operations back the dashboard, including presigned upload/download
and `deleteObjectsByPrefix`. This is the most obviously-missing CLI feature
relative to how object storage is actually used.

```
naijacloud storage ls [bucket/prefix]
naijacloud storage cp <src> <dst>       # presigned PUT / GET
naijacloud storage rm [--recursive]     # deleteObject(s|ByPrefix)
naijacloud storage sync <dir> <bucket>
naijacloud storage mb|rb                # createBucket / deleteBucket
```

Note the region constraint in §6.

---

## 4. Tier 2 — high value, straightforward

| Command | Backing operations | Notes |
| --- | --- | --- |
| `env pull` / `env push` | `serviceEnvVars`, `setEnvVars` | `setEnvVars` takes an array; the CLI currently sends one entry at a time. `.env` round-trip is the point. |
| `env rm` | `deleteEnvVar` | Exists in the API, missing from **both** CLI and MCP. |
| `secrets ls/set/rm` | `serviceSecretFiles`, `setSecretFile`, `deleteSecretFile` | Entirely absent today. |
| `init` / `services create` | `detectBuild`, `createService`, `createDatastoreService`, `deployLocations` | `detectBuild` infers framework, runtime, build/start commands, port, package manager and monorepo strategy from a repo + `rootDir` — a guided scaffold writes itself. `createDatastoreService` returns generated credentials. |
| `cron run/runs/logs/pause/resume/edit` | `runCronJob`, `cronRuns`, `cronRunLogs`, `setCronJobSuspended`, `updateCronJob`, `cronStats` | Run output streams over `joinCronRun` → `cronRun.log` / `cronRun.update`. Cron output is log-shaped; the terminal is its home. |
| `backups list/run/restore/download/schedule` | `backups`, `runBackupNow`, `restoreBackup`, `backupDownloadUrl`, `setBackupFrequency`, `deleteBackup` | Scriptable backups are a CI-native need. |
| `previews ls/enable/disable/teardown` | `servicePreviews`, `setServicePreviewsEnabled`, `teardownPreview` | Useful inside PR automation. |
| `scale` | `updateServiceResources(tier: STARTER \| STANDARD \| PRO)` | |
| `region set` | `updateServiceRegion`, `deployLocations` | Triggers a full rebuild in the new region. |
| `metrics` / `top` | `serviceMetrics(range: LAST_30_MIN…LAST_30D)`, `liveServiceStats`, `webHeadlineMetrics` | `top` as a live resource view; headline metrics give RPS / p95 / error rate. |
| `connect <db>` | `serviceConnectionDetails` | Returns scheme/host/port/user/password/`url`/`externalUrl` — shelling straight into `psql` / `redis-cli` is a genuinely nice touch. |
| `service settings` | `updateServiceBuild`, `updateServiceSource`, `disconnectServiceRepo` | Build command, start command, runtime, port, rootDir, watch paths, repo/branch re-pointing. |

---

## 5. Tier 3 — rounding out

- `team members|invite|remove|rename|settings` — `teamMembers`, `inviteToTeam`
  (returns an invite `link`), `removeMember`, `renameTeam`,
  `setTeamDefaultRegion`, `setTeamDeploymentPreviews`.
- `usage` / `billing` / `invoices` — `workspaceUsageMeters` (compute hours,
  storage, bandwidth, database, each with its plan allowance), `workspaceBilling`,
  `workspaceInvoices`.
- `activity` — `workspaceActivity(teamId, projectId, limit, cursor)`, a paginated
  audit feed.
- `status` — `platformStatus` / `statusIncidents`. No auth required, cheap to add.
- `git link` — `githubRepositories`, `githubRepositoryBranches`,
  `githubAppInstallUrl`, then `updateServiceSource`.
- `open` — deep-link the linked project/service into the dashboard.
- `redis` — `runCacheCommand` as a `redis-cli` passthrough, plus `cacheStats` /
  `cacheConfig` / `setCacheConfig`.
- `support` — `createSupportTicket`, `myTickets`, `replyToTicket`.
- `projects create|rename|rm`, `env create|rm` — `createProject`,
  `updateProject`, `deleteProject`, `createEnvironment`, `deleteEnvironment`.

---

## 6. Constraints to design around

- **No rollback, restart, suspend or sleep** for web services. There is no
  `rollbackDeployment` and no `deleteDeployment` — deployment history is
  immutable. `cancelDeployment` is the only destructive deployment op, and it
  only bites while a deploy is in flight.
- **Deploys are always branch-tip.** No per-deploy branch or commit override, so
  `deploy --commit` can only ever validate-and-reject — which
  [`src/mcp-server.ts`](src/mcp-server.ts) already documents correctly.
- **No personal access tokens.** `login` exchanges email + password for a bearer
  token; there is no PAT feature, which makes CI awkward. `githubLoginUrl` /
  `googleLoginUrl` suggest a browser/device flow the CLI could adopt.
- **Storage is region-scoped.** A team has at most one store per region
  (`eu-west`, `af-west`); `region` becomes **required** once a team has stores in
  two regions, and `storageBuckets` lists one store at a time. Credentials are
  *not* region-scoped — one key works everywhere. See `nc-dashboard/api-gaps.md`.
- **Enums worth encoding:** `ServiceType` = WEB · STATIC · CRON · POSTGRES ·
  MYSQL · MARIADB · MONGODB · REDIS · VALKEY. `ServiceTier` = STARTER · STANDARD
  · PRO. `MetricRange` = LAST_30_MIN · LAST_HOUR · LAST_6H · LAST_24H · LAST_7D ·
  LAST_30D. `EnvVarScope` = ALL · PROD · UAT · DEV.
- **Out of scope:** `modules/admin`, `modules/admin-hub` and `modules/hub`
  (~1,900 lines of staff tooling and community-forum operations) are not user
  CLI surface.

---

## 7. MCP tools that are near-free to add

Given what [`src/api-client.ts`](src/api-client.ts) already does, these close
obvious agent-facing gaps for a few lines each:

`delete_env_var` · `remove_domain` · `verify_domain` · `list_services`
(`myServices`) · `get_service_metrics` · `get_connection_details` ·
`create_project` · `list_cron_runs` / `run_cron_job`

`list_domains` should also select the richer `dnsTarget.records` and
`dnsTarget.conflicts` the dashboard reads — today `DOMAIN_FIELDS` in
[`src/api-client.ts`](src/api-client.ts) stops at `cname` / `aRecord` / `isApex`,
so an agent cannot report a conflicting record it should tell the user to remove.

---

## 8. Suggested order

1. **Foundation** — command layer, `link` + name resolution, `--json`, exit codes.
   Tier 1 items 3.1, 3.2, 3.5 and 3.6 all sit on top of it.
2. **`deploy` (static) + `logs --follow`** — the two capabilities the dashboard
   cannot match.
3. **Parity verbs** — projects / services / env / domains / deployments.
4. **`db` and `storage`** — the two terminal-native subsystems.
5. **Tier 2**, then Tier 3 as demand appears.
