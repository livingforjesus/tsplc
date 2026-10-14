import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "cli.ts");
async function fixture(check: (root: string, config: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "tsplc-build-cli-")),
    config = join(root, "tsplc.config.ts");
  try {
    await check(root, config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function execute(args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test("standalone inspection does not resolve descriptors, dependencies or sources", async () => {
  await fixture(async (root, config) => {
    await writeFile(
      config,
      `export default {
      backend: "codesys", build: { template: "missing.project", sourceDir: "unavailable" },
      devices: { unavailable: { file: "missing.eds" } },
      dependencies: { Unavailable: { path: "missing.library" } }
    };`,
    );
    const result = await execute([cli, "inspect", "--config", config]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("online gateway/device configuration");
    expect(existsSync(join(root, ".tsplc"))).toBe(false);
    expect(existsSync(join(root, "tsplc.lock.json"))).toBe(false);
  });
});

test("standalone CLI rejects invalid commands before executing config or installing libraries", async () => {
  await fixture(async (root, config) => {
    await writeFile(config, 'throw new Error("Config was executed."); export default {};');
    const result = await execute([cli, "unknown-command", "--config", config]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command unknown-command.");
    expect(result.stderr).not.toContain("Config was executed.");
    expect(existsSync(join(root, ".tsplc"))).toBe(false);
  });
});

test("standalone source checking does not install libraries", async () => {
  await fixture(async (root, config) => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/Main.st"), "PROGRAM Main\nRETURN;\nEND_PROGRAM");
    await writeFile(
      config,
      `export default {
      backend: "codesys", build: { sourceDir: "src", entry: "src/Main.st", template: "missing.project" },
      dependencies: { Unavailable: { path: "missing.library" } }
    };`,
    );
    const result = await execute([cli, "check", "--config", config]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated 1 Structured Text objects.");
    expect(existsSync(join(root, ".tsplc"))).toBe(false);
    expect(existsSync(join(root, "tsplc.lock.json"))).toBe(false);
  });
});

test.each([false, true])(
  "standalone run builds current sources and stops on build failure=%s",
  async (fail) => {
    await fixture(async (root, config) => {
      await writeFile(
        config,
        'export default { backend: "codesys", build: { sourceDir: "src", template: "Template.project" } };',
      );
      const script = join(root, "probe.ts"),
        calls = join(root, "calls.jsonl");
      await writeFile(
        script,
        `import { mock } from "bun:test";
import { appendFileSync } from "node:fs";
const record = name => appendFileSync(${JSON.stringify(calls)}, name + "\\n");
mock.module(${JSON.stringify(resolve(import.meta.dir, "build.ts"))}, () => ({ buildProject: async () => {
  record("build"); if (${fail}) throw new Error("Fresh build failed.");
} }));
mock.module(${JSON.stringify(resolve(import.meta.dir, "run.ts"))}, () => ({ runProject: async () => record("run") }));
process.argv = [process.execPath, ${JSON.stringify(cli)}, "run", "--config", ${JSON.stringify(config)}];
await import(${JSON.stringify(cli)});`,
      );
      const result = await execute([script]);
      expect(result.code, result.stderr).toBe(fail ? 1 : 0);
      expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual(
        fail ? ["build"] : ["build", "run"],
      );
      if (fail) expect(result.stderr).toContain("Fresh build failed.");
    });
  },
);
