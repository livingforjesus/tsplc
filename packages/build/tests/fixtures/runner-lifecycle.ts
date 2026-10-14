import { mock } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodesysCompilerError } from "../../src/diagnostics.ts";

// Run the real container runner in a separate process. Vendor compilation and
// worker stop are replaced; publication, failure transport and exit handling use production code.
const root = process.argv[2];
const scenario = process.argv[3];
const operationId = process.argv[4];
if (!root) throw new Error("Missing fixture directory");
if (!operationId) throw new Error("Missing fixture operation ID");

mock.module("../../src/build.ts", () => ({
  buildInContainer: async () => {
    if (scenario === "both-fail")
      throw new CodesysCompilerError("Original compiler failure", [
        {
          category: "compiler",
          text: "Unknown fixture identifier",
          severity: "Error",
          project: "Application.project",
          object: {
            name: "Main",
            guid: "fixture-guid",
            path: ["Application", "controls", "Main"],
            applicationPath: ["controls", "Main"],
            isApplicationChild: false,
          },
          position: "18446744073709551615",
          positionText: "Line 2, Column 3 (Impl)",
          positionOffset: 0,
          length: 3,
          prefix: "C",
          number: 46,
        },
      ]);
    const directory = resolve(root, "compiled");
    await mkdir(resolve(directory, "runtime"), { recursive: true });
    for (const file of [
      "Application.project",
      "runtime/Application.app",
      "runtime/Application.crc",
    ])
      await writeFile(resolve(directory, file), "compiled fixture");
    return {
      mode: "build",
      application: "Application",
      directory,
      project: resolve(directory, "Application.project"),
      output: resolve(directory, "runtime/Application.app"),
      checksum: resolve(directory, "runtime/Application.crc"),
    };
  },
}));
const workers = { ...(await import("../../src/host/codesys-worker.ts")) };
mock.module("../../src/host/codesys-worker.ts", () => ({
  ...workers,
  createCodesysWorker: () => ({
    stop: async () => {
      if (scenario !== "success") throw new Error("Worker shutdown failed");
    },
  }),
}));
const job = resolve(root, "job.json");
await writeFile(job, JSON.stringify({ template: "fixture.project", outDir: root }));
process.argv = [
  process.execPath,
  "runner.ts",
  "--job",
  job,
  "build",
  "--operation-id",
  operationId,
];
await import("../../docker/runner.ts");
