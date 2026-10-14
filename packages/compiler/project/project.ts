import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildCodesys,
  codesysBuildConfig,
  type CodesysPlan,
  diagnoseCodesys,
  emitCodesys,
  ioTargets,
  planCodesys,
} from "@tsplc/compiler/codesys";
import { analyze, checkHostConfig } from "@tsplc/compiler";
import {
  type NormalizedConfig,
  type ResolvedTsplcConfig,
  compilerConfig,
  loadTsplcConfig,
} from "@tsplc/config";
import { type IoTarget, loadHardware, resolveIo } from "@tsplc/typegen";
import { installLibraries } from "@tsplc/build";
import { type Diagnostic, hasErrors, normalizeModule } from "@tsplc/compiler/ir";
import { cleanArtifacts, engineeringDirectory, owned, publishArtifacts } from "./artifacts.ts";

const failure = (origin: Diagnostic["origin"], code: string, cause: unknown): Diagnostic => ({
  origin,
  code,
  severity: "error",
  message: cause instanceof Error ? cause.message : String(cause),
});

type LoadedConfig = Awaited<ReturnType<typeof loadTsplcConfig>>;

async function loadProject(
  file: string,
  loaded?: LoadedConfig,
): Promise<{
  config?: NormalizedConfig;
  configFile: string;
  shared?: ResolvedTsplcConfig;
  diagnostics: readonly Diagnostic[];
}> {
  let configFile = resolve(file);
  try {
    configFile = await realpath(configFile);
    const diagnostics = checkHostConfig(configFile);
    if (hasErrors(diagnostics)) {
      return { configFile, diagnostics };
    }

    const root = dirname(configFile);
    const shared = (loaded ?? (await loadTsplcConfig(configFile))).config;
    const config = compilerConfig(shared, resolveIo(shared, await loadHardware(shared, root)));
    return { configFile, shared, config: { ...config, ...sourceInput(config, root) }, diagnostics };
  } catch (cause) {
    return { configFile, diagnostics: [failure("config", "PLC5003", cause)] };
  }
}

/** The analyzer's entry points, resolved against the config file's directory. */
function sourceInput(
  compiler: { tsconfig: string; programs: Record<string, { module: string; export: string }> },
  root: string,
) {
  return {
    tsconfig: resolve(root, compiler.tsconfig),
    programs: Object.fromEntries(
      Object.entries(compiler.programs).map(([name, entry]) => [
        name,
        { ...entry, module: resolve(root, entry.module) },
      ]),
    ),
  };
}

/**
 * Keys an `io` mapping may bind, read from the analyzed PLC source. It ignores the
 * config's own validity, so a mistyped key cannot switch off the types that flag it;
 * it is undefined only while the source itself fails analysis.
 */
export async function projectIoTargets(
  file = "tsplc.config.ts",
  options: { loaded?: LoadedConfig } = {},
): Promise<IoTarget[] | undefined> {
  const configFile = await realpath(resolve(file));
  const { config } = options.loaded ?? (await loadTsplcConfig(configFile));
  if (!config.compiler) return undefined;
  const source = analyze(sourceInput(config.compiler, dirname(configFile)));
  const core = source.module && normalizeModule(source.module).core;
  return core ? ioTargets(core) : undefined;
}

export async function checkProject(
  file = "tsplc.config.ts",
  options: { loaded?: LoadedConfig } = {},
): Promise<{
  configFile: string;
  config?: NormalizedConfig;
  shared?: ResolvedTsplcConfig;
  plan?: CodesysPlan;
  diagnostics: readonly Diagnostic[];
}> {
  const loaded = await loadProject(file, options.loaded);
  if (!loaded.config) {
    return loaded;
  }

  const config = loaded.config;
  if (config.target.kind !== "codesys") {
    return {
      ...loaded,
      diagnostics: [failure("backend", "PLC7001", `Unsupported target: ${config.target.kind}`)],
    };
  }

  const source = analyze({ tsconfig: config.tsconfig, programs: config.programs });
  if (!source.module) {
    return { ...loaded, diagnostics: source.diagnostics };
  }
  const normalized = normalizeModule(source.module);
  if (!normalized.core) {
    return { ...loaded, diagnostics: normalized.diagnostics };
  }

  const tasks = config.tasks.map((task) => ({
    name: task.name,
    intervalNanoseconds: task.schedule.interval.nanoseconds,
    priority: task.priority,
    programs: task.programs,
  }));
  const planned = planCodesys(normalized.core, { tasks }, config.target.options);
  return {
    ...loaded,
    ...planned,
    diagnostics: [
      ...loaded.diagnostics,
      ...source.diagnostics,
      ...normalized.diagnostics,
      ...planned.diagnostics,
    ],
  };
}

export async function buildProject(
  file = "tsplc.config.ts",
  options: { emitOnly?: boolean; frozenLockfile?: boolean; loaded?: LoadedConfig } = {},
): Promise<{
  directory?: string;
  status?: "emitted" | "vendor-compiled";
  controllerConfig?: ReturnType<typeof codesysBuildConfig>;
  diagnostics: readonly Diagnostic[];
}> {
  let staging: string | undefined;
  try {
    const configFile = await realpath(resolve(file));
    // Withdraw the previous success receipt before checking the new source.
    // Old artifacts remain owned and intact until publication succeeds.
    const previous = await owned(configFile, true);
    if (previous.unknown.length) {
      throw new Error(`Output contains unrelated files: ${previous.unknown.join(", ")}`);
    }

    const checked = await checkProject(configFile, { loaded: options.loaded });
    if (!checked.plan || !checked.config) {
      return { diagnostics: checked.diagnostics };
    }
    const bundle = emitCodesys(checked.plan);
    if (hasErrors(bundle.diagnostics)) {
      return { diagnostics: bundle.diagnostics };
    }
    const controllerConfig = checked.shared?.build
      ? codesysBuildConfig(checked.plan, bundle, {
          configFile,
          sourceDir: join(previous.output, "st"),
          outDir: resolve(dirname(configFile), checked.shared.build.outDir),
        })
      : undefined;

    await mkdir(previous.root, { recursive: true });
    staging = await mkdtemp(join(previous.root, "stage-"));
    const artifacts = [
      ...bundle.artifacts,
      { path: "mappings.json", content: `${JSON.stringify(bundle.mappings, null, 2)}\n` },
      { path: "io-symbols.json", content: `${JSON.stringify(bundle.ioSymbols, null, 2)}\n` },
      { path: "config.json", content: `${JSON.stringify(checked.config, null, 2)}\n` },
    ];
    for (const artifact of artifacts) {
      const path = join(staging, "st", artifact.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, artifact.content);
    }

    let vendor: Awaited<ReturnType<typeof buildCodesys>> | undefined;
    if (!options.emitOnly) {
      // The engineering cache has its own ownership marker and survives clean.
      const engineering = checked.shared?.build
        ? resolve(dirname(configFile), checked.shared.build.outDir ?? "build")
        : join(previous.root, "engineering");
      const libraries = checked.shared
        ? await installLibraries(checked.shared.dependencies, dirname(configFile), {
            frozen: options.frozenLockfile,
          })
        : undefined;
      await engineeringDirectory(engineering, configFile);
      try {
        vendor = await buildCodesys(checked.plan, bundle, {
          configFile,
          sourceDir: join(staging, "st"),
          outDir: engineering,
          libraries,
        });
      } catch (cause) {
        return { diagnostics: diagnoseCodesys(cause, bundle) };
      }

      const vendorArtifacts = [
        ["Application.project", vendor.project],
        ["Application.app", vendor.output],
        ["Application.crc", vendor.checksum],
      ] as const;
      for (const [name, path] of vendorArtifacts) {
        if (!path) continue;
        const destination = join(staging, "vendor", name);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(path, destination);
      }
    }

    const status = vendor ? "vendor-compiled" : "emitted";
    await publishArtifacts(staging, previous, {
      configFile,
      status,
      ...(vendor && { vendor: { application: vendor.application, tasks: vendor.tasks } }),
    });
    // Publication moved this directory into place; it is no longer staging.
    staging = undefined;
    return {
      directory: previous.output,
      status,
      ...(controllerConfig && { controllerConfig }),
      diagnostics: [...checked.diagnostics, ...bundle.diagnostics],
    };
  } catch (cause) {
    return { diagnostics: [failure("config", "PLC5004", cause)] };
  } finally {
    if (staging) {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

export async function cleanProject(file = "tsplc.config.ts"): Promise<{
  diagnostics: readonly Diagnostic[];
}> {
  try {
    await cleanArtifacts(await realpath(resolve(file)));
    return { diagnostics: [] };
  } catch (cause) {
    return { diagnostics: [failure("config", "PLC5004", cause)] };
  }
}
