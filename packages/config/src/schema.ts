import { z } from "zod";
import {
  configSchema,
  cyclicTasksSchema,
  directIoBindingSchema,
  type CodesysBuildConfig,
} from "./build.ts";
import {
  durationSchema,
  validateConfig as validateCompilerConfig,
  type PlcConfig,
} from "./compiler.ts";

export {
  ns,
  ms,
  seconds,
  definePlcConfig,
  validateConfig,
  type Duration,
  type NormalizedConfig,
  type PlcConfig,
  type SourceExport,
  type TargetDescriptor,
  type TaskConfig,
} from "./compiler.ts";
export type { CodesysBuildConfig } from "./build.ts";

const ioBindingSchema = z.union([
  directIoBindingSchema,
  z.strictObject({ device: z.string().min(1), channel: z.string().min(1) }),
]);
const assemblySchema = z.strictObject({
  assembly: z.number().int().nonnegative(),
  size: z.number().int().positive().optional(),
  address: z.string().regex(/^%[IQ]B\d+$/),
});
const hardwareDeviceSchema = z.strictObject({
  file: z.string().min(1),
  connection: z.string().min(1).optional(),
  inputs: assemblySchema.optional(),
  outputs: assemblySchema.optional(),
  statusSymbols: z.record(z.string(), z.string()).optional(),
});
const dependencySchema = z.union([
  z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  z.strictObject({
    version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
    company: z.string().optional(),
    namespace: z.string().optional(),
  }),
  z.strictObject({ path: z.string().min(1), namespace: z.string().optional() }),
]);
const taskSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  schedule: z.strictObject({ kind: z.literal("cyclic"), interval: durationSchema }),
  priority: z.number().int().min(0).max(31),
  programs: z.array(z.string().min(1)).nonempty(),
});
const monitorSchema = z
  .strictObject({
    endpoint: z.string().url(),
    namespaceUri: z.string().optional(),
    symbols: z.array(z.string().min(1)).optional(),
    securityMode: z.enum(["None", "Sign", "SignAndEncrypt"]).default("SignAndEncrypt"),
    securityPolicy: z.enum(["None", "Basic256Sha256"]).optional(),
    certificateDirectory: z.string().min(1).default(".tsplc/opcua-pki"),
    username: z.string().min(1).optional(),
    passwordEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z_0-9]*$/)
      .optional(),
  })
  .superRefine((monitor, context) => {
    if (
      monitor.securityPolicy &&
      (monitor.securityMode === "None") !== (monitor.securityPolicy === "None")
    )
      context.addIssue({
        code: "custom",
        path: ["securityPolicy"],
        message: "None mode requires None policy; secure modes require Basic256Sha256.",
      });
    if (monitor.passwordEnv && !monitor.username)
      context.addIssue({
        code: "custom",
        path: ["username"],
        message: "Configure username when passwordEnv is used.",
      });
    if (monitor.username && monitor.securityMode === "None")
      context.addIssue({
        code: "custom",
        path: ["securityMode"],
        message: "Username authentication requires a secure OPC-UA connection.",
      });
  })
  .transform((monitor) => ({
    ...monitor,
    securityPolicy:
      monitor.securityPolicy ??
      (monitor.securityMode === "None" ? ("None" as const) : ("Basic256Sha256" as const)),
  }));
export const typegenSchema = z.strictObject({
  types: z.union([z.string(), z.array(z.string())]).optional(),
  globals: z.union([z.string(), z.array(z.string())]).optional(),
  out: z.string().default("generated/plc.ts"),
  hardwareOut: z.string().default("generated/hardware.ts"),
});
export const tsplcConfigSchema = z.strictObject({
  name: z.string().default("Application"),
  backend: z.literal("codesys"),
  compiler: z
    .strictObject({
      tsconfig: z.string().default("tsconfig.json"),
      programs: z.record(z.string(), z.strictObject({ module: z.string(), export: z.string() })),
    })
    .optional(),
  tasks: z.array(taskSchema).nonempty().optional(),
  // Keep an authored legacy task distinguishable from resolveConfig's default.
  // An explicit shared schedule must have a single owner.
  build: configSchema.extend({ task: configSchema.shape.task.unwrap().optional() }).optional(),
  codesys: z
    .strictObject({
      profile: z
        .strictObject({
          directAddressing: z.literal("byte"),
          numericAddressing: z.enum(["byte", "element"]).optional(),
        })
        .default({ directAddressing: "byte" }),
      globalListNames: z.record(z.string(), z.string()).optional(),
      programNames: z.record(z.string(), z.string()).optional(),
      publishGlobalLists: z.array(z.string()).optional(),
    })
    .optional(),
  eds: z.union([z.string(), z.array(z.string())]).default("eds"),
  devices: z.record(z.string(), hardwareDeviceSchema).default({}),
  io: z.record(z.string(), ioBindingSchema).default({}),
  dependencies: z.record(z.string(), dependencySchema).default({}),
  // Raw ST builds opt into PLC contract generation by configuring this section.
  typegen: typegenSchema.optional(),
  monitor: monitorSchema.optional(),
});
export type TsplcConfig = z.input<typeof tsplcConfigSchema>;
export type ResolvedTsplcConfig = z.output<typeof tsplcConfigSchema>;
export type HardwareDevice = z.infer<typeof hardwareDeviceSchema>;
export type LibraryDependency = z.infer<typeof dependencySchema>;

/** All paths are relative to this file; no package has a second project config. */
export function defineConfig<const C extends TsplcConfig>(config: C): C {
  return config;
}

/** Raw ST program names already are IEC names; use the shared schedule directly. */
export function rawBuildConfig(config: ResolvedTsplcConfig): CodesysBuildConfig {
  if (config.compiler) throw new Error("Use the compiler build plan for TypeScript projects.");
  if (!config.build) throw new Error("Configure build settings.");
  if (!config.tasks) return config.build;
  if (config.build.tasks || config.build.task !== undefined)
    throw new Error("Configure the raw ST schedule in tasks or build.tasks/build.task, not both.");
  return {
    ...config.build,
    tasks: cyclicTasksSchema.parse(
      config.tasks.map((task) => ({
        name: task.name,
        intervalNanoseconds: task.schedule.interval.nanoseconds,
        priority: task.priority,
        programs: task.programs,
      })),
    ),
  };
}

/** Adapt the shared project to the compiler's backend-independent scan model. */
export function compilerConfig(
  config: ResolvedTsplcConfig,
  io: Record<string, { address: string; type?: string }>,
) {
  if (!config.compiler || !config.tasks)
    throw new Error("This project uses raw Structured Text; no TypeScript compiler is configured.");
  const value: PlcConfig = {
    name: config.name,
    tsconfig: config.compiler.tsconfig,
    programs: config.compiler.programs,
    tasks: config.tasks,
    target: {
      kind: config.backend,
      options: {
        ...config.codesys,
        profile: config.codesys?.profile ?? { directAddressing: "byte" },
        io: Object.fromEntries(
          Object.entries(io).map(([name, binding]) => [name, { kind: "direct", ...binding }]),
        ),
        engineering: {
          kind: "v3.5",
          ...(config.build ? { build: compilerBuildOptions(config.build) } : {}),
        },
      },
    },
  };
  const validated = validateCompilerConfig(value);
  if (!validated.config)
    throw new Error(validated.diagnostics.map((item) => item.message).join("\n"));
  return validated.config;
}

function compilerBuildOptions(build: CodesysBuildConfig) {
  const {
    sourceDir: _source,
    entry: _entry,
    outDir: _out,
    task: _task,
    tasks: _tasks,
    runtime: _runtime,
    ...settings
  } = build;
  return settings;
}
