/**
 * Teams, projects, environments and services — the resource tree every other
 * operation hangs off.
 */

import { authed } from "./transport.js";
import { PROJECT_FIELDS, SERVICE_FIELDS } from "./fields.js";
import type { Project, ProjectWithTeam, ServiceSummary, Team } from "./types.js";


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
