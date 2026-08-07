/**
 * Environments, and creating services inside them.
 *
 * An environment is the level the resource tree hangs its services off —
 * `Project > Environment > Service` — and it is what makes a deploy production
 * or not. Everything here therefore takes an `environmentId`, never a project.
 */

import { authed } from "./transport.js";
import { SERVICE_FIELDS } from "./fields.js";
import type { ServiceSummary, ServiceType } from "./types.js";

export interface EnvironmentRef {
  id: string;
  name: string;
}

export async function createEnvironment(
  projectId: string,
  name: string,
): Promise<EnvironmentRef> {
  const data = await authed<{ createEnvironment: EnvironmentRef }>(
    `
      mutation CreateEnvironment($projectId: ID!, $name: String!) {
        createEnvironment(projectId: $projectId, name: $name) { id name }
      }
    `,
    { projectId, name },
  );
  return data.createEnvironment;
}

/** Deletes an environment and everything in it. Returns whether it went. */
export async function deleteEnvironment(environmentId: string): Promise<boolean> {
  const data = await authed<{ deleteEnvironment: boolean }>(
    `mutation DeleteEnvironment($id: ID!) { deleteEnvironment(id: $id) }`,
    { id: environmentId },
  );
  return data.deleteEnvironment;
}

/**
 * Creates a datastore in an environment.
 *
 * There is no `createDatastoreService` mutation despite what the gap analysis
 * claimed — `createService` is the only one, and a datastore is simply the case
 * where `type` is a data type and none of the build/source fields apply. That
 * makes this the small end of a large input: everything else `CreateServiceInput`
 * accepts describes how to build code, which a database does not do.
 *
 * `dbName`, `dbUser` and `dbPassword` are optional; the platform generates
 * them when they are omitted, which is the path worth defaulting to.
 */
export async function createDatastore(input: {
  environmentId: string;
  name: string;
  type: ServiceType;
  region?: string;
  tier?: string;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
}): Promise<ServiceSummary> {
  const data = await authed<{ createService: ServiceSummary }>(
    `
      mutation CreateDatastore($input: CreateServiceInput!) {
        createService(input: $input) { ${SERVICE_FIELDS} }
      }
    `,
    { input },
  );
  return data.createService;
}

/**
 * Creates a static site *inside a chosen environment*, from an uploaded bundle.
 *
 * `deployStaticSite` cannot do this: its input carries no `environmentId`, so
 * it always lands wherever the platform decides. `createService` is the only
 * way to say where a static site belongs, which is why §3.1's pipeline reaches
 * for this whenever a target environment is known.
 */
export async function createStaticService(input: {
  environmentId: string;
  name: string;
  staticUploadId: string;
  staticSpa?: boolean;
  staticIndexPath?: string;
  region?: string;
}): Promise<ServiceSummary> {
  const data = await authed<{ createService: ServiceSummary }>(
    `
      mutation CreateStaticService($input: CreateServiceInput!) {
        createService(input: $input) { ${SERVICE_FIELDS} }
      }
    `,
    { input: { ...input, type: "STATIC" } },
  );
  return data.createService;
}
