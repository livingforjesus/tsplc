#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { loadHardware, resolveIo } from "@tsplc/typegen/hardware";
import { loadTsplcConfig, rawBuildConfig } from "@tsplc/config";
import { buildProject } from "./build.ts";
import { resolveConfig } from "./config.ts";
import { inspectController, updateController } from "./controller-online.ts";
import { configureDocker } from "./docker-build.ts";
import { installLibraries } from "./libraries.ts";
import { runProject } from "./run.ts";
import { loadSources } from "./sources.ts";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
      read: { type: "string", multiple: true },
      "initialize-user": { type: "boolean" },
      "frozen-lockfile": { type: "boolean" },
    },
  });
  const command = positionals[0];
  const commands = new Set([
    "configure",
    "install",
    "check",
    "build",
    "run",
    "download",
    "online-change",
    "inspect",
  ]);
  if (positionals.length > 1) throw new Error("Specify one command.");
  if (!command || values.help) {
    console.log(
      "tsplc-build configure|install|check|build|run|download|online-change|inspect [--config tsplc.config.ts] [--read symbol]",
    );
    return;
  }
  if (!commands.has(command)) throw new Error(`Unknown command ${command}.`);
  if (command === "configure") {
    const file = values.config ?? "tsplc.config.ts";
    const image =
      values.config !== undefined || existsSync(file)
        ? (await loadTsplcConfig(file)).config.build?.docker?.image
        : undefined;
    await configureDocker(image);
    return;
  }
  const { config, configFile, root } = await loadTsplcConfig(values.config);
  if (command === "install") {
    const libraries = await installLibraries(config.dependencies, root, {
      frozen: values["frozen-lockfile"],
    });
    console.log(`Installed ${libraries.length} CODESYS libraries.`);
    return;
  }
  if (!config.build) throw new Error("Configure build options in tsplc.config.ts.");
  if (command === "inspect") {
    // Inspection only needs connection/baseline settings; it remains usable
    // without sources, EDS descriptors or installed library payloads.
    console.log(
      JSON.stringify(
        await inspectController(resolveConfig(config.build, configFile), values.read),
        null,
        2,
      ),
    );
    return;
  }
  if (config.compiler)
    throw new Error("Use tsplc for TypeScript projects. tsplc-build accepts raw Structured Text.");
  const build = rawBuildConfig(config);
  const io = resolveIo(config, await loadHardware(config, root));
  if (command === "check") {
    const sources = await loadSources(resolveConfig({ ...build, io }, configFile));
    console.log(`Validated ${sources.objects.length} Structured Text objects.`);
    return;
  }
  const libraries = await installLibraries(config.dependencies, root, {
    frozen: values["frozen-lockfile"],
  });
  const settings = resolveConfig({ ...build, libraries, io }, configFile);
  if (command === "build") await buildProject(settings);
  else if (command === "run") {
    await buildProject(settings);
    await runProject(settings);
  } else if (command === "download" || command === "online-change")
    await updateController(settings, command, {
      initializeUser: values["initialize-user"],
      read: values.read,
    });
}
try {
  await main();
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
}
