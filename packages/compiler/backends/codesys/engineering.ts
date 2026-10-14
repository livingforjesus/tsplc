import { resolve } from "node:path";
import type { EmitResult } from "@tsplc/compiler/ir";
import { buildProject, configSchema, type InstalledLibrary, resolveConfig } from "@tsplc/build";
import { z } from "zod";
import type { CodesysPlan } from "./plan.ts";

export const engineeringBuildSchema = configSchema.omit({
  sourceDir: true,
  entry: true,
  outDir: true,
  task: true,
  tasks: true,
  runtime: true,
});
export const engineeringSchema = z.strictObject({
  kind: z.literal("v3.5"),
  build: engineeringBuildSchema.optional(),
});
export type CodesysEngineeringBuild = z.input<typeof engineeringBuildSchema>;

export function codesysBuildConfig(
  plan: CodesysPlan,
  bundle: Pick<EmitResult, "objects">,
  paths: {
    configFile: string;
    sourceDir: string;
    outDir: string;
    libraries?: InstalledLibrary[];
  },
) {
  const settings = plan.options.engineering.build;
  if (!settings)
    throw new Error(
      "CODESYS build requires engineering.build settings (codesys installation and template). Configure them or use --emit-only.",
    );
  const programs = new Map(
    plan.core.programs.map((program) => {
      const matches = bundle.objects.filter(
        (object) => object.id === program.id && object.kind === "program",
      );
      const generated = matches[0];
      if (matches.length !== 1 || !generated)
        throw new Error(`Generated bundle must contain one PROGRAM object for ${program.name}.`);
      return [program.name, generated] as const;
    }),
  );
  const tasks = plan.deployment.tasks.map((task) => ({
    ...task,
    programs: task.programs.map((name) => {
      const program = programs.get(name);
      if (!program)
        throw new Error(`Task ${task.name} references a missing generated PROGRAM ${name}.`);
      return program.name;
    }),
  }));
  const first = plan.core.programs[0],
    entry = first && programs.get(first.name);
  if (!entry) throw new Error("CODESYS build requires a generated PROGRAM entry.");
  const sourceDir = resolve(paths.sourceDir);
  return resolveConfig(
    {
      ...settings,
      ...(paths.libraries ? { libraries: paths.libraries } : {}),
      sourceDir,
      entry: resolve(sourceDir, entry.sourcePath ?? `${entry.name}/declaration.st`),
      outDir: resolve(paths.outDir),
      tasks,
    },
    paths.configFile,
  );
}

export async function buildCodesys(...arguments_: Parameters<typeof codesysBuildConfig>) {
  return buildProject(codesysBuildConfig(...arguments_));
}
