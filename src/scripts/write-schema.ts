/**
 * Build step: writes `schema/naijacloud.schema.json` from the zod object in
 * manifest.ts.
 *
 * Run by `npm run build` after tsc, and the generated file is committed — so
 * the schema is browsable in the repo, ships inside the published package, and
 * still cannot drift from the validator that produced it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { schemaJson } from "../commands/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "..", "schema", "naijacloud.schema.json");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, schemaJson(), "utf8");

process.stderr.write(`Wrote ${target}\n`);
