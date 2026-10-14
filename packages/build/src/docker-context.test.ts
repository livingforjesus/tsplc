import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { prepareDockerContext } from "./docker-context.ts";

const execute = promisify(execFile);
const modulePath = new URL("./docker-build.ts", import.meta.url).pathname;

test("Docker recipes deliver the runner's local imports from the prepared source context", async () => {
  const context = await prepareDockerContext();
  try {
    const runner = await readFile(resolve(context, "docker/runner.ts"), "utf8");
    const imports = [...runner.matchAll(/from "\.\/([^"\n]+)"/g)].map(
      (match) => `docker/${match[1]}`,
    );
    expect(imports).toContain("docker/config.ts");
    for (const recipe of ["Dockerfile", "Dockerfile.source"]) {
      const text = await readFile(resolve(context, "docker", recipe), "utf8");
      const sources = text
        .split("\n")
        .filter((line) => /^COPY .* (?:\.\/docker\/|\/opt\/codesys-build\/docker\/)$/.test(line))
        .flatMap((line) => line.split(/\s+/).slice(1, -1));
      for (const dependency of imports) {
        expect(sources, recipe).toContain(dependency);
        expect((await readFile(resolve(context, dependency), "utf8")).trim()).not.toBe("");
      }
    }
  } finally {
    await rm(context, { recursive: true, force: true });
  }
});

test.each([
  ["success", "amd64", "base", "linux/amd64"],
  ["success", "x86_64", "base", "linux/amd64"],
  ["success", "arm64", "arm-setup", "linux/arm64"],
  ["success", "aarch64", "arm-setup", "linux/arm64"],
  ["build-failure", "amd64", "base", "linux/amd64"],
  ["preparation-failure", "amd64", "base", "linux/amd64"],
])(
  "Docker configuration builds an AMD64 runtime and releases its contexts after %s on %s",
  async (outcome, architecture, setupBase, setupPlatform) => {
    const root = await mkdtemp(resolve(tmpdir(), "tsplc-context-cleanup-test-"));
    try {
      await mkdir(resolve(root, "bin"));
      const record = resolve(root, "contexts.json");
      await writeFile(
        resolve(root, "bin/docker"),
        `#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv[2] === "info") console.log("linux/" + process.env.TSPLC_TEST_ARCH);
else {
  writeFileSync(process.env.TSPLC_TEST_ARGS, JSON.stringify(process.argv.slice(2)));
  process.exit(process.env.TSPLC_TEST_OUTCOME === "build-failure" ? 17 : 0);
}
`,
        { mode: 0o755 },
      );
      const harness = resolve(root, "configure.ts");
      await writeFile(
        harness,
        `
import { mock } from "bun:test";
import * as fs from "node:fs/promises";
import { basename } from "node:path";
const original = { ...fs };
const contexts = [];
mock.module("node:fs/promises", () => ({
  ...original,
  mkdtemp: async (...args) => {
    const directory = await original.mkdtemp(...args);
    contexts.push(directory);
    await original.writeFile(process.env.TSPLC_TEST_RECORD, JSON.stringify(contexts));
    return directory;
  },
  cp: async (...args) => {
    if (process.env.TSPLC_TEST_OUTCOME === "preparation-failure" && basename(args[1]) === "python")
      throw new Error("Source context copy failed");
    return original.cp(...args);
  },
}));
const { configureDocker } = await import(${JSON.stringify(modulePath)});
await configureDocker("builder:cleanup-test");
`,
      );
      const result = await execute(process.execPath, [harness], {
        env: {
          ...process.env,
          PATH: `${resolve(root, "bin")}:${process.env["PATH"]}`,
          TSPLC_TEST_OUTCOME: outcome,
          TSPLC_TEST_ARCH: architecture,
          TSPLC_TEST_ARGS: resolve(root, "args.json"),
          TSPLC_TEST_RECORD: record,
        },
      }).then(
        () => ({ ok: true, error: "" }),
        (error: Error) => ({ ok: false, error: error.message }),
      );
      expect(result.ok).toBe(outcome === "success");
      if (outcome !== "success")
        expect(result.error).toContain(
          outcome === "build-failure"
            ? "Docker configuration failed (17)"
            : "Source context copy failed",
        );
      const contexts: string[] = JSON.parse(await readFile(record, "utf8"));
      expect(contexts).toHaveLength(2);
      expect(contexts[0]).toContain("codesys-installer-");
      expect(contexts[1]).toContain("tsplc-docker-");
      for (const context of contexts) await expect(access(context)).rejects.toThrow();
      if (outcome !== "preparation-failure") {
        const args: string[] = JSON.parse(await readFile(resolve(root, "args.json"), "utf8"));
        expect(args[args.indexOf("--platform") + 1]).toBe("linux/amd64");
        expect(args).toContain(`SETUP_BASE=${setupBase}`);
        expect(args).toContain(`SETUP_PLATFORM=${setupPlatform}`);
        expect(args.some((arg) => arg.startsWith("BUILDER_BASE="))).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each([
  [false, "amd64", "base", "linux/amd64"],
  [true, "amd64", "base", "linux/amd64"],
  [false, "aarch64", "arm-setup", "linux/arm64"],
  [true, "aarch64", "arm-setup", "linux/arm64"],
] as const)(
  "standalone image build owns its contexts (local installer: %s, host: %s)",
  async (localInstaller, architecture, setupBase, setupPlatform) => {
    const root = await mkdtemp(resolve(tmpdir(), "tsplc image script-"));
    try {
      await mkdir(resolve(root, "bin"));
      const record = resolve(root, "record.json");
      await writeFile(
        resolve(root, "bin/docker"),
        `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "info") console.log("linux/" + process.env.TSPLC_TEST_ARCH);
else {
  const source = args.at(-1);
  const installer = args.find(value => value.startsWith("installer=")).slice("installer=".length);
  writeFileSync(process.env.TSPLC_TEST_RECORD, JSON.stringify({
    args, source, installer,
    manifest: JSON.parse(readFileSync(source + "/package.json", "utf8")),
    config: JSON.parse(readFileSync(source + "/shared-config/package.json", "utf8")),
    localInstaller: process.env.TSPLC_TEST_LOCAL === "true" ? readFileSync(installer + "/codesys.exe", "utf8") : null,
  }));
}
`,
        { mode: 0o755 },
      );
      const installer = resolve(root, "local installer.exe");
      await writeFile(installer, "Offline installer fixture, never executed");
      await execute(
        "/bin/sh",
        [
          new URL("../docker/build-image", import.meta.url).pathname,
          ...(localInstaller ? [installer] : []),
        ],
        {
          env: {
            ...process.env,
            PATH: `${resolve(root, "bin")}:${process.env["PATH"]}`,
            TSPLC_TEST_RECORD: record,
            TSPLC_TEST_LOCAL: String(localInstaller),
            TSPLC_TEST_ARCH: architecture,
            CODESYS_BUILD_IMAGE: "",
          },
        },
      );
      const result = JSON.parse(await readFile(record, "utf8"));
      expect(result.args[result.args.indexOf("--platform") + 1]).toBe("linux/amd64");
      expect(result.args).toContain(`SETUP_BASE=${setupBase}`);
      expect(result.args).toContain(`SETUP_PLATFORM=${setupPlatform}`);
      expect(result.args[result.args.indexOf("-t") + 1]).toBe("tsplc-build:3.5.22.30");
      expect(result.manifest.dependencies).toEqual({ zod: "4.3.6", jiti: "2.7.0" });
      expect(result.config.name).toBe("@tsplc/config");
      expect(result.localInstaller).toBe(
        localInstaller ? "Offline installer fixture, never executed" : null,
      );
      await expect(access(result.source)).rejects.toThrow();
      await expect(access(result.installer)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("the final AMD64 image copies only the installed prefix from the setup stages", async () => {
  const recipe = await readFile(new URL("../docker/Dockerfile", import.meta.url), "utf8");
  expect(recipe).toContain("FROM --platform=${SETUP_PLATFORM} ubuntu:24.04 AS arm-setup");
  expect(recipe).toContain("FROM ${SETUP_BASE} AS prerequisites");
  expect(recipe).toContain("FROM ${SETUP_BASE} AS init");
  const builder = recipe.split("FROM base AS builder\n")[1];
  expect(builder).toBeDefined();
  const copies = [...builder!.matchAll(/^COPY --from=installed (.+)$/gm)].map((match) => match[1]);
  expect(copies).toEqual(["--chown=builder:builder /opt/wine-template /opt/wine-template"]);
  expect(builder).not.toContain("/opt/fex-rootfs");
  expect(builder).not.toContain("FEX_ROOTFS");
  expect(builder).not.toContain("--from=arm-setup");
});

test("offline verification runs as the prefix owner in the AMD64 runtime before SDK packaging", async () => {
  const context = await prepareDockerContext();
  try {
    const recipe = await readFile(resolve(context, "docker/Dockerfile"), "utf8");
    const installed = recipe
      .split("FROM core AS installed\n")[1]!
      .split("FROM base AS wine-signal-compat\n")[0]!;
    const builder = recipe.split("FROM base AS builder\n")[1]!;
    const installation = await readFile(resolve(context, "docker/install/install.sh"), "utf8");
    const verification = await readFile(resolve(context, "docker/install/verify.sh"), "utf8");
    expect(installed).not.toContain("verify.sh");
    expect(installation).not.toContain("verify.cmd");
    expect(installation).toContain(
      'cp /opt/codesys-install/verify.py "$WINEPREFIX/drive_c/verify.py"',
    );
    expect(installation).toContain(
      'cp -R /opt/codesys-install/device "$WINEPREFIX/drive_c/codesys-device"',
    );
    const check = builder.indexOf("RUN tini -s -g -- xvfb-run -a /opt/codesys-install/verify.sh");
    expect(check).toBeGreaterThan(builder.indexOf("enable-oaep.py"));
    expect(check).toBeLessThan(builder.indexOf("RUN bun install --production"));
    const before = builder.slice(0, check);
    expect([...before.matchAll(/^USER (.+)$/gm)].at(-1)?.[1]).toBe("builder");
    expect(before).toContain("WINEPREFIX=/opt/wine-template HOME=/home/builder WINEARCH=win64");
    expect(builder.slice(check)).toContain("USER root");
    expect(recipe).toContain("FROM base AS runtime-init");
    expect(builder).toContain("COPY --from=runtime-init /usr/local/bin/tini /usr/local/bin/tini");
    expect(verification).toContain('test -s "$WINEPREFIX/drive_c/codesys-verification.app"');
  } finally {
    await rm(context, { recursive: true, force: true });
  }
});

test("the prepared recipe delivers the Wine adapter before verification without changing setup", async () => {
  const context = await prepareDockerContext();
  try {
    const recipe = await readFile(resolve(context, "docker/Dockerfile"), "utf8");
    const adapter = recipe
      .split("FROM base AS wine-signal-compat\n")[1]!
      .split("FROM base AS builder\n")[0]!;
    const setup = recipe.split("FROM base AS wine-signal-compat\n")[0]!;
    const builder = recipe.split("FROM base AS builder\n")[1]!;
    expect(adapter).toContain("install -y --no-install-recommends libc6-dev");
    expect(adapter).toContain("COPY docker/install/wine-signal /opt/codesys-install/wine-signal");
    expect(adapter).toContain(
      "RUN /opt/codesys-install/wine-signal/build.sh /opt/tsplc-wine-compat",
    );
    expect(setup).not.toContain("wine-signal");
    const check = builder.indexOf("RUN tini -s -g -- xvfb-run -a /opt/codesys-install/verify.sh");
    const library = builder.indexOf(
      "COPY --from=wine-signal-compat /opt/tsplc-wine-compat /opt/tsplc-wine-compat",
    );
    const launcher = builder.indexOf(
      "COPY --chmod=755 docker/install/wine-signal/wine /usr/local/bin/wine",
    );
    expect(library).toBeGreaterThanOrEqual(0);
    expect(launcher).toBeGreaterThanOrEqual(0);
    expect(library).toBeLessThan(check);
    expect(launcher).toBeLessThan(check);
    expect(recipe).not.toMatch(/^ENV .*LD_PRELOAD/m);
    const path = resolve(context, "docker/install/wine-signal");
    const wrapper = await readFile(resolve(path, "wine"), "utf8");
    expect(wrapper).toContain("export LD_PRELOAD='/opt/tsplc-wine-compat/$LIB/signal-state.so'");
    expect(wrapper).toContain('exec /opt/wine-devel/bin/wine "$@"');
    const build = await readFile(resolve(path, "build.sh"), "utf8");
    expect(build).toContain('"$output/lib/x86_64-linux-gnu/signal-state.so"');
    expect(build).toContain('"$output/lib/i386-linux-gnu/signal-state.so"');
    for (const file of [
      "signal-state.c",
      "noop-i386.c",
      "check.sh",
      "tests/frame-and-handler.c",
      "tests/avx-registers.c",
      "tests/signal-return.c",
      "tests/loader-i386.c",
    ]) {
      expect((await readFile(resolve(path, file), "utf8")).trim(), file).not.toBe("");
    }
  } finally {
    await rm(context, { recursive: true, force: true });
  }
});
