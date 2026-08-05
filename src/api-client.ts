/**
 * REST-shaped wrapper over NaijaCloud's control-plane API.
 *
 * NaijaCloud's control plane is a **GraphQL** endpoint at
 * `https://api.naijacloud.com/graphql`, authenticated with
 * `Authorization: Bearer <accessToken>`. There is no REST surface — the paths
 * and operation names below come from the live schema (introspected against
 * the production endpoint), not from guesswork.
 *
 * Resource model, which differs from Vercel's and drives the tool signatures:
 *
 *     Team ──< Project ──< Environment ──< Service ──< Deployment
 *
 * Deployments, custom domains and environment variables all hang off a
 * **Service**, not a Project. Tools therefore take `serviceId`, and accept
 * `projectId` as a convenience that fans out across the project's services in
 * a single nested GraphQL query.
 */

import { createRequire } from "node:module";
import process from "node:process";

import { resolveToken } from "./auth.js";

export const DEFAULT_API_BASE_URL = "https://api.naijacloud.com";
const GRAPHQL_PATH = "/graphql";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Single source of truth for the version, shared by the CLI and MCP server. */
export const CLIENT_VERSION: string = ((): string => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** Base URL of the NaijaCloud API, overridable via HOSTING_API_BASE_URL. */
export function apiBaseUrl(): string {
  const override = process.env["HOSTING_API_BASE_URL"]?.trim();
  return (override && override.replace(/\/+$/, "")) || DEFAULT_API_BASE_URL;
}

function graphqlUrl(): string {
  return `${apiBaseUrl()}${GRAPHQL_PATH}`;
}

function timeoutMs(): number {
  const raw = Number(process.env["HOSTING_API_TIMEOUT_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class NaijaCloudError extends Error {
  readonly code: string | undefined;
  readonly statusCode: number | undefined;

  constructor(message: string, options: { code?: string; statusCode?: number } = {}) {
    super(message);
    this.name = "NaijaCloudError";
    this.code = options.code;
    this.statusCode = options.statusCode;
  }
}

/**
 * Raised before any network call when no credentials can be resolved, and also
 * when the API rejects the credentials we do have. Either way the caller sees
 * an actionable message instead of a bare 401.
 */
export class NotLoggedInError extends NaijaCloudError {
  constructor(message = "Not logged in. Run 'naijacloud login' first.") {
    super(message, { code: "UNAUTHENTICATED", statusCode: 401 });
    this.name = "NotLoggedInError";
  }
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

interface GraphQLError {
  message?: string;
  path?: (string | number)[];
  extensions?: {
    code?: string;
    originalError?: { message?: string | string[]; error?: string; statusCode?: number };
  };
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLError[];
}

/** GraphQL puts validation detail in extensions.originalError.message (sometimes an array). */
function describe(error: GraphQLError): string {
  const original = error.extensions?.originalError?.message;
  if (Array.isArray(original) && original.length > 0) return original.join("; ");
  if (typeof original === "string" && original) return original;
  return error.message || "Unknown NaijaCloud API error";
}

/**
 * Executes one GraphQL operation. `token` is sent as a bearer credential; when
 * omitted the request is anonymous (only `login` and `signup` allow that).
 */
async function execute<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const url = graphqlUrl();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": `naijacloud-cli/${CLIENT_VERSION}`,
  };
  if (token) headers["authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new NaijaCloudError(`Cannot reach the NaijaCloud API at ${url} (${reason}).`);
  }

  // The GraphQL endpoint answers 200 even for application errors; a non-2xx
  // here means the gateway or a proxy failed.
  if (!response.ok && response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new NotLoggedInError(
        "NaijaCloud rejected the stored credentials. Run 'naijacloud login' again.",
      );
    }
    throw new NaijaCloudError(
      `NaijaCloud API returned HTTP ${response.status} ${response.statusText}.`,
      { statusCode: response.status },
    );
  }

  let payload: GraphQLResponse<T>;
  try {
    payload = (await response.json()) as GraphQLResponse<T>;
  } catch {
    throw new NaijaCloudError(
      `NaijaCloud API returned a non-JSON response (HTTP ${response.status}).`,
      { statusCode: response.status },
    );
  }

  const firstError = payload.errors?.[0];
  if (firstError) {
    const code = firstError.extensions?.code;
    const statusCode = firstError.extensions?.originalError?.statusCode;

    if (code === "UNAUTHENTICATED" || statusCode === 401) {
      throw new NotLoggedInError(
        "NaijaCloud rejected the credentials (they may have expired). " +
          "Run 'naijacloud login' again.",
      );
    }
    const options: { code?: string; statusCode?: number } = {};
    if (code !== undefined) options.code = code;
    if (statusCode !== undefined) options.statusCode = statusCode;

    if (code === "FORBIDDEN" || statusCode === 403) {
      throw new NaijaCloudError(`Permission denied by NaijaCloud: ${describe(firstError)}`, {
        ...options,
        statusCode: statusCode ?? 403,
      });
    }

    throw new NaijaCloudError(describe(firstError), options);
  }

  if (payload.data == null) {
    throw new NaijaCloudError("NaijaCloud API returned an empty response.");
  }
  return payload.data;
}

/** Executes an operation with the resolved credentials, failing fast if absent. */
async function authed<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const resolved = resolveToken();
  if (!resolved) throw new NotLoggedInError();
  return await execute<T>(query, variables, resolved.token);
}

/* -------------------------------------------------------------------------- */
/* Schema types (subset of the live schema that the tools surface)            */
/* -------------------------------------------------------------------------- */

export type DeploymentStatus =
  | "QUEUED"
  | "BUILDING"
  | "TESTING"
  | "DEPLOYING"
  | "RUNNING"
  | "FAILED"
  | "CANCELLED"
  | "SUPERSEDED";

export type ServiceType =
  | "WEB"
  | "STATIC"
  | "CRON"
  | "POSTGRES"
  | "MYSQL"
  | "MARIADB"
  | "MONGODB"
  | "REDIS"
  | "VALKEY";

export type EnvVarScope = "ALL" | "PROD" | "UAT" | "DEV";

/** The `target` values the MCP tools accept, and how they map onto EnvVarScope. */
export type EnvTarget = "production" | "preview" | "development" | "all";

export const SCOPE_BY_TARGET: Record<EnvTarget, EnvVarScope> = {
  production: "PROD",
  // NaijaCloud has no PREVIEW scope; UAT is its pre-production scope and is
  // what preview environments read.
  preview: "UAT",
  development: "DEV",
  all: "ALL",
};

export interface User {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  plan: string;
  status: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  defaultRegion: string | null;
}

export interface ServiceSummary {
  id: string;
  name: string;
  type: ServiceType;
  status: string;
  health: string;
  url: string | null;
  branch: string | null;
  repoFullName: string | null;
  isStatic: boolean;
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  isPreview: boolean;
  services: ServiceSummary[];
}

export interface Project {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  teamId: string;
  region: string | null;
  createdAt: string;
  updatedAt: string;
  environments?: EnvironmentSummary[];
}

export interface ProjectWithTeam extends Project {
  teamName: string;
}

export interface Deployment {
  id: string;
  serviceId: string;
  status: DeploymentStatus;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  authorName: string | null;
  buildMethod: string | null;
  error: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentWithService extends Deployment {
  serviceName?: string;
  environmentName?: string;
}

export interface DeploymentLog {
  id: string;
  level: "INFO" | "WARN" | "ERROR";
  stream: "STDOUT" | "STDERR" | "SYSTEM";
  line: string;
  createdAt: string;
}

export interface CustomDomain {
  id: string;
  domain: string;
  serviceId: string;
  status: "PENDING" | "ACTIVE";
  verifiedAt: string | null;
  lastCheck: string | null;
  dnsTarget: {
    cname: string;
    aRecord: string | null;
    isApex: boolean;
  };
}

export interface DomainWithService extends CustomDomain {
  serviceName?: string;
}

export interface ServiceEnvVar {
  key: string;
  value: string;
  scope: EnvVarScope;
  secret: boolean;
  linked: boolean;
}

export interface EnvVarMutationResult {
  envVars: ServiceEnvVar[];
  needsRedeploy: boolean;
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Reusable selections                                                        */
/* -------------------------------------------------------------------------- */

const SERVICE_FIELDS = `
  id
  name
  type
  status
  health
  url
  branch
  repoFullName
  isStatic
`;

const DEPLOYMENT_FIELDS = `
  id
  serviceId
  status
  branch
  commitSha
  commitMessage
  authorName
  buildMethod
  error
  errorCode
  createdAt
  updatedAt
`;

const DOMAIN_FIELDS = `
  id
  domain
  serviceId
  status
  verifiedAt
  lastCheck
  dnsTarget { cname aRecord isApex }
`;

const PROJECT_FIELDS = `
  id
  name
  displayName
  description
  teamId
  region
  createdAt
  updatedAt
`;

/* -------------------------------------------------------------------------- */
/* Auth operations                                                            */
/* -------------------------------------------------------------------------- */

/** `me` — also doubles as the token-validation endpoint used by login/whoami. */
export async function getCurrentUser(token?: string): Promise<User> {
  const query = `
    query CurrentUser {
      me { id email name firstName lastName plan status createdAt }
    }
  `;
  if (token) {
    const data = await execute<{ me: User }>(query, {}, token);
    return data.me;
  }
  const data = await authed<{ me: User }>(query);
  return data.me;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<{ accessToken: string; user: User }> {
  const query = `
    mutation Login($input: LoginInput!) {
      login(input: $input) {
        accessToken
        user { id email name firstName lastName plan status createdAt }
      }
    }
  `;
  try {
    const data = await execute<{ login: { accessToken: string; user: User } }>(
      query,
      { input: { email, password } },
    );
    return data.login;
  } catch (error) {
    // A rejected password is a credentials problem, not a "log in again" loop.
    if (error instanceof NotLoggedInError) {
      throw new NaijaCloudError("Login failed: incorrect email or password.", {
        code: "UNAUTHENTICATED",
        statusCode: 401,
      });
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Teams and projects                                                         */
/* -------------------------------------------------------------------------- */

export async function listTeams(): Promise<Team[]> {
  const data = await authed<{ myTeams: Team[] }>(`
    query MyTeams { myTeams { id name defaultRegion } }
  `);
  return data.myTeams;
}

/**
 * Lists every project the caller can see.
 *
 * `projects` is team-scoped in the schema, so this resolves the caller's teams
 * first and then fetches all teams' projects in one aliased query.
 */
export async function listProjects(): Promise<ProjectWithTeam[]> {
  const teams = await listTeams();
  if (teams.length === 0) return [];

  const aliases = teams
    .map((_, index) => `t${index}: projects(teamId: $team${index}) { ${PROJECT_FIELDS} }`)
    .join("\n");
  const params = teams.map((_, index) => `$team${index}: ID!`).join(", ");

  const variables: Record<string, unknown> = {};
  teams.forEach((team, index) => {
    variables[`team${index}`] = team.id;
  });

  const data = await authed<Record<string, Project[]>>(
    `query AllProjects(${params}) { ${aliases} }`,
    variables,
  );

  return teams.flatMap((team, index) =>
    (data[`t${index}`] ?? []).map((project) => ({ ...project, teamName: team.name })),
  );
}

/** One project, including its environments and the services inside each. */
export async function getProject(projectId: string): Promise<Project> {
  const data = await authed<{ project: Project }>(
    `
      query GetProject($id: ID!) {
        project(id: $id) {
          ${PROJECT_FIELDS}
          environments {
            id
            name
            isPreview
            services { ${SERVICE_FIELDS} }
          }
        }
      }
    `,
    { id: projectId },
  );
  return data.project;
}

export interface ServiceDetail extends ServiceSummary {
  isPreview: boolean;
  environmentId: string;
  environment: { id: string; name: string } | null;
  sourceType: string | null;
  rootDir: string | null;
  buildCommand: string | null;
  startCommand: string | null;
}

/** One service, used to report which environment a deploy will land in. */
export async function getService(serviceId: string): Promise<ServiceDetail> {
  const data = await authed<{ service: ServiceDetail }>(
    `
      query GetService($id: ID!) {
        service(id: $id) {
          ${SERVICE_FIELDS}
          isPreview
          environmentId
          environment { id name }
          sourceType
          rootDir
          buildCommand
          startCommand
        }
      }
    `,
    { id: serviceId },
  );
  return data.service;
}

/* -------------------------------------------------------------------------- */
/* Deployments                                                                */
/* -------------------------------------------------------------------------- */

export async function listDeploymentsByService(serviceId: string): Promise<Deployment[]> {
  const data = await authed<{ deployments: Deployment[] }>(
    `query Deployments($serviceId: ID!) { deployments(serviceId: $serviceId) { ${DEPLOYMENT_FIELDS} } }`,
    { serviceId },
  );
  return data.deployments;
}

/** Every deployment across every service in a project, in one nested query. */
export async function listDeploymentsByProject(
  projectId: string,
): Promise<DeploymentWithService[]> {
  const data = await authed<{
    project: {
      environments: {
        name: string;
        services: { id: string; name: string; deployments: Deployment[] }[];
      }[];
    };
  }>(
    `
      query ProjectDeployments($id: ID!) {
        project(id: $id) {
          environments {
            name
            services {
              id
              name
              deployments { ${DEPLOYMENT_FIELDS} }
            }
          }
        }
      }
    `,
    { id: projectId },
  );

  return data.project.environments.flatMap((environment) =>
    environment.services.flatMap((service) =>
      service.deployments.map((deployment) => ({
        ...deployment,
        serviceName: service.name,
        environmentName: environment.name,
      })),
    ),
  );
}

export async function getDeployment(deploymentId: string): Promise<DeploymentWithService> {
  const data = await authed<{
    deployment: Deployment & { service: { id: string; name: string; url: string | null } | null };
  }>(
    `
      query GetDeployment($id: ID!) {
        deployment(id: $id) {
          ${DEPLOYMENT_FIELDS}
          service { id name url }
        }
      }
    `,
    { id: deploymentId },
  );

  const { service, ...deployment } = data.deployment;
  return service ? { ...deployment, serviceName: service.name } : deployment;
}

/**
 * `triggerDeploy` builds and releases the service's *currently configured*
 * source (repo + branch). The schema exposes no per-deploy branch or commit
 * override.
 */
export async function triggerDeploy(serviceId: string): Promise<Deployment> {
  const data = await authed<{ triggerDeploy: Deployment }>(
    `mutation TriggerDeploy($serviceId: ID!) { triggerDeploy(serviceId: $serviceId) { ${DEPLOYMENT_FIELDS} } }`,
    { serviceId },
  );
  return data.triggerDeploy;
}

/**
 * NaijaCloud has no "delete deployment" mutation — deployment history is
 * immutable. `cancelDeployment` is the only destructive operation available,
 * and it stops an in-flight build/release.
 */
export async function cancelDeployment(deploymentId: string): Promise<Deployment> {
  const data = await authed<{ cancelDeployment: Deployment }>(
    `mutation CancelDeployment($deploymentId: ID!) { cancelDeployment(deploymentId: $deploymentId) { ${DEPLOYMENT_FIELDS} } }`,
    { deploymentId },
  );
  return data.cancelDeployment;
}

export async function getDeploymentLogs(deploymentId: string): Promise<DeploymentLog[]> {
  const data = await authed<{ deploymentLogs: DeploymentLog[] }>(
    `
      query DeploymentLogs($deploymentId: ID!) {
        deploymentLogs(deploymentId: $deploymentId) { id level stream line createdAt }
      }
    `,
    { deploymentId },
  );
  return data.deploymentLogs;
}

/* -------------------------------------------------------------------------- */
/* Domains                                                                    */
/* -------------------------------------------------------------------------- */

export async function listDomainsByService(serviceId: string): Promise<CustomDomain[]> {
  const data = await authed<{ customDomains: CustomDomain[] }>(
    `query CustomDomains($serviceId: ID!) { customDomains(serviceId: $serviceId) { ${DOMAIN_FIELDS} } }`,
    { serviceId },
  );
  return data.customDomains;
}

export async function listDomainsByProject(projectId: string): Promise<DomainWithService[]> {
  const data = await authed<{
    project: {
      environments: { services: { id: string; name: string; customDomains: CustomDomain[] }[] }[];
    };
  }>(
    `
      query ProjectDomains($id: ID!) {
        project(id: $id) {
          environments {
            services {
              id
              name
              customDomains { ${DOMAIN_FIELDS} }
            }
          }
        }
      }
    `,
    { id: projectId },
  );

  return data.project.environments.flatMap((environment) =>
    environment.services.flatMap((service) =>
      service.customDomains.map((domain) => ({ ...domain, serviceName: service.name })),
    ),
  );
}

export async function addDomain(serviceId: string, domain: string): Promise<CustomDomain> {
  const data = await authed<{ addCustomDomain: CustomDomain }>(
    `mutation AddCustomDomain($serviceId: ID!, $domain: String!) { addCustomDomain(serviceId: $serviceId, domain: $domain) { ${DOMAIN_FIELDS} } }`,
    { serviceId, domain },
  );
  return data.addCustomDomain;
}

/* -------------------------------------------------------------------------- */
/* Environment variables                                                      */
/* -------------------------------------------------------------------------- */

export async function listEnvVarsByService(serviceId: string): Promise<ServiceEnvVar[]> {
  const data = await authed<{ serviceEnvVars: ServiceEnvVar[] }>(
    `query ServiceEnvVars($serviceId: ID!) { serviceEnvVars(serviceId: $serviceId) { key value scope secret linked } }`,
    { serviceId },
  );
  return data.serviceEnvVars;
}

/**
 * Project-wide listing uses `Service.envVarKeys`, which returns key names only
 * — no values ever leave the platform for this call.
 */
export async function listEnvVarKeysByProject(
  projectId: string,
): Promise<{ serviceId: string; serviceName: string; environmentName: string; keys: string[] }[]> {
  const data = await authed<{
    project: {
      environments: { name: string; services: { id: string; name: string; envVarKeys: string[] }[] }[];
    };
  }>(
    `
      query ProjectEnvVarKeys($id: ID!) {
        project(id: $id) {
          environments { name services { id name envVarKeys } }
        }
      }
    `,
    { id: projectId },
  );

  return data.project.environments.flatMap((environment) =>
    environment.services.map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      environmentName: environment.name,
      keys: service.envVarKeys,
    })),
  );
}

/**
 * Creates or updates a single variable.
 *
 * `setEnvVars` takes a list and upserts by key — the sibling `deleteEnvVar`
 * mutation is what removes variables, so sending one entry here leaves the
 * service's other variables untouched.
 */
export async function setEnvVar(
  serviceId: string,
  key: string,
  value: string,
  scope: EnvVarScope,
  secret?: boolean,
): Promise<EnvVarMutationResult> {
  const variable: Record<string, unknown> = { key, value, scope };
  if (secret !== undefined) variable["secret"] = secret;

  const data = await authed<{ setEnvVars: EnvVarMutationResult }>(
    `
      mutation SetEnvVars($serviceId: ID!, $vars: [EnvVarInput!]!) {
        setEnvVars(serviceId: $serviceId, vars: $vars) {
          needsRedeploy
          warnings
          envVars { key value scope secret linked }
        }
      }
    `,
    { serviceId, vars: [variable] },
  );
  return data.setEnvVars;
}
