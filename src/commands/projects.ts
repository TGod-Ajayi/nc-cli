/**
 * `naijacloud projects` — the resource tree, read-only.
 *
 * `ls` is the entry point for someone who knows nothing: it is the only command
 * that needs no argument and no linked directory, and every id another command
 * wants can be reached from what it prints.
 */

import process from "node:process";

import { getProject, listProjects } from "../api/index.js";
import type { EnvironmentSummary, ServiceSummary } from "../api/index.js";
import { formatWhen, printDetail, printJson, printTable } from "../output.js";
import { programName } from "../program-name.js";
import { write } from "../terminal.js";
import { resolveProjectId } from "./resolve.js";

export interface ProjectsOptions {
  json: boolean;
}

export async function projectsList(options: ProjectsOptions): Promise<void> {
  const projects = await listProjects();

  if (options.json) {
    printJson({ count: projects.length, projects });
    return;
  }

  printTable(
    projects,
    [
      { header: "ID", value: (project) => project.id },
      { header: "NAME", value: (project) => project.name },
      { header: "TEAM", value: (project) => project.teamName },
      { header: "REGION", value: (project) => project.region },
      { header: "CREATED", value: (project) => formatWhen(project.createdAt) },
    ],
    "No projects on this account yet. Create one in the dashboard, or run " +
      `\`${programName()} deploy\` to create a static site.`,
  );
}

/**
 * One project, its environments, and the services inside each.
 *
 * Grouped by environment rather than flattened, because "which environment is
 * this service in" is the question that decides whether a deploy is production.
 */
export async function projectsShow(reference: string, options: ProjectsOptions): Promise<void> {
  const project = await getProject(await resolveProjectId(reference));

  if (options.json) {
    printJson(project);
    return;
  }

  printDetail([
    ["id", project.id],
    ["name", project.name],
    ["display name", project.displayName ?? undefined],
    ["description", project.description ?? undefined],
    ["region", project.region],
    ["created", formatWhen(project.createdAt)],
  ]);

  const environments: EnvironmentSummary[] = project.environments ?? [];
  if (environments.length === 0) {
    write("\nNo environments in this project.\n");
    return;
  }

  for (const environment of environments) {
    process.stdout.write(
      `\n${environment.name}${environment.isPreview ? "  (preview)" : ""}\n`,
    );
    printTable(
      environment.services,
      [
        { header: "ID", value: (service: ServiceSummary) => service.id },
        { header: "NAME", value: (service) => service.name },
        { header: "TYPE", value: (service) => service.type },
        { header: "STATUS", value: (service) => service.status },
        { header: "HEALTH", value: (service) => service.health },
        { header: "URL", value: (service) => service.url },
      ],
      "(no services)",
      "  ",
    );
  }
}
