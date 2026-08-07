/**
 * Environment variables. Values are returned in full by the platform, so any
 * masking is the caller's job.
 */

import { authed } from "./transport.js";
import type { EnvVarMutationResult, EnvVarScope, ServiceEnvVar } from "./types.js";


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

/**
 * Removes one variable by key.
 *
 * Returns the same `EnvVarMutationResult` as `setEnvVars`, so the caller learns
 * whether the service has to redeploy before the removal takes effect — a
 * running process keeps the value it started with either way.
 */
export async function deleteEnvVar(
  serviceId: string,
  key: string,
): Promise<EnvVarMutationResult> {
  const data = await authed<{ deleteEnvVar: EnvVarMutationResult }>(
    `
      mutation DeleteEnvVar($serviceId: ID!, $key: String!) {
        deleteEnvVar(serviceId: $serviceId, key: $key) {
          needsRedeploy
          warnings
          envVars { key value scope secret linked }
        }
      }
    `,
    { serviceId, key },
  );
  return data.deleteEnvVar;
}
