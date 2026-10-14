import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const commandArgumentSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Command arguments must not be empty")
  .refine(
    (value) => !/["\r\n\0]/.test(value),
    "Command arguments must not contain quotes, line breaks, or null bytes",
  );
// CODESYS startup and project loading can each take several minutes.
export const codesysTimeouts = {
  build: 20 * 60 * 1000,
  hostCommand: 15_000,
  runtime: 60_000,
  startup: 20 * 60 * 1000,
  stop: 10_000,
  terminate: 5000,
};

const positiveMilliseconds = z.number().int().positive();
const pathSchema = z.string().trim().nonempty();
const wineSchema = z.strictObject({
  prefix: pathSchema,
  binary: pathSchema.default("wine"),
  pathBinary: pathSchema.default("winepath"),
  debug: z.string().default("-all"),
  nativeExit: z.boolean().default(false),
});
const localCodesysSchema = z.strictObject({
  executable: commandArgumentSchema,
  profile: commandArgumentSchema,
  wine: wineSchema.optional(),
  commandProcessor: pathSchema.default("cmd.exe"),
});

export const dockerImage = "tsplc-build:3.5.22.30";
export const containerCodesys = {
  executable: "/tmp/codesys-wine/drive_c/CODESYS-3.5.22.30/CODESYS/Common/CODESYS.exe",
  profile: "CODESYS V3.5 SP22 Patch 3",
  wine: { prefix: "/tmp/codesys-wine", nativeExit: true },
};
const iecName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
export const cyclicTasksSchema = z
  .array(
    z.strictObject({
      name: iecName,
      intervalNanoseconds: z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .refine((value) => {
          if (!/^[1-9][0-9]*$/.test(value)) {
            return false;
          }
          const ns = BigInt(value);
          return ns % 1_000_000n === 0n && ns <= 4_294_967_295_000_000n;
        }, "Cyclic tasks require an exact positive TIME interval in milliseconds"),
      priority: z.number().int().min(0).max(31),
      programs: z.array(iecName).nonempty(),
    }),
  )
  .nonempty()
  .superRefine((tasks, context) => {
    const names = new Set<string>(),
      programs = new Set<string>();
    tasks.forEach((task, index) => {
      if (names.has(task.name.toLowerCase())) {
        context.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "Task names must be unique",
        });
      }
      names.add(task.name.toLowerCase());
      task.programs.forEach((program, position) => {
        if (programs.has(program.toLowerCase())) {
          context.addIssue({
            code: "custom",
            path: [index, "programs", position],
            message: "A program can be scheduled only once",
          });
        }
        programs.add(program.toLowerCase());
      });
    });
  });
export type CyclicTask = z.infer<typeof cyclicTasksSchema>[number];
/** A process-image address in CODESYS byte addressing, with an optional IEC type. */
export const directIoBindingSchema = z.strictObject({
  address: z.string().regex(/^%[IQ](?:X\d+\.[0-7]|[BWD]\d+)$/),
  type: z.string().optional(),
});
export const configSchema = z.strictObject({
  io: z.record(z.string(), directIoBindingSchema).optional(),
  libraries: z
    .array(
      z.strictObject({
        title: z.string(),
        company: z.string().optional(),
        version: z.string().optional(),
        namespace: z.string().optional(),
        path: pathSchema,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        url: z.string().optional(),
      }),
    )
    .optional(),
  docker: z
    .strictObject({
      image: pathSchema.default(dockerImage),
      cpuSet: z
        .string()
        .regex(/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/)
        .optional(),
    })
    .optional(),
  template: pathSchema,
  sourceDir: pathSchema.default("src"),
  entry: pathSchema.default("src/Main.st"),
  outDir: pathSchema.default("build"),
  task: z.string().nonempty().default("MainTask"),
  tasks: cyclicTasksSchema.optional(),
  removeObjects: z.array(z.string().nonempty()).default([]),
  symbols: z.boolean().default(false),
  online: z
    .strictObject({
      network: pathSchema.default("bridge"),
      gateway: z.strictObject({
        host: pathSchema,
        port: z.number().int().min(1).max(65535).default(1217),
      }),
      device: z.strictObject({
        host: pathSchema,
        port: z.number().int().min(1).max(65535).default(11740),
      }),
      credentials: z
        .strictObject({
          usernameEnv: z.string().regex(/^[A-Za-z_][A-Za-z_0-9]*$/),
          passwordEnv: z.string().regex(/^[A-Za-z_][A-Za-z_0-9]*$/),
        })
        .optional(),
    })
    .optional(),
  runtime: z
    .strictObject({
      composeFile: pathSchema,
      service: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
        .default("plc"),
    })
    .optional(),
  timeouts: z
    .strictObject({
      startup: positiveMilliseconds.default(codesysTimeouts.startup),
      build: positiveMilliseconds.default(codesysTimeouts.build),
      stop: positiveMilliseconds.default(codesysTimeouts.stop),
      terminate: positiveMilliseconds.default(codesysTimeouts.terminate),
      hostCommand: positiveMilliseconds.default(codesysTimeouts.hostCommand),
      runtime: positiveMilliseconds.default(codesysTimeouts.runtime),
    })
    .prefault({}),
});
export type CodesysBuildConfig = z.input<typeof configSchema>;
export type ResolvedConfig = z.output<typeof configSchema> & {
  configFile: string;
  codesys: z.output<typeof localCodesysSchema>;
};

/** Keep config authoring typed; validation and relative path resolution happen at load. */
export const defineBuildConfig = (config: CodesysBuildConfig): CodesysBuildConfig => config;

export const resolveConfig = (input: unknown, configFile: string): ResolvedConfig => {
  const parsed = configSchema.parse(input);
  const root = dirname(resolve(configFile));
  const codesys = localCodesysSchema.parse(containerCodesys);
  return {
    ...parsed,
    docker: parsed.docker ?? { image: dockerImage },
    configFile: resolve(configFile),
    template: resolve(root, parsed.template),
    libraries: parsed.libraries?.map((library) => ({
      ...library,
      path: resolve(root, library.path),
    })),
    sourceDir: resolve(root, parsed.sourceDir),
    entry: resolve(root, parsed.entry),
    outDir: resolve(root, parsed.outDir),
    runtime: parsed.runtime
      ? {
          ...parsed.runtime,
          composeFile: resolve(root, parsed.runtime.composeFile),
        }
      : undefined,
    codesys: {
      ...codesys,
      executable: resolve(root, codesys.executable),
      wine: codesys.wine
        ? { ...codesys.wine, prefix: resolve(root, codesys.wine.prefix) }
        : undefined,
    },
  };
};

export const loadConfig = async (file = "tsplc.config.ts") => {
  const path = resolve(file);
  const module = (await import(pathToFileURL(path).href)) as {
    config?: unknown;
    default?: unknown;
  };
  if (module.default === undefined && module.config === undefined) {
    throw new Error(`${path} must export a default config`);
  }
  const input = module.default ?? module.config;
  if (input && typeof input === "object" && "build" in input) {
    const { rawBuildConfig, tsplcConfigSchema } = await import("./schema.ts");
    return resolveConfig(rawBuildConfig(tsplcConfigSchema.parse(input)), path);
  }
  return resolveConfig(input, path);
};
