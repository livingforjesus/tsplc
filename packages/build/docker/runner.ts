import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { buildFiles, publishBuild } from "../src/artifacts";
import { buildInContainer } from "../src/build";
import { resolveContainerConfig } from "./config.ts";
import { runControllerSession } from "../src/controller-session";
import { createCodesysWorker, withWorkerShutdown } from "../src/host/codesys-worker";
import { buildFailureFile, describeBuildFailure } from "../src/diagnostics.ts";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    config: { type: "string" },
    request: { type: "string" },
    job: { type: "string" },
    help: { type: "boolean", short: "h" },
    "image-id": { type: "string" },
    "operation-id": { type: "string" },
    "initialize-user": { type: "boolean" },
    read: { type: "string" },
  },
});
if (values.help || (!positionals.length && !values.request && !values.job)) {
  console.log(
    "codesys-build build|download|online-change|inspect [--config codesys-build.config.ts]\n\nDocker contains Bun, Wine and CODESYS 3.5.22.30. Outputs are written to the configured outDir.",
  );
  process.exit(0);
}
if (
  positionals.length &&
  (positionals.length !== 1 ||
    !["build", "download", "online-change", "inspect"].includes(positionals[0] ?? ""))
) {
  throw new Error("The builder container supports build, download, online-change and inspect.");
}
const configFile = resolve(values.config ?? "codesys-build.config.ts");
const inputFile = values.job ?? values.request;
const input = inputFile
  ? JSON.parse(await readFile(inputFile, "utf8"))
  : z
      .object({ config: z.record(z.string(), z.unknown()) })
      .parse(await import(pathToFileURL(configFile).href)).config;
// Host installation paths never enter Wine inside this container.
const config = resolveContainerConfig(input, configFile);
const directory = resolve(config.outDir, ".codesys/docker");
const operation = positionals[0] ?? "build";
await mkdir(directory, { recursive: true });

if (!values.job) {
  const request = "/tmp/codesys-job-config.json";
  await writeFile(
    request,
    JSON.stringify({ ...config, configFile: undefined, codesys: undefined }),
  );
  const child = Bun.spawn(
    [
      "flock",
      "--nonblock",
      "--conflict-exit-code",
      "73",
      resolve(directory, "command.lock"),
      process.execPath,
      import.meta.path,
      "--job",
      request,
      operation,
      ...(values["image-id"] ? ["--image-id", values["image-id"]] : []),
      ...(values["operation-id"] ? ["--operation-id", values["operation-id"]] : []),
      ...(values["initialize-user"] ? ["--initialize-user"] : []),
      ...(values.read ? ["--read", values.read] : []),
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );
  const code = await child.exited;
  if (code === 73) {
    console.error(`Another Docker command is using ${config.outDir}`);
  }
  process.exit(code);
}

if (operation !== "build") {
  const imageId = z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .parse(values["image-id"]);
  const operationId = z.string().uuid().parse(values["operation-id"]);
  const read = z.array(z.string().nonempty()).parse(JSON.parse(values.read ?? "[]"));
  await runControllerSession(
    config,
    z.enum(["download", "online-change", "inspect"]).parse(operation),
    {
      imageId,
      operationId,
      read,
      initializeUser: values["initialize-user"],
    },
  );
  console.log(`Completed ${operation}. Controller state: ${config.outDir}/.codesys/controller`);
  process.exit(0);
}

await rm(resolve(config.outDir, buildFiles.receipt), { force: true });
const jobConfig = { ...config, outDir: resolve(directory, "job") };
// PIDs from a previous container cannot identify processes in this job.
await rm(resolve(jobConfig.outDir, ".codesys/session.json"), { force: true });
await rm(resolve(jobConfig.outDir, ".codesys/command.lock"), { force: true });
const operationId = z.uuid().parse(values["operation-id"] ?? randomUUID());
// A worker crash must not publish a receipt that another command can deploy.
try {
  const result = await withWorkerShutdown(jobConfig, createCodesysWorker(jobConfig), () =>
    buildInContainer(jobConfig),
  );
  await publishBuild(result, config.outDir);
  console.log(`Completed build. Artifacts: ${config.outDir}`);
} catch (cause) {
  try {
    await writeFile(
      resolve(config.outDir, buildFailureFile),
      JSON.stringify({ operationId, ...describeBuildFailure(cause) }, null, 2),
    );
  } catch (metadataError) {
    // The original compiler/worker failure still determines the container exit status.
    console.error("Could not save CODESYS failure metadata", metadataError);
  }
  throw cause;
}
