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
