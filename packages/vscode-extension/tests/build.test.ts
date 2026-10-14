import { afterEach, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), "tsplc-extension-packaging-"));
  temporary.push(root);
  await Promise.all(
    ["scripts", "src/server", "node_modules/source-only-library"].map((path) =>
      mkdir(join(root, path), { recursive: true }),
    ),
  );
  const esbuild = dirname(createRequire(import.meta.url).resolve("esbuild/package.json"));
  await symlink(esbuild, join(root, "node_modules/esbuild"));
  await copyFile(join(import.meta.dir, "../scripts/build.ts"), join(root, "scripts/build.ts"));
  await Promise.all([
    writeFile(join(root, "src/extension.ts"), source),
    writeFile(join(root, "src/server/main.ts"), "console.log('server');"),
    writeFile(
      join(root, "node_modules/source-only-library/package.json"),
      JSON.stringify({
        name: "source-only-library",
        version: "1.0.0",
        exports: { bun: "./source.ts", default: "./missing-dist.js" },
      }),
    ),
    writeFile(
      join(root, "node_modules/source-only-library/source.ts"),
      "export const authoredSource = 'AUTHORED_WORKSPACE_EXPORT';",
    ),
    writeFile(join(root, "node_modules/source-only-library/LICENSE"), "Fixture license"),
  ]);
  return root;
}

function build(root: string) {
  return new Promise<{ exitCode: number | null; stderr: string; timedOut: boolean }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/build.ts"], {
        cwd: root,
        stdio: ["ignore", "ignore", "pipe"],
        detached: process.platform !== "win32",
      });
      let stderr = "";
      let timedOut = false;
      child.stderr.on("data", (data) => (stderr += data.toString()));
      const timeout = setTimeout(() => {
        timedOut = true;
        // Stop this test's entire process group if a broken compiler leaves a child running.
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      }, 5000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        resolve({ exitCode, stderr, timedOut });
      });
    },
  );
}

it("bundles authored source exports and collects licenses from the CLI metafile", async () => {
  const root = await fixture(
    "import { authoredSource } from 'source-only-library'; console.log(authoredSource);",
  );
  const result = await build(root);
  expect(result).toEqual({ exitCode: 0, stderr: "", timedOut: false });
  expect(await readFile(join(root, "dist/extension.cjs"), "utf8")).toContain(
    "AUTHORED_WORKSPACE_EXPORT",
  );
  expect(await readFile(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain(
    "## source-only-library\n\nFixture license",
  );
});

it("exits with a compiler error without publishing notices when bundling fails", async () => {
  const root = await fixture(
    "import { missingExport } from 'source-only-library'; console.log(missingExport);",
  );
  const result = await build(root);
  expect(result.timedOut).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("No matching export");
  expect(result.stderr).toContain("missingExport");
  expect(result.stderr).toContain("Failed to bundle extension");
  expect(await Bun.file(join(root, "THIRD_PARTY_NOTICES.md")).exists()).toBe(false);
});
