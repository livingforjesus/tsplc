import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CodesysCompilerError, describeBuildFailure } from "./diagnostics.ts";

const execute = promisify(execFile);
const diagnostic = {
  category: "compiler",
  text: "Unknown identifier motor",
  severity: "Error",
  project: "Application.project",
  object: {
    name: "Main",
    guid: "vendor-guid",
    path: ["Device", "Application", "controls", "Main"],
    applicationPath: ["controls", "Main"],
    isApplicationChild: false,
  },
  position: "18446744073709551615",
  positionText: "Line 2, Column 3 (Impl)",
  positionOffset: 0,
  length: 5,
  prefix: "C",
  number: 46,
};

test("Docker failure metadata preserves the compiler diagnostics and shutdown context", () => {
  const compiler = new CodesysCompilerError("Compiler failed", [diagnostic]);
  const primary = new Error("Inspect progress.log and error.txt", { cause: compiler });
  const shutdown = new Error("Worker stop timed out; see codesys.log");
  const failure = describeBuildFailure(
    new AggregateError([primary, shutdown], "Operation and worker shutdown failed", {
      cause: primary,
    }),
  );
  expect(failure.diagnostics).toEqual([diagnostic]);
  expect(failure.message).toContain("Inspect progress.log and error.txt");
  expect(failure.message).toContain("Worker stop timed out; see codesys.log");
});

test.each(["compiler", "shutdown", "missing", "invalid", "foreign"] as const)(
  "a public Docker build retains %s failure evidence without accepting stale metadata",
  async (mode) => {
    const root = await mkdtemp(resolve(tmpdir(), "tsplc-docker-diagnostics-"));
    try {
      await mkdir(resolve(root, "bin"));
      await mkdir(resolve(root, "output/.codesys/docker"), { recursive: true });
      await mkdir(resolve(root, "src"));
      await writeFile(resolve(root, "template.project"), "Fixture project, never opened");
      await writeFile(resolve(root, "src/Main.st"), "PROGRAM Main\nEND_PROGRAM");
      await writeFile(
        resolve(root, "output/.codesys/docker/failure.json"),
        JSON.stringify({ message: "Stale failure", diagnostics: [diagnostic] }),
      );
      const record = resolve(root, "docker-record.json");
      await writeFile(
        resolve(root, "bin/docker"),
        `#!${process.execPath}
import { existsSync, writeFileSync } from "node:fs";
const mount = process.argv.find(value => value.endsWith("target=/output"));
const output = mount.slice('type=bind,"source='.length, -'",target=/output'.length);
const path = output + "/.codesys/docker/failure.json";
const operationId = process.argv[process.argv.indexOf("--operation-id") + 1];
writeFileSync(process.env.TSPLC_TEST_RECORD, JSON.stringify({ stale: existsSync(path) }));
if (["compiler", "foreign"].includes(process.env.TSPLC_TEST_MODE)) {
  writeFileSync(path, JSON.stringify({
    operationId: process.env.TSPLC_TEST_MODE === "foreign" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : operationId,
    ...${JSON.stringify({ message: "Vendor compile failed; worker shutdown timed out; see codesys.log", diagnostics: [diagnostic] })},
  }));
} else if (process.env.TSPLC_TEST_MODE === "invalid") {
  writeFileSync(path, JSON.stringify({ operationId, message: "Unvalidated payload", diagnostics: "invalid" }));
} else if (process.env.TSPLC_TEST_MODE === "shutdown") {
  writeFileSync(path, JSON.stringify({ operationId, message: "Worker shutdown timed out; see codesys.log", diagnostics: [] }));
}
process.exit(5);
`,
        { mode: 0o755 },
      );
      const modulePath = (path: string) =>
        JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
      const probe = resolve(root, "probe.ts");
      await writeFile(
        probe,
        `
import { buildProject } from ${modulePath("./build.ts")};
import { resolveConfig } from ${modulePath("./config.ts")};
import { CodesysCompilerError } from ${modulePath("./diagnostics.ts")};
import { diagnoseCodesys } from ${modulePath("../../compiler/backends/codesys/vendor.ts")};
const config = resolveConfig({ template: "template.project", sourceDir: "src", entry: "Main.st", outDir: "output" }, ${JSON.stringify(resolve(root, "tsplc.config.ts"))});
let failure;
try { await buildProject(config); }
catch (error) { failure = error; }
const span = { file: "src/control.ts", start: 10, end: 20, line: 4, column: 3 };
const diagnostics = diagnoseCodesys(failure, {
  objects: [{ id: "main", name: "Main", kind: "program", sourcePath: "controls/Main/declaration.st", declaration: "PROGRAM Main", implementation: "motor();" }],
  mappings: [{ path: "controls/Main/implementation.st", line: 2, span }],
});
console.log(JSON.stringify({
  failed: failure instanceof Error,
  message: failure?.message,
  typedCause: failure?.cause instanceof CodesysCompilerError,
  diagnostics,
}));
`,
      );
      const { stdout, stderr } = await execute(process.execPath, [probe], {
        cwd: root,
        timeout: 8000,
        env: {
          ...process.env,
          PATH: `${resolve(root, "bin")}:${process.env["PATH"]}`,
          TSPLC_TEST_RECORD: record,
          TSPLC_TEST_MODE: mode,
        },
      });
      const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
      expect(result.failed).toBe(true);
      expect(result.message, stderr).toContain("Docker build failed (5)");
      if (mode === "compiler") {
        expect(result.typedCause).toBe(true);
        expect(result.diagnostics[0].span).toEqual({
          file: "src/control.ts",
          start: 10,
          end: 20,
          line: 4,
          column: 3,
        });
        expect(result.diagnostics[0].message).toBe(diagnostic.text);
        expect(result.diagnostics[0].notes).toContain(
          "Generated ST: controls/Main/implementation.st:2:3",
        );
        expect(result.diagnostics[0].notes.at(-1)).toContain(diagnostic.position);
        expect(result.diagnostics[0].notes[0]).toContain("worker shutdown timed out");
      } else {
        expect(result.typedCause).toBe(false);
        expect(result.diagnostics[0].span).toBeUndefined();
        if (mode === "invalid")
          expect(result.message).toContain("Invalid CODESYS failure metadata");
        if (mode === "foreign")
          expect(result.message).toContain("belongs to a different Docker build");
        if (mode === "shutdown")
          expect(result.diagnostics[0].message).toContain(
            "Worker shutdown timed out; see codesys.log",
          );
      }
      expect(JSON.parse(await readFile(record, "utf8"))).toEqual({ stale: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  10000,
);
