/**
 * `naijacloud services` — what this account can deploy to.
 *
 * `ls` deliberately uses `myServices`, which is one flat request across every
 * team and project. The richer per-environment view costs a project read per
 * project and already exists as `projects show`; this one answers "what is it
 * called and what is its id" fast enough to put in a shell alias.
 */

import { getProject, listMyServices } from "../api/index.js";
import type { MyService } from "../api/index.js";
import { printDetail, printJson, printTable } from "../output.js";
import { programName } from "../program-name.js";
import { resolveProjectId, resolveServiceId } from "./resolve.js";
import { getService } from "../api/index.js";

export interface ServicesOptions {
  json: boolean;
  /** Narrow to one project, which also buys the richer status/URL columns. */
  project: string | undefined;
}

export async function servicesList(options: ServicesOptions): Promise<void> {
  // Scoping to a project changes which query answers it: `myServices` has no
  // project filter and carries no status, so a scoped listing goes through the
  // project tree instead and reports more per row.
  if (options.project !== undefined) {
    const project = await getProject(await resolveProjectId(options.project));
    const rows = (project.environments ?? []).flatMap((environment) =>
      environment.services.map((service) => ({ ...service, environment: environment.name })),
    );

    if (options.json) {
      printJson({ projectId: project.id, count: rows.length, services: rows });
      return;
    }

    printTable(
      rows,
      [
        { header: "ID", value: (service) => service.id },
        { header: "NAME", value: (service) => service.name },
        { header: "ENV", value: (service) => service.environment },
        { header: "TYPE", value: (service) => service.type },
        { header: "STATUS", value: (service) => service.status },
        { header: "URL", value: (service) => service.url },
      ],
      `No services in ${project.name}.`,
    );
    return;
  }

  const services = await listMyServices();

  if (options.json) {
    printJson({ count: services.length, services });
    return;
  }

  printTable(
    services,
    [
      { header: "ID", value: (service: MyService) => service.id },
      { header: "PROJECT", value: (service) => service.projectName },
      { header: "NAME", value: (service) => service.name },
      { header: "TYPE", value: (service) => service.type },
    ],
    `No services on this account. Run \`${programName()} projects ls\` to check ` +
      "there is a project to put one in.",
  );
}

/** One service in full — the fields `myServices` has to leave out. */
export async function servicesShow(reference: string, options: ServicesOptions): Promise<void> {
  const service = await getService(await resolveServiceId(reference));

  if (options.json) {
    printJson(service);
    return;
  }

  printDetail([
    ["id", service.id],
    ["name", service.name],
    ["type", service.type],
    ["status", service.status],
    ["health", service.health],
    ["url", service.url],
    ["environment", service.environment?.name ?? undefined],
    // Absent on a static site, which has no connected repository at all — so it
    // is dropped rather than shown as unknown.
    ["repo", service.repoFullName ?? undefined],
    ["branch", service.branch ?? undefined],
    ["root dir", service.rootDir ?? undefined],
    ["build", service.buildCommand ?? undefined],
    ["start", service.startCommand ?? undefined],
    ["preview env", service.isPreview ? "yes" : undefined],
  ]);
}
