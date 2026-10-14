import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";

await import("./build");
await build({
  entryPoints: ["tests/host/index.ts"],
  outfile: "dist/host-tests.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
});
const installed =
  process.env.VSCODE_EXECUTABLE_PATH ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const available = await access(installed).then(
  () => true,
  () => false,
);
for (const language of ["st", "codesys-st"]) {
  const temp = await mkdtemp(join(tmpdir(), "codesys-st-host-"));
  const resultPath = join(temp, "result.json");
  await cp(
    "tests/fixtures/legacy-st-extension",
    join(temp, "extensions/codesys-st-tests.legacy-st-language-0.0.1"),
    { recursive: true },
  );
  await cp("tests/fixtures/conveyor", join(temp, "workspace/apps/plc/src"), {
    recursive: true,
  });
  await writeFile(join(temp, "workspace/apps/plc/codesys-build.config.ts"), "");
  await cp("tests/fixtures/blueprint", join(temp, "workspace/apps/line/src"), {
    recursive: true,
  });
  await writeFile(join(temp, "workspace/apps/line/codesys-build.config.ts"), "");
  await mkdir(join(temp, "profile", "User"), { recursive: true });
  await writeFile(
    join(temp, "profile", "User", "settings.json"),
    JSON.stringify({
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      "files.associations": { "*.st": language },
    }),
  );
  try {
    await runTests({
      ...(available ? { vscodeExecutablePath: installed } : {}),
      extensionDevelopmentPath: process.env.CODESYS_ST_TEST_EXTENSION_PATH ?? resolve("."),
      extensionTestsPath: resolve("dist/host-tests.cjs"),
      extensionTestsEnv: {
        ELECTRON_RUN_AS_NODE: undefined,
        CODESYS_ST_TEST_LANGUAGE: language,
        CODESYS_ST_TEST_RESULT_PATH: resultPath,
      },
      launchArgs: [
        join(temp, "workspace"),
        "--user-data-dir",
        join(temp, "profile"),
        "--extensions-dir",
        join(temp, "extensions"),
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "--disable-gpu",
        "--no-sandbox",
      ],
    });
    // VS Code can exit cleanly before running tests (for example when its window is closed).
    assert.deepEqual(JSON.parse(await readFile(resultPath, "utf8")), {
      language,
      passed: true,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
