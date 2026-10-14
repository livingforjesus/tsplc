import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const clis = [
  ["unified", resolve(import.meta.dir, "../packages/compiler/project/cli.ts")],
  ["standalone", resolve(import.meta.dir, "../packages/build/src/cli.ts")],
] as const;
const scenarios = [
  "default-config",
  "explicit-config",
  "configless",
  "missing-config",
  "invalid-config",
  "invalid-default",
] as const;

for (const [name, cli] of clis)
  test.each([...scenarios])(
    `${name} configure selects the shared image for %s`,
    async (scenario) => {
      const root = await mkdtemp(join(tmpdir(), "vplc-configure-cli-"));
      try {
        await mkdir(join(root, "bin"));
        const record = join(root, "docker.json");
        await writeFile(
          join(root, "bin/docker"),
          `#!${process.execPath}
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args[0] === "info") console.log("linux/amd64");
else await writeFile(process.env.VPLC_TEST_DOCKER_RECORD, JSON.stringify(args));
`,
          { mode: 0o755 },
        );
        const configuredImage = `builder:${scenario}`;
        const config = (image: string) =>
          `export default ${JSON.stringify({
            backend: "codesys",
            build: { template: "missing.project", docker: { image } },
            devices: { unavailable: { file: "missing.eds" } },
            dependencies: { Unavailable: { path: "missing.library" } },
          })};`;
        const args = [cli, "configure"];
        if (scenario !== "configless")
          await writeFile(
            join(root, "vplc.config.ts"),
            scenario === "invalid-default"
              ? 'export default { backend: "unsupported" };'
              : config(configuredImage),
          );
        if (["explicit-config", "missing-config", "invalid-config"].includes(scenario)) {
          await mkdir(join(root, "selected"));
          args.push("--config", "selected/vplc.config.ts");
          if (scenario !== "missing-config")
            await writeFile(
              join(root, "selected/vplc.config.ts"),
              scenario === "invalid-config"
                ? 'export default { backend: "unsupported" };'
                : config("builder:selected"),
            );
        }
        const child = Bun.spawn([process.execPath, ...args], {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${join(root, "bin")}:${process.env["PATH"]}`,
            VPLC_TEST_DOCKER_RECORD: record,
            CODESYS_WINETRICKS_CACHE: undefined,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        const invalid = ["missing-config", "invalid-config", "invalid-default"].includes(scenario);
        expect(code, stderr || stdout).toBe(invalid ? 1 : 0);
        if (invalid) expect(existsSync(record)).toBe(false);
        else {
          const dockerArgs: string[] = JSON.parse(await readFile(record, "utf8"));
          const expected =
            scenario === "configless"
              ? "vplc-build:3.5.22.30"
              : scenario === "explicit-config"
                ? "builder:selected"
                : configuredImage;
          expect(dockerArgs[dockerArgs.indexOf("-t") + 1]).toBe(expected);
        }
        expect(existsSync(join(root, ".vplc"))).toBe(false);
        expect(existsSync(join(root, "vplc.lock.json"))).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
