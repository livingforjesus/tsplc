import { expect, test } from "bun:test";
import { configSchema, resolveConfig } from "../src/config.ts";
import { tsplcConfigSchema } from "@tsplc/config/schema";
import { resolveContainerConfig } from "./config.ts";

const file = "/workspace/tsplc.config.ts";
const build = { template: "local.project" };

test.each([
  { executable: "C:\\CODESYS.exe", profile: "Native" },
  { executable: "/host/CODESYS.exe", profile: "Wine", wine: { prefix: "/host/.wine" } },
])("public config rejects host CODESYS launch settings", (codesys) => {
  expect(configSchema.safeParse({ ...build, codesys }).success).toBe(false);
  expect(
    tsplcConfigSchema.safeParse({ backend: "codesys", build: { ...build, codesys } }).success,
  ).toBe(false);
  expect(() => resolveConfig({ ...build, codesys }, file)).toThrow();
});

test("public build resolution always selects Docker, including omitted/undefined docker options", () => {
  for (const input of [build, { ...build, docker: undefined }])
    expect(resolveConfig(input, file).docker?.image).toBe("tsplc-build:3.5.22.30");
});

test("the private container resolver supplies the pinned Wine launcher without Docker recursion", () => {
  const config = resolveContainerConfig({ ...build, outDir: "/output" }, file);
  expect(config.docker).toBeUndefined();
  expect(config.outDir).toBe("/output");
  expect(config.codesys).toMatchObject({
    executable: "/tmp/codesys-wine/drive_c/CODESYS-3.5.22.30/CODESYS/Common/CODESYS.exe",
    profile: "CODESYS V3.5 SP22 Patch 3",
    commandProcessor: "cmd.exe",
    wine: {
      prefix: "/tmp/codesys-wine",
      binary: "wine",
      pathBinary: "winepath",
      nativeExit: true,
      debug: "-all,err+seh",
    },
  });
  expect(() =>
    resolveContainerConfig({ ...build, codesys: { executable: "other.exe" } }, file),
  ).toThrow();
});

test("fatal Wine diagnostics are private to container launch configuration", () => {
  resolveContainerConfig(build, file);
  expect(resolveConfig(build, file).codesys.wine?.debug).toBe("-all");
});

test("public build API refuses a resolved config with Docker removed before launching anything", async () => {
  // Other engineering tests replace @tsplc/build exports. A subprocess exercises
  // the real public dispatcher and cannot inherit those module mocks.
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
      import { buildProject } from ${JSON.stringify(new URL("../src/build.ts", import.meta.url).pathname)};
      import { resolveConfig } from ${JSON.stringify(new URL("../src/config.ts", import.meta.url).pathname)};
      await buildProject({ ...resolveConfig(${JSON.stringify(build)}, ${JSON.stringify(file)}), docker: undefined });
    `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(1);
  expect(stderr).toContain("Builds require a Docker builder image.");
});
