import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { readBuild } from "./artifacts";
import { dockerImage, type ResolvedConfig } from "./config";
import { prepareDockerContext } from "./docker-context.ts";
import { buildFailureFile, buildFailureSchema, CodesysCompilerError } from "./diagnostics.ts";
import { mountLibraries } from "./mount-libraries.ts";

const execute = promisify(execFile);

const runDocker = (args: string[], failure: (status: string | number | null) => string) =>
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
        reject(new Error(failure(signal ?? code)));
      }
    });
  });

/** Install the IDE and its prerequisites in the Docker builder image. */
export const configureDocker = async (image = dockerImage) => {
  const { stdout } = await execute(
    "docker",
    ["info", "--format", "{{.OSType}}/{{.Architecture}}"],
    { timeout: 30_000 },
  ).catch((cause: unknown) => {
    throw new Error("Cannot connect to Docker. Install and start Docker Desktop or Docker Engine", {
      cause,
    });
  });
  const architecture = stdout.trim();
  const arm = architecture === "linux/aarch64" || architecture === "linux/arm64";
  if (!arm && architecture !== "linux/x86_64" && architecture !== "linux/amd64") {
    throw new Error("The builder requires a Linux Docker server on ARM64 or AMD64");
  }
  const context = await mkdtemp(resolve(tmpdir(), "codesys-installer-"));
  let buildContext: string | undefined;
  try {
    buildContext = await prepareDockerContext();
    const cache = resolve(context, "winetricks");
    await mkdir(cache);
    if (process.env["CODESYS_WINETRICKS_CACHE"]) {
      await cp(process.env["CODESYS_WINETRICKS_CACHE"], cache, {
        recursive: true,
      });
    }
    console.log(
      `Preparing Docker builder (${image}). Downloading and installing CODESYS 3.5.22.30 and prerequisites.`,
    );
    await runDocker(
      [
        "build",
        "--platform",
        "linux/amd64",
        "--build-arg",
        `SETUP_BASE=${arm ? "arm-setup" : "base"}`,
        "--build-arg",
        `SETUP_PLATFORM=${arm ? "linux/arm64" : "linux/amd64"}`,
        "--build-arg",
        "INSTALLER_SOURCE=installer-download",
        "--progress",
        "plain",
        "--build-context",
        `installer=${context}`,
        "-f",
        resolve(buildContext, "docker/Dockerfile"),
        "-t",
        image,
        buildContext,
      ],
      (status) =>
        `Docker configuration failed (${status}). Review the image-build output and run vplc configure again`,
    );
    return image;
  } finally {
    await Promise.all([
      rm(context, { recursive: true, force: true }),
      ...(buildContext ? [rm(buildContext, { recursive: true, force: true })] : []),
    ]);
  }
};

const bindMount = (source: string, target: string, readonly = false) =>
  `type=bind,"source=${source.replaceAll('"', '""')}",target=${target}${readonly ? ",readonly" : ""}`;

export const buildInDocker = async (config: ResolvedConfig) => {
  if (!config.docker) {
    throw new Error("Docker image is required for a container build");
  }
  const requestDirectory = await mkdtemp(resolve(tmpdir(), "codesys-docker-"));
  try {
    const operationId = randomUUID();
    await mkdir(config.outDir, { recursive: true });
    const failurePath = resolve(config.outDir, buildFailureFile);
    await rm(failurePath, { force: true });
    await writeFile(
      resolve(requestDirectory, "config.json"),
      JSON.stringify({
        ...config,
        libraries: await mountLibraries(config.libraries, requestDirectory),
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
    const args = [
      "run",
      "--rm",
      "--init",
      ...(config.docker.cpuSet ? ["--cpuset-cpus", config.docker.cpuSet] : []),
      "--network",
      "none",
      ...(process.getuid && process.getgid
        ? ["--user", `${process.getuid()}:${process.getgid()}`]
        : []),
      "--mount",
      bindMount(requestDirectory, "/input", true),
      "--mount",
      bindMount(config.sourceDir, "/sources", true),
      "--mount",
      bindMount(config.template, "/template.project", true),
      "--mount",
      bindMount(config.outDir, "/output"),
      config.docker.image,
      "--request",
      "/input/config.json",
      "--operation-id",
      operationId,
    ];
    console.log(`Building with Docker (${config.docker.image})`);
    try {
      await runDocker(
        args,
        (status) =>
          `Docker build failed (${status}). Run vplc configure if the image is missing; inspect ${config.outDir}/.codesys/docker for compiler logs`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      let failure: ReturnType<typeof buildFailureSchema.parse> | undefined;
      try {
        const text = await readFile(failurePath, "utf8").catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
          throw error;
        });
        if (text !== undefined) failure = buildFailureSchema.parse(JSON.parse(text));
      } catch (metadataError) {
        throw new AggregateError(
          [cause, metadataError],
          `${message}. Invalid CODESYS failure metadata (${failurePath})`,
          { cause: metadataError },
        );
      }
      if (!failure) throw cause;
      if (failure.operationId !== operationId)
        throw new Error(
          `${message}. CODESYS failure metadata belongs to a different Docker build`,
          {
            cause,
          },
        );
      if (cause instanceof Error) {
        // The mapper keeps ordinary error messages as notes, while vendor
        // diagnostics supply their own text. Preserve shutdown context there.
        cause.message = `${message}\n${failure.message}`;
        if (failure.diagnostics.length)
          cause.cause = new CodesysCompilerError(failure.message, failure.diagnostics);
      }
      throw cause;
    }
    return await readBuild(config.outDir);
  } finally {
    await rm(requestDirectory, { recursive: true, force: true });
  }
};
