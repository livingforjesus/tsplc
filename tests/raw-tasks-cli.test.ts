import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const buildRoot = resolve(import.meta.dir, "../packages/build/src");
const expectedTasks = [
  {
    name: "FastTask",
    intervalNanoseconds: "5000000",
    priority: 2,
    programs: ["ReadInputs", "Main"],
  },
  { name: "SlowTask", intervalNanoseconds: "50000000", priority: 12, programs: ["Publish"] },
];
const clis = [
  ["unified", resolve(import.meta.dir, "../packages/compiler/project/cli.ts")],
  ["standalone", join(buildRoot, "cli.ts")],
] as const;

for (const [name, cli] of clis)
  test.each(["build", "run", "download", "online-change"])(
    `${name} raw %s delivers the shared schedule to engineering`,
    async (command) => {
      const root = await mkdtemp(join(tmpdir(), "vplc-raw-tasks-"));
      try {
        const config = join(root, "vplc.config.ts"),
          calls = join(root, "calls.jsonl"),
          script = join(root, "probe.ts");
        await writeFile(
          config,
          `export default ${JSON.stringify({
            backend: "codesys",
            build: { template: "local.project", runtime: { composeFile: "compose.yaml" } },
            tasks: expectedTasks.map((task) => ({
              name: task.name,
              schedule: {
                kind: "cyclic",
                interval: { kind: "duration", nanoseconds: task.intervalNanoseconds },
              },
              priority: task.priority,
              programs: task.programs,
            })),
          })};`,
        );
        // Stub only the external engineering/runtime operations, after the real
        // CLI has loaded, validated and resolved the shared project settings.
        await writeFile(
          script,
          `import { mock } from "bun:test";
import { appendFileSync } from "node:fs";
const builder = await import(${JSON.stringify(join(buildRoot, "index.ts"))});
const record = (operation, settings) => {
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ operation, tasks: settings.tasks }) + "\\n");
  return { operation };
};
const operations = {
  buildProject: async settings => record("build", settings),
  runProject: async settings => record("run", settings),
  updateController: async (settings, operation) => record(operation, settings),
};
mock.module(${JSON.stringify(join(buildRoot, "index.ts"))}, () => ({ ...builder, ...operations }));
mock.module(${JSON.stringify(join(buildRoot, "build.ts"))}, () => ({ buildProject: operations.buildProject }));
mock.module(${JSON.stringify(join(buildRoot, "run.ts"))}, () => ({ runProject: operations.runProject }));
mock.module(${JSON.stringify(join(buildRoot, "controller-online.ts"))}, () => ({ ...builder, updateController: operations.updateController }));
process.argv = [process.execPath, ${JSON.stringify(cli)}, ${JSON.stringify(command)}, "--config", ${JSON.stringify(config)}];
await import(${JSON.stringify(cli)});`,
        );
        const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(code, stderr || stdout).toBe(0);
        const operations = (await readFile(calls, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(operations.map((operation) => operation.operation)).toEqual(
          command === "run" ? ["build", "run"] : [command],
        );
        expect(
          operations.every(
            (operation) => JSON.stringify(operation.tasks) === JSON.stringify(expectedTasks),
          ),
        ).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    20_000,
  );
