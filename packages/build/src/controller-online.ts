import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { type ResolvedConfig } from "./config";

import { mountLibraries } from "./mount-libraries.ts";

const execute = promisify(execFile);
const imageIdSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const endpointSchema = z.strictObject({
  host: z.string().nonempty(),
  port: z.number().int().min(1).max(65535),
});
export const controllerResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: z.uuid(),
  operation: z.enum(["download", "online-change", "inspect"]),
  imageId: imageIdSchema,
  templateHash: z.string().regex(/^[a-f0-9]{64}$/),
  target: z.strictObject({
    network: z.string().nonempty(),
    gateway: endpointSchema,
    device: endpointSchema,
  }),
  generation: z.string().nonempty(),
  application: z.string().nonempty(),
  applicationGuid: z.string().nonempty(),
  controllerIds: z.strictObject({
    codeId: z.string().nonempty(),
    dataId: z.string().nonempty(),
  }),
  state: z.string().nonempty(),
  values: z.record(z.string(), z.string()),
});
export type ControllerResult = z.infer<typeof controllerResultSchema>;
export type ControllerUpdateOptions = {
  initializeUser?: boolean;
  read?: string[];
};

const bindMount = (source: string, target: string, readonly = false) =>
  `type=bind,"source=${source.replaceAll('"', '""')}",target=${target}${readonly ? ",readonly" : ""}`;

const runDocker = (args: string[], diagnostics: string) =>
  new Promise<void>((accept, reject) => {
    const child = spawn("docker", args, {
      stdio: ["inherit", process.env["VPLC_LOG_STDERR"] === "1" ? 2 : "inherit", "inherit"],
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
        reject(
          new Error(
            `Docker controller operation failed (${signal ?? code}). Inspect ${diagnostics} for diagnostics`,
          ),
        );
      }
    });
  });

const controllerOperation = async (
  config: ResolvedConfig,
  operation: ControllerResult["operation"],
  options: ControllerUpdateOptions,
): Promise<ControllerResult> => {
  if (!config.docker || !config.online) {
    throw new Error(
      "Docker image and online gateway/device configuration are required for controller operations",
    );
  }
  const environmentNames = config.online.credentials
    ? [config.online.credentials.usernameEnv, config.online.credentials.passwordEnv]
    : [];
  for (const name of environmentNames) {
    if (process.env[name] === undefined) {
      throw new Error(`Controller credential environment variable ${name} is not set`);
    }
  }
  const { stdout } = await execute(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", config.docker.image],
    { timeout: config.timeouts.hostCommand },
  ).catch((cause: unknown) => {
    throw new Error(
      `Cannot inspect Docker builder image ${config.docker?.image}. Install and start Docker, then run vplc-build configure if the image is missing`,
      { cause },
    );
  });
  const imageId = imageIdSchema.parse(stdout.trim());
  const templateHash = createHash("sha256")
    .update(await readFile(config.template))
    .digest("hex");
  const operationId = randomUUID();
  const target = {
    network: config.online.network,
    gateway: config.online.gateway,
    device: config.online.device,
  };
  const requestDirectory = await mkdtemp(resolve(tmpdir(), "codesys-controller-"));
  const diagnostics = resolve(config.outDir, ".codesys/controller");
  try {
    await mkdir(config.outDir, { recursive: true });
    await writeFile(
      resolve(requestDirectory, "config.json"),
      JSON.stringify({
        ...config,
        libraries:
          operation === "inspect" ? [] : await mountLibraries(config.libraries, requestDirectory),
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
    await runDocker(
      [
        "run",
        "--rm",
        "--init",
        ...(config.docker.cpuSet ? ["--cpuset-cpus", config.docker.cpuSet] : []),
        "--network",
        target.network,
        ...(process.getuid && process.getgid
          ? ["--user", `${process.getuid()}:${process.getgid()}`]
          : []),
        ...environmentNames.flatMap((name) => ["--env", name]),
        "--mount",
        bindMount(requestDirectory, "/input", true),
        ...(operation === "inspect"
          ? []
          : ["--mount", bindMount(config.sourceDir, "/sources", true)]),
        "--mount",
        bindMount(config.template, "/template.project", true),
        "--mount",
        bindMount(config.outDir, "/output"),
        imageId,
        operation,
        "--request",
        "/input/config.json",
        "--operation-id",
        operationId,
        "--image-id",
        imageId,
        ...(options.initializeUser ? ["--initialize-user"] : []),
        ...(options.read ? ["--read", JSON.stringify(options.read)] : []),
      ],
      diagnostics,
    );
    const result = await readFile(resolve(diagnostics, "result.json"), "utf8")
      .then((content) => controllerResultSchema.parse(JSON.parse(content)))
      .catch((cause: unknown) => {
        throw new Error(
          `Docker did not produce a valid controller receipt. Inspect ${diagnostics} for diagnostics`,
          { cause },
        );
      });
    if (
      result.operationId !== operationId ||
      result.operation !== operation ||
      result.imageId !== imageId ||
      result.templateHash !== templateHash ||
      JSON.stringify(result.target) !== JSON.stringify(target)
    ) {
      throw new Error(
        `Controller receipt does not match this operation's image, template or target. Inspect ${diagnostics} for diagnostics`,
      );
    }
    return result;
  } finally {
    await rm(requestDirectory, { recursive: true, force: true });
  }
};

/** Download or apply an online change using the original CODESYS Docker compiler. */
export const updateController = (
  config: ResolvedConfig,
  operation: "download" | "online-change",
  options: ControllerUpdateOptions = {},
) => controllerOperation(config, operation, options);

/** Read the controller using the runner's saved compilation baseline. */
export const inspectController = (config: ResolvedConfig, read?: string[]) =>
  controllerOperation(config, "inspect", { read });
