import { createHash, randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ResolvedConfig } from "./config";
import { controllerResultSchema } from "./controller-online";
import { createCodesysWorker, withWorkerLock, withWorkerShutdown } from "./host/codesys-worker";
import { toWindowsPath } from "./host/windows-path";
import { loadSources } from "./sources";

// Vendor code/data IDs are .NET Guid values derived from the compiler's data;
// they do not carry RFC UUID version/variant bits.
const guid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pointerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generation: z.uuid(),
});
const baselineSchema = controllerResultSchema.extend({
  objects: z.array(z.record(z.string(), z.unknown())),
  files: z.record(z.string(), hash),
});
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const guidBytes = (value: string): Buffer => {
  const bytes = Buffer.from(value.replaceAll("-", ""), "hex");
  bytes.subarray(0, 4).reverse();
  bytes.subarray(4, 6).reverse();
  bytes.subarray(6, 8).reverse();
  return bytes;
};

/** Hash the complete project directory, including the vendor's downloaded reference. */
const projectFiles = async (directory: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  const visit = async (folder: string, prefix: string) => {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isSymbolicLink()) {
        throw new Error(`Online project state contains a symlink: ${name}`);
      }
      if (item.isDirectory()) {
        await visit(resolve(folder, item.name), `${name}/`);
      } else if (item.isFile()) {
        files[name] = sha256(await readFile(resolve(folder, item.name)));
      }
    }
  };
  await visit(directory, "");
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
};

const publishJson = async (path: string, value: unknown) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
};

/** Called inside the builder container while its output-directory flock is held. */
export const runControllerSession = async (
  config: ResolvedConfig,
  operation: "download" | "online-change" | "inspect",
  options: {
    imageId: string;
    operationId: string;
    initializeUser?: boolean;
    read?: string[];
  },
) => {
  if (!config.online) {
    throw new Error("Controller operations require online settings");
  }
  const root = resolve(config.outDir, ".codesys/controller");
  await mkdir(root, { recursive: true });
  const resultPath = resolve(root, "result.json");
  await rm(resultPath, { force: true });
  const templateHash = sha256(await readFile(config.template));
  const { network, gateway, device } = config.online;
  const target = { network, gateway, device };
  let baseline: z.infer<typeof baselineSchema> | undefined;
  let previousProject: string | undefined;
  if (operation !== "download") {
    const pointer = pointerSchema.parse(
      JSON.parse(await readFile(resolve(root, "current.json"), "utf8")),
    );
    const previous = resolve(root, "generations", pointer.generation);
    baseline = baselineSchema.parse(
      JSON.parse(await readFile(resolve(previous, "manifest.json"), "utf8")),
    );
    if (
      baseline.generation !== pointer.generation ||
      baseline.imageId !== options.imageId ||
      baseline.templateHash !== templateHash ||
      JSON.stringify(baseline.target) !== JSON.stringify(target)
    ) {
      throw new Error(
        "Downloaded baseline uses a different image, template or controller; use an explicit download",
      );
    }
    previousProject = resolve(previous, "project");
    if (JSON.stringify(await projectFiles(previousProject)) !== JSON.stringify(baseline.files)) {
      throw new Error("Saved online project/reference files changed; use an explicit download");
    }
  }
  if (options.initializeUser && operation !== "download") {
    throw new Error("Initial user creation requires an explicit download");
  }
  const generation = randomUUID();
  const candidate = resolve(root, "generations", generation);
  const project = resolve(candidate, "project", "Application.project");
  await mkdir(resolve(candidate, "project"), { recursive: true });
  if (previousProject) {
    await cp(previousProject, resolve(candidate, "project"), {
      recursive: true,
    });
  } else {
    await copyFile(config.template, project);
  }
  const jobConfig = {
    ...config,
    outDir: resolve(root, "jobs", options.operationId),
  };
  const requestDirectory = resolve(jobConfig.outDir, ".codesys/controller");
  await mkdir(requestDirectory, { recursive: true });
  const sources = operation === "inspect" ? undefined : await loadSources(config);
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
    operation,
    initializeUser: options.initializeUser ?? false,
    online: config.online,
    project: await toWindowsPath(project, config.codesys.wine),
    progress: await toWindowsPath(resolve(requestDirectory, "progress.log"), config.codesys.wine),
    baseline,
    read: options.read ?? [],
  };
  await writeFile(resolve(requestDirectory, "request.json"), JSON.stringify(request, null, 2));
  const worker = createCodesysWorker(jobConfig);
  return withWorkerShutdown(jobConfig, worker, async () => {
    const result = await withWorkerLock(jobConfig, async () => {
      const session = await worker.launch();
      await worker.request(session, { action: "online" }, config.timeouts.build);
      return z
        .object({
          applicationGuid: guid,
          application: z.string().optional(),
          controllerIds: z.strictObject({ codeId: guid, dataId: guid }),
          state: z.string(),
          values: z.record(z.string(), z.string()),
        })
        .parse(JSON.parse(await readFile(resolve(requestDirectory, "result.json"), "utf8")));
    });
    const receipt = controllerResultSchema.parse({
      ...result,
      application: result.application ?? baseline?.application,
      schemaVersion: 1,
      operationId: options.operationId,
      operation,
      imageId: options.imageId,
      templateHash,
      target,
      generation: operation === "inspect" ? baseline?.generation : generation,
    });
    if (operation !== "inspect") {
      const files = await projectFiles(resolve(candidate, "project"));
      if (!Object.keys(files).some((name) => name.endsWith(".compileinfo"))) {
        throw new Error(
          "CODESYS acknowledged the operation but no downloaded compiler reference was saved; candidate is retained for recovery",
        );
      }
      const bootIds = Object.keys(files).filter((name) =>
        name.endsWith(`.${receipt.applicationGuid}.bootinfo_guids`),
      );
      const expectedBootIds = Buffer.concat([
        guidBytes(receipt.controllerIds.codeId),
        guidBytes(receipt.controllerIds.dataId),
      ]);
      const bootReference = bootIds[0]?.replace(/_guids$/, "") ?? "";
      const downloadedReference = bootReference.replace(/\.bootinfo$/, ".compileinfo");
      if (
        bootIds.length !== 1 ||
        !files[bootReference] ||
        files[bootReference] === sha256(new Uint8Array()) ||
        files[bootReference] !== files[downloadedReference] ||
        !(await readFile(resolve(candidate, "project", bootIds[0] ?? ""))).equals(expectedBootIds)
      ) {
        throw new Error(
          "CODESYS acknowledged the operation but matching boot reference was not saved; candidate is retained for recovery",
        );
      }
      await publishJson(resolve(candidate, "manifest.json"), {
        ...receipt,
        objects: sources?.objects,
        files,
      });
      // Each generation is immutable. A single atomic pointer commits it only
      // after controller acknowledgement and matching downloaded/boot references.
      await publishJson(resolve(root, "current.json"), {
        schemaVersion: 1,
        generation,
      });
    }
    await publishJson(resultPath, receipt);
    return receipt;
  }).finally(async () => {
    if (operation === "inspect") {
      await rm(candidate, { recursive: true, force: true });
    }
  });
};
