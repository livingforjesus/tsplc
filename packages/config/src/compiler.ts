import { z } from "zod";

interface Diagnostic {
  origin: "config";
  code: string;
  severity: "error";
  message: string;
}

export const durationSchema = z
  .object({
    kind: z.literal("duration"),
    nanoseconds: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();

export type Duration = z.infer<typeof durationSchema>;

function duration(value: number, scale: number): Duration {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Task duration must be finite and positive.");
  }
  // Keep task periods exact before serializing them for the compiler/backend.
  const nanoseconds = value * scale;
  if (!Number.isSafeInteger(nanoseconds)) {
    throw new Error("Task duration must be an exact, safe number of nanoseconds.");
  }
  return { kind: "duration", nanoseconds: String(nanoseconds) };
}

export const ns = (value: number): Duration => duration(value, 1);
export const ms = (value: number): Duration => duration(value, 1_000_000);
export const seconds = (value: number): Duration => duration(value, 1_000_000_000);

const sourceExportSchema = z
  .object({ module: z.string().min(1), export: z.string().min(1) })
  .strict();
const taskSchema = z
  .object({
    name: z.string().min(1),
    schedule: z.object({ kind: z.literal("cyclic"), interval: durationSchema }).strict(),
    priority: z.number().int().nonnegative(),
    programs: z.array(z.string().min(1)).min(1),
  })
  .strict();

// Shared configuration validates the target envelope. Each backend owns its
// options schema and hardware-specific scheduling/addressing constraints.
const targetSchema = z
  .object({
    kind: z.string().min(1),
    options: z
      .unknown()
      .refine((value) => value !== undefined, { message: "Target options are required." }),
  })
  .strict();
const common = {
  name: z.string().min(1),
  tsconfig: z.string().min(1),
  tasks: z.array(taskSchema).min(1),
  target: targetSchema,
};
const entryConfigSchema = z.object({ ...common, entry: sourceExportSchema }).strict();
const programsConfigSchema = z
  .object({ ...common, programs: z.record(z.string().min(1), sourceExportSchema) })
  .strict();

export interface TargetDescriptor<Options = unknown> {
  kind: string;
  options: Options;
}
export type SourceExport = z.infer<typeof sourceExportSchema>;
export type TaskConfig = Omit<z.infer<typeof taskSchema>, "programs"> & {
  programs: readonly string[];
};

export type PlcConfig<Target extends TargetDescriptor = TargetDescriptor> = {
  name: string;
  tsconfig: string;
  tasks: readonly TaskConfig[];
  target: Target;
} & (
  | { entry: SourceExport; programs?: never }
  | { programs: Readonly<Record<string, SourceExport>>; entry?: never }
);

export interface NormalizedConfig {
  name: string;
  tsconfig: string;
  programs: Readonly<Record<string, SourceExport>>;
  tasks: readonly TaskConfig[];
  target: TargetDescriptor;
}

export function definePlcConfig<const C extends PlcConfig>(config: C): C {
  return config;
}

export function validateConfig(value: unknown): {
  config?: NormalizedConfig;
  diagnostics: readonly Diagnostic[];
} {
  const multiplePrograms =
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "programs") &&
    !Object.hasOwn(value, "entry");
  const parsed = (multiplePrograms ? programsConfigSchema : entryConfigSchema).safeParse(value);
  if (!parsed.success) {
    return {
      diagnostics: parsed.error.issues.map((issue) => ({
        origin: "config",
        code: "PLC5001",
        severity: "error",
        message: `${issue.path.join(".") || "config"}: ${issue.message}`,
      })),
    };
  }

  const { data } = parsed;
  const programs = "entry" in data ? { main: data.entry } : data.programs;
  const diagnostics: Diagnostic[] = [];
  const report = (message: string): void => {
    diagnostics.push({ origin: "config", code: "PLC5002", severity: "error", message });
  };
  if (Object.keys(programs).length === 0) {
    report("At least one program is required.");
  }

  // A program has one scan owner. Preserve task call order while rejecting
  // unknown, duplicated, or unassigned program keys.
  const taskNames = new Set<string>();
  const assigned = new Set<string>();
  for (const task of data.tasks) {
    if (taskNames.has(task.name)) {
      report(`Duplicate task name: ${task.name}.`);
    }
    taskNames.add(task.name);
    for (const program of task.programs) {
      if (!Object.hasOwn(programs, program)) {
        report(`Task ${task.name} references unknown program ${program}.`);
      }
      if (assigned.has(program)) {
        report(`Program ${program} must belong to exactly one task.`);
      }
      assigned.add(program);
    }
  }
  for (const program of Object.keys(programs)) {
    if (!assigned.has(program)) {
      report(`Program ${program} is not assigned to a task.`);
    }
  }

  if (diagnostics.length) {
    return { diagnostics };
  }
  return {
    config: {
      name: data.name,
      tsconfig: data.tsconfig,
      programs,
      tasks: data.tasks,
      target: data.target,
    },
    diagnostics,
  };
}
