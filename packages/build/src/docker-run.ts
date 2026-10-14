import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, posix, relative, resolve, sep } from "node:path";
import type { ResolvedConfig } from "./config.ts";

/** Run a Docker client command attached to this terminal and forward interruption to it. */
export const runDocker = (args: string[], failure: (status: string | number | null) => string) =>
  new Promise<void>((accept, reject) => {
    const child = spawn("docker", args, {
      stdio: ["inherit", process.env["TSPLC_LOG_STDERR"] === "1" ? 2 : "inherit", "inherit"],
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (cause) => {
      cleanup();
      reject(
        new Error("Cannot start Docker. Install and start Docker Desktop or Docker Engine", {
          cause,
        }),
      );
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0) {
        accept();
      } else {
        reject(new Error(failure(signal ?? code)));
      }
    });
  });

const bindMount = (source: string, target: string, readonly = false) =>
  `type=bind,"source=${source.replaceAll('"', '""')}",target=${target}${readonly ? ",readonly" : ""}`;

async function mountLibraries(libraries: ResolvedConfig["libraries"], directory: string) {
  if (!libraries?.length) return undefined;
  await mkdir(resolve(directory, "libraries"), { recursive: true });
  return Promise.all(
    libraries.map(async (library) => {
      const data = await readFile(library.path);
      if (createHash("sha256").update(data).digest("hex") !== library.sha256)
        throw new Error(`Library changed after installation: ${library.title}`);
      const filename = `${library.sha256}-${basename(library.path)}`;
      await writeFile(resolve(directory, "libraries", filename), data);
      return { ...library, path: `/input/libraries/${filename}` };
    }),
  );
}

/**
 * Write the builder container's request and return the `docker run` options that precede
 * the image. The request names only container paths; host paths enter through these mounts,
 * and host-only Docker, CODESYS and runtime settings stay outside.
 */
export const prepareContainerRun = async (
  config: ResolvedConfig,
  requestDirectory: string,
  options: { network: string; environment?: string[]; sources: boolean },
) => {
  await writeFile(
    resolve(requestDirectory, "config.json"),
    JSON.stringify({
      ...config,
      libraries: options.sources ? await mountLibraries(config.libraries, requestDirectory) : [],
      configFile: undefined,
      docker: undefined,
      codesys: undefined,
      sourceDir: "/sources",
      entry: posix.resolve(
        "/sources",
        relative(config.sourceDir, config.entry).split(sep).join("/"),
      ),
      template: "/template.project",
      outDir: "/output",
      runtime: undefined,
    }),
  );
  return [
    "run",
    "--rm",
    "--init",
    ...(config.docker?.cpuSet ? ["--cpuset-cpus", config.docker.cpuSet] : []),
    "--network",
    options.network,
    ...(process.getuid && process.getgid
      ? ["--user", `${process.getuid()}:${process.getgid()}`]
      : []),
    ...(options.environment ?? []).flatMap((name) => ["--env", name]),
    "--mount",
    bindMount(requestDirectory, "/input", true),
    ...(options.sources ? ["--mount", bindMount(config.sourceDir, "/sources", true)] : []),
    "--mount",
    bindMount(config.template, "/template.project", true),
    "--mount",
    bindMount(config.outDir, "/output"),
  ];
};
