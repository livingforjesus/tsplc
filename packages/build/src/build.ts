import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildFiles, publishBuild, readBuild } from "./artifacts";
import type { ResolvedConfig } from "./config";
import { buildInDocker } from "./docker-build";
import { createCodesysWorker, withWorkerLock } from "./host/codesys-worker";
import { loadSources } from "./sources";
import { toWindowsPath } from "./host/windows-path.ts";

export const buildProject = async (config: ResolvedConfig) => {
  if (!config.docker) throw new Error("Builds require a Docker builder image.");
  return buildInDocker(config, config.docker.image);
};

/** The container runner owns Wine; this operation is not a public host build. */
export const buildInContainer = async (config: ResolvedConfig) => {
  return withWorkerLock(config, async () => {
    // Invalidate the previous build before validation, so run cannot deploy stale
    // output after a failed rebuild. Keep the last project available for inspection.
    await rm(resolve(config.outDir, buildFiles.receipt), { force: true });
    const sources = await loadSources(config);
    await access(config.template);
    const worker = createCodesysWorker(config);
    const session = await worker.launch();
    const directory = resolve(config.outDir, ".codesys/build");
    await rm(directory, { recursive: true, force: true });
    await mkdir(resolve(directory, "runtime"), { recursive: true });
    const template = resolve(directory, "Template.project");
    await copyFile(config.template, template);
    const request = {
      libraries: await Promise.all(
        (config.libraries ?? []).map(async (library) => ({
          ...library,
          path: await toWindowsPath(library.path, config.codesys.wine),
        })),
      ),
      ...sources,
      task: config.task,
      ...(config.tasks && { tasks: config.tasks }),
      removeObjects: config.removeObjects,
      symbols: config.symbols,
      mode: "build",
      output: buildFiles.output,
      project: buildFiles.project,
      receipt: buildFiles.receipt,
      template: "Template.project",
      templateHash: createHash("sha256")
        .update(await readFile(template))
        .digest("hex"),
    };
    await writeFile(resolve(directory, "request.json"), JSON.stringify(request, null, 2));
    console.log(`CODESYS build: ${config.outDir}`);
    try {
      await worker.request(session, { action: "build" }, config.timeouts.build);
      const compiled = await readBuild(directory);
      if (config.tasks && JSON.stringify(compiled.tasks) !== JSON.stringify(config.tasks)) {
        throw new Error("CODESYS build receipt does not match the requested task plan");
      }
      // Builds and runs share the lock. Removing the receipt above keeps a failed
      // publication from looking complete even if only some files were replaced.
      return await publishBuild(compiled, config.outDir);
    } catch (cause) {
      throw new Error(
        `CODESYS build failed. Inspect ${directory}/progress.log, error.txt and ${session.directory}/codesys.log`,
        { cause },
      );
    }
  });
};
