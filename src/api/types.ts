/**
 * The subset of NaijaCloud's GraphQL schema the CLI surfaces.
 *
 * Hand-written rather than generated: the CLI touches a fraction of the schema,
 * and these shapes double as the documentation for what each command returns.
 */


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
