/**
 * Custom domains, which attach to a service rather than to a project.
 */

import { authed } from "./transport.js";
import { DOMAIN_FIELDS } from "./fields.js";
import type { CustomDomain, DomainWithService } from "./types.js";


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

/**
 * Re-runs the DNS check now rather than waiting for the platform's own sweep.
 *
 * Returns the domain in whatever state the check left it: still PENDING when
 * DNS has not propagated yet, which is not an error — it is the answer.
 */
export async function verifyDomain(domainId: string): Promise<CustomDomain> {
  const data = await authed<{ verifyCustomDomain: CustomDomain }>(
    `mutation VerifyCustomDomain($id: ID!) { verifyCustomDomain(id: $id) { ${DOMAIN_FIELDS} } }`,
    { id: domainId },
  );
  return data.verifyCustomDomain;
}

/** Detaches a custom domain. The service keeps serving on its *.naijacloud.com URL. */
export async function removeDomain(domainId: string): Promise<boolean> {
  const data = await authed<{ removeCustomDomain: boolean }>(
    `mutation RemoveCustomDomain($id: ID!) { removeCustomDomain(id: $id) }`,
    { id: domainId },
  );
  return data.removeCustomDomain;
}
