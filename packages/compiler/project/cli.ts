#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadVplcConfig, rawBuildConfig } from "@vplc/config";
import {
  buildProject as buildSt,
  configureDocker,
  inspectController,
  installLibraries,
  loadSources,
  resolveConfig,
  runProject,
  updateController,
} from "@vplc/build";
import { checkHostConfig } from "@vplc/compiler";
import { formatDiagnostic, hasErrors } from "@vplc/compiler/ir";
import { loadHardware, resolveIo } from "@vplc/typegen/hardware";
import { generateProject } from "@vplc/typegen";
import { buildProject, checkProject, cleanProject } from "./project.ts";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
      "emit-only": { type: "boolean" },
      format: { type: "string" },
      read: { type: "string", multiple: true },
      "initialize-user": { type: "boolean" },
      "frozen-lockfile": { type: "boolean" },
      check: { type: "boolean" },
    },
  });
  const command = positionals[0],
    file = values.config ?? "vplc.config.ts";
  if (!command || values.help) {
    console.log(
      "vplc install|typegen|check|build|run|download|online-change|inspect|clean|configure [--config vplc.config.ts] [--emit-only] [--format json] [--read symbol]",
    );
    return 0;
  }
  if (positionals.length > 1) throw new Error("Specify one command.");
  if (
    ![
      "install",
      "typegen",
      "check",
      "build",
      "run",
      "download",
      "online-change",
      "inspect",
      "clean",
      "configure",
    ].includes(command)
  )
    throw new Error(`Unknown command ${command}.`);
  if (values.format && !["json", "text"].includes(values.format))
    throw new Error("--format must be json or text.");
  if (values["emit-only"] && command !== "build")
    throw new Error("--emit-only is supported by build only.");
  const log = console.log,
    previousLogTarget = process.env["VPLC_LOG_STDERR"];
  if (values.format === "json") {
    console.log = console.error;
    process.env["VPLC_LOG_STDERR"] = "1";
  }
  let result: unknown;
  try {
    if (command === "configure") {
      const image =
        values.config !== undefined || existsSync(file)
          ? (await loadVplcConfig(file)).config.build?.docker?.image
          : undefined;
      await configureDocker(image);
      result = { ok: true };
    } else if (command === "clean") {
      result = await cleanProject(file);
    } else {
      if (["check", "build", "run", "download", "online-change"].includes(command)) {
        const diagnostics = checkHostConfig(resolve(file));
        if (hasErrors(diagnostics)) throw new DiagnosticFailure({ diagnostics });
      }
      const loaded = await loadVplcConfig(file);
      const { config, configFile, root } = loaded;
      if (command === "install")
        result = {
          libraries: await installLibraries(config.dependencies, root, {
            frozen: values["frozen-lockfile"],
          }),
        };
      else if (command === "typegen") {
        if (config.compiler && !values.check) {
          await generateProject(file, { hardwareOnly: true, loaded });
          const emitted = await buildProject(file, { emitOnly: true, loaded });
          if (hasErrors(emitted.diagnostics)) throw new DiagnosticFailure(emitted);
        }
        result = await generateProject(file, { check: values.check, loaded });
      } else if (command === "check") {
        result = config.compiler
          ? await checkProject(file, { loaded })
          : {
              objects: (
                await loadSources(
                  resolveConfig(
                    {
                      ...rawBuildConfig(config),
                      io: resolveIo(config, await loadHardware(config, root)),
                    },
                    configFile,
                  ),
                )
              ).objects.length,
            };
      } else if (command === "build" || command === "run") {
        if (config.compiler) {
          const built = await buildProject(file, {
            emitOnly: values["emit-only"],
            frozenLockfile: values["frozen-lockfile"],
            loaded,
          });
          if (hasErrors(built.diagnostics)) throw new DiagnosticFailure(built);
          await generateProject(file, { loaded });
          result = built;
        } else {
          if (values["emit-only"]) throw new Error("Raw Structured Text is already emitted.");
          if (!config.build) throw new Error("Configure build settings.");
          const build = rawBuildConfig(config);
          const libraries = await installLibraries(config.dependencies, root, {
            frozen: values["frozen-lockfile"],
          });
          result = await buildSt(
            resolveConfig(
              {
                ...build,
                libraries,
                io: resolveIo(config, await loadHardware(config, root)),
              },
              configFile,
            ),
          );
          await generateProject(file, { hardwareOnly: !config.typegen, loaded });
        }
        if (command === "run") {
          if (!config.build) throw new Error("Configure build.runtime to run this project.");
          await runProject(
            resolveConfig(config.compiler ? config.build : rawBuildConfig(config), configFile),
          );
        }
      } else if (command === "inspect") {
        if (!config.build) throw new Error("Configure build settings and controller connection.");
        // Inspection needs only the connection/baseline. It must remain usable
        // when local sources, descriptors or dependency caches are unavailable.
        result = await inspectController(resolveConfig(config.build, configFile), values.read);
      } else if (["download", "online-change"].includes(command)) {
        if (!config.build) throw new Error("Configure build settings and controller connection.");
        let settings: ReturnType<typeof resolveConfig>;
        if (config.compiler) {
          const emitted = await buildProject(file, { emitOnly: true, loaded });
          if (hasErrors(emitted.diagnostics)) throw new DiagnosticFailure(emitted);
          if (!emitted.controllerConfig)
            throw new Error("Configure build settings for deployment.");
          // Emission already resolves the generated entry/task paths. Passing
          // this through the input schema again would reject its configFile.
          settings = { ...emitted.controllerConfig, io: {} };
        } else
          settings = resolveConfig(
            {
              ...rawBuildConfig(config),
              io: resolveIo(config, await loadHardware(config, root)),
            },
            configFile,
          );
        const libraries = await installLibraries(config.dependencies, root, {
          frozen: values["frozen-lockfile"],
        });
        result = await updateController(
          { ...settings, libraries },
          command as "download" | "online-change",
          {
            initializeUser: values["initialize-user"],
            read: values.read,
          },
        );
      } else throw new Error(`Unknown command ${command}.`);
    }
  } finally {
    console.log = log;
    if (previousLogTarget === undefined) delete process.env["VPLC_LOG_STDERR"];
    else process.env["VPLC_LOG_STDERR"] = previousLogTarget;
  }
  return report(result, values.format);
}
class DiagnosticFailure extends Error {
  constructor(readonly result: unknown) {
    super("PLC validation failed.");
  }
}
function report(result: unknown, format?: string) {
  const diagnostics =
    result && typeof result === "object" && "diagnostics" in result
      ? (result.diagnostics as import("@vplc/compiler/ir").Diagnostic[])
      : [];
  const ok = !hasErrors(diagnostics);
  if (format === "json")
    console.log(
      JSON.stringify({ ok, ...(result && typeof result === "object" ? result : { result }) }),
    );
  else {
    for (const diagnostic of diagnostics) console.error(formatDiagnostic(diagnostic));
    if (ok) console.log("vPLC completed.");
  }
  return ok ? 0 : 1;
}
try {
  process.exitCode = await main();
} catch (cause) {
  if (cause instanceof DiagnosticFailure) {
    process.exitCode = report(
      cause.result,
      process.argv.includes("json") || process.argv.includes("--format=json") ? "json" : undefined,
    );
  } else {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (process.argv.includes("json") || process.argv.includes("--format=json"))
      console.log(
        JSON.stringify({
          ok: false,
          diagnostics: [{ origin: "config", code: "PLC5003", severity: "error", message }],
        }),
      );
    else console.error(message);
    process.exitCode = 1;
  }
}
