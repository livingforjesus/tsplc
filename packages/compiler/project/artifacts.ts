import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { buildCodesys } from "@tsplc/compiler/codesys";

const missing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";
const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

// Ownership is an explicit boundary: generated files must match their manifest,
// and engineering trees must belong to this configuration before vendor writes.
interface Manifest {
  kind: "tsplc-artifacts";
  version: 1;
  configFile: string;
  files: { path: string; sha256: string }[];
}

function manifest(value: unknown, configFile: string): Manifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "tsplc-artifacts" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("configFile" in value) ||
    value.configFile !== configFile ||
    !("files" in value) ||
    !Array.isArray(value.files)
  ) {
    throw new Error("Output directory has no matching tsPLC ownership manifest.");
  }

  const files = value.files.map((item: unknown) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("path" in item) ||
      typeof item.path !== "string" ||
      !/^[A-Za-z0-9_ .-]+(?:\/[A-Za-z0-9_ .-]+)*$/.test(item.path) ||
      item.path.split("/").some((part) => part === "." || part === "..") ||
      ["manifest.json", "receipt.json"].includes(item.path) ||
      !("sha256" in item) ||
      typeof item.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(item.sha256)
    ) {
      throw new Error("Invalid generated file ownership entry.");
    }
    return { path: item.path, sha256: item.sha256 };
  });
  if (new Set(files.map((item) => item.path)).size !== files.length) {
    throw new Error("Duplicate generated file ownership entry.");
  }
  return { kind: "tsplc-artifacts", version: 1, configFile, files };
}

async function directory(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Generated directory must be a real directory: ${path}`);
    }
    return true;
  } catch (cause) {
    if (missing(cause)) {
      return false;
    }
    throw cause;
  }
}

async function filesIn(path: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      result.push(...(await filesIn(join(path, entry.name), `${name}/`)));
    } else {
      result.push(name);
    }
  }
  return result;
}

export async function engineeringDirectory(path: string, configFile: string): Promise<void> {
  const marker = join(path, "ownership.json");
  const exists = await directory(path);
  if (!exists || !(await readdir(path)).length) {
    await mkdir(path, { recursive: true });
    await writeFile(
      marker,
      `${JSON.stringify({ kind: "tsplc-engineering", version: 1, configFile }, null, 2)}\n`,
      { flag: "wx" },
    );
  } else {
    const entry = await lstat(marker).catch((cause: unknown) => {
      if (missing(cause)) {
        throw new Error(`Engineering cache has no matching tsPLC ownership marker: ${path}`);
      }
      throw cause;
    });
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("Engineering ownership marker must be a real file.");
    }
    const value = JSON.parse(await readFile(marker, "utf8"));
    if (
      value?.kind !== "tsplc-engineering" ||
      value.version !== 1 ||
      value.configFile !== configFile
    ) {
      throw new Error(`Engineering cache has no matching tsPLC ownership marker: ${path}`);
    }
  }

  const inspect = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Engineering cache must not contain symlinks: ${child}`);
      }
      if (entry.isDirectory()) {
        await inspect(child);
      }
    }
  };
  await inspect(path);
}

export async function owned(
  configFile: string,
  withdrawReceipt = false,
): Promise<{ root: string; output: string; ownership?: Manifest; unknown: string[] }> {
  const root = join(dirname(configFile), ".tsplc");
  const output = join(root, "artifacts");
  if (!(await directory(root)) || !(await directory(output))) {
    return { root, output, unknown: [] };
  }

  const manifestPath = join(output, "manifest.json");
  const manifestEntry = await lstat(manifestPath);
  if (!manifestEntry.isFile() || manifestEntry.isSymbolicLink()) {
    throw new Error("Ownership manifest must be a real file.");
  }
  const ownership = manifest(JSON.parse(await readFile(manifestPath, "utf8")), configFile);
  const receipt = join(output, "receipt.json");
  try {
    const entry = await lstat(receipt);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("Build receipt must be a real file.");
    }
    const value = JSON.parse(await readFile(receipt, "utf8"));
    if (
      value?.kind !== "tsplc-build" ||
      value.version !== 1 ||
      value.configFile !== configFile ||
      !["emitted", "vendor-compiled"].includes(value.status)
    ) {
      throw new Error("Build receipt is not owned by this configuration.");
    }
    if (withdrawReceipt) {
      await rm(receipt);
    }
  } catch (cause) {
    if (!missing(cause)) {
      throw cause;
    }
  }

  const names = new Set([
    ...ownership.files.map((file) => file.path),
    "manifest.json",
    "receipt.json",
  ]);
  for (const file of ownership.files) {
    let parent = output;
    for (const part of file.path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      if (!(await directory(parent))) {
        throw new Error(`Missing generated directory: ${parent}`);
      }
    }
    const path = join(output, file.path);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink() || digest(await readFile(path)) !== file.sha256) {
      throw new Error(
        `Generated file was replaced or edited; preserve it before rebuilding/cleaning: ${path}`,
      );
    }
  }
  return {
    root,
    output,
    ownership,
    unknown: (await filesIn(output)).filter((name) => !names.has(name)),
  };
}

interface Receipt {
  configFile: string;
  status: "emitted" | "vendor-compiled";
  vendor?: Pick<Awaited<ReturnType<typeof buildCodesys>>, "application" | "tasks">;
}

// Compile in a separate staging tree. Recheck ownership immediately before the
// swap, because the vendor build may have given the user time to edit old files.
export async function publishArtifacts(
  staging: string,
  previous: Awaited<ReturnType<typeof owned>>,
  receipt: Receipt,
): Promise<void> {
  const configFile = receipt.configFile;
  const generated = (await filesIn(staging)).sort();
  const ownership: Manifest = { kind: "tsplc-artifacts", version: 1, configFile, files: [] };
  for (const path of generated) {
    ownership.files.push({ path, sha256: digest(await readFile(join(staging, path))) });
  }
  await writeFile(join(staging, "manifest.json"), `${JSON.stringify(ownership, null, 2)}\n`);
  await writeFile(
    join(staging, "receipt.json"),
    `${JSON.stringify(
      { kind: "tsplc-build", version: 1, generatedAt: new Date().toISOString(), ...receipt },
      null,
      2,
    )}\n`,
  );

  const current = await owned(configFile);
  if (JSON.stringify(current.ownership) !== JSON.stringify(previous.ownership)) {
    throw new Error("Output ownership changed during the build; preserve it before rebuilding.");
  }
  if (current.unknown.length) {
    throw new Error(`Output contains unrelated files: ${current.unknown.join(", ")}`);
  }

  const backup = `${staging}-previous`;
  if (previous.ownership) {
    await rename(previous.output, backup);
  }
  try {
    await rename(staging, previous.output);
  } catch (cause) {
    if (previous.ownership) {
      await rename(backup, previous.output);
    }
    throw cause;
  }
  if (previous.ownership) {
    await rm(backup, { recursive: true });
  }
}

export async function cleanArtifacts(configFile: string): Promise<void> {
  const generated = await owned(configFile);
  if (!generated.ownership) {
    return;
  }
  for (const entry of generated.ownership.files) {
    await rm(join(generated.output, entry.path));
  }
  await rm(join(generated.output, "receipt.json"), { force: true });
  await rm(join(generated.output, "manifest.json"));

  // Remove empty generated directories while preserving unrelated files.
  const removeEmpty = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await removeEmpty(join(path, entry.name));
      }
    }
    if (!(await readdir(path)).length) {
      await rm(path, { recursive: true });
    }
  };
  await removeEmpty(generated.output);
}
