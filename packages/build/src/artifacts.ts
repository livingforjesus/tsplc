import { copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { cyclicTasksSchema } from "./config";

export const buildFiles = {
  project: "Application.project",
  output: "runtime/Application.app",
  checksum: "runtime/Application.crc",
  receipt: "build.json",
} as const;

const receiptSchema = z.object({
  mode: z.literal("build"),
  application: z.string().regex(/^[A-Za-z_][A-Za-z_0-9]*$/),
  tasks: cyclicTasksSchema.optional(),
});

/** A receipt is published last, after every artifact has been checked and replaced. */
export const readBuild = async (directory: string) => {
  const receipt = receiptSchema.safeParse(
    JSON.parse(await readFile(resolve(directory, buildFiles.receipt), "utf8")),
  );
  if (!receipt.success) {
    throw new Error("CODESYS did not produce a valid build receipt", {
      cause: receipt.error,
    });
  }
  for (const file of [buildFiles.project, buildFiles.output, buildFiles.checksum]) {
    const artifact = await stat(resolve(directory, file));
    if (!artifact.isFile() || artifact.size === 0) {
      throw new Error(`CODESYS produced an empty artifact: ${file}`);
    }
  }
  return {
    ...receipt.data,
    directory,
    project: resolve(directory, buildFiles.project),
    output: resolve(directory, buildFiles.output),
    checksum: resolve(directory, buildFiles.checksum),
  };
};

/** Publish a verified IDE build, with the completion receipt written last. */
export const publishBuild = async (
  compiled: Awaited<ReturnType<typeof readBuild>>,
  outDir: string,
) => {
  if (!compiled.project) {
    throw new Error("IDE compiler did not produce a project");
  }
  await copyFile(compiled.project, resolve(outDir, buildFiles.project));
  await rm(resolve(outDir, "runtime"), { recursive: true, force: true });
  await rename(resolve(compiled.directory, "runtime"), resolve(outDir, "runtime"));
  await writeFile(
    resolve(outDir, buildFiles.receipt),
    JSON.stringify(
      {
        mode: "build",
        application: compiled.application,
        ...(compiled.tasks && { tasks: compiled.tasks }),
      },
      null,
      2,
    ),
  );
  return readBuild(outDir);
};
