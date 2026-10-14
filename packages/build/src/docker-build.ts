import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { readBuild } from "./artifacts";
import { dockerImage, type ResolvedConfig } from "./config";
import { prepareDockerContext } from "./docker-context.ts";
import { buildFailureFile, buildFailureSchema, CodesysCompilerError } from "./diagnostics.ts";
import { prepareContainerRun, runDocker } from "./docker-run.ts";

const execute = promisify(execFile);

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
        `Docker configuration failed (${status}). Review the image-build output and run tsplc configure again`,
    );
    return image;
  } finally {
    await Promise.all([
      rm(context, { recursive: true, force: true }),
      ...(buildContext ? [rm(buildContext, { recursive: true, force: true })] : []),
    ]);
  }
};

export const buildInDocker = async (config: ResolvedConfig, image: string) => {
  const requestDirectory = await mkdtemp(resolve(tmpdir(), "codesys-docker-"));
  try {
    const operationId = randomUUID();
    await mkdir(config.outDir, { recursive: true });
    const failurePath = resolve(config.outDir, buildFailureFile);
    await rm(failurePath, { force: true });
    const args = [
      ...(await prepareContainerRun(config, requestDirectory, { network: "none", sources: true })),
      image,
      "--request",
      "/input/config.json",
      "--operation-id",
      operationId,
    ];
    console.log(`Building with Docker (${image})`);
    try {
      await runDocker(
        args,
        (status) =>
          `Docker build failed (${status}). Run tsplc configure if the image is missing; inspect ${config.outDir}/.codesys/docker for compiler logs`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const failure = await readFile(failurePath, "utf8")
        .then((text) => buildFailureSchema.parse(JSON.parse(text)))
        .catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
          throw new AggregateError(
            [cause, error],
            `${message}. Invalid CODESYS failure metadata (${failurePath})`,
            { cause: error },
          );
        });
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
