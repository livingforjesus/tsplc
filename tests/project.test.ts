import { afterAll, expect, test } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProject, buildProject, cleanProject } from "@tsplc/compiler/project";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tsplc-project-"));
  directories.push(root);
  mkdirSync(join(root, "source"));
  writeFileSync(join(root, "source/tsconfig.json"), JSON.stringify({ include: ["*.ts"] }));
  writeFileSync(
    join(root, "source/main.ts"),
    "let running: BOOL = false; export function main(): void { running = true; }",
  );
  const config = join(root, "tsplc.config.ts");
  writeFileSync(
    config,
    `export default { backend:"codesys", name: "Test", compiler:{tsconfig: "./source/tsconfig.json", programs:{main: { module: "./source/main.ts", export: "main" }}}, tasks: [{ name: "MainTask", schedule: { kind: "cyclic", interval: { kind: "duration", nanoseconds: "20000000" } }, priority: 1, programs: ["main"] }], codesys:{profile:{directAddressing:"byte"}},io:{} };`,
  );
  return { root, config, output: join(root, ".tsplc/artifacts") };
}
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

test("check resolves entry modules relative to config and writes no files", async () => {
  const f = fixture(),
    result = await checkProject(f.config);
  expect(result.diagnostics).toEqual([]);
  expect(result.plan).toBeDefined();
  expect(existsSync(join(f.root, ".tsplc"))).toBe(false);
});
test("trusted configuration is typechecked before execution and machine source is never executed", async () => {
  const f = fixture();
  writeFileSync(
    f.config,
    'const value: number = "bad"; throw new Error("config executed"); export default {};',
  );
  const result = await checkProject(f.config);
  expect(
    result.diagnostics.some((item) => item.origin === "typescript" && item.code === "TS2322"),
  ).toBe(true);
  const other = fixture();
  writeFileSync(
    join(other.root, "source/main.ts"),
    'throw new Error("machine executed"); export function main(): void {}',
  );
  expect((await checkProject(other.config)).diagnostics.some((item) => item.origin === "plc")).toBe(
    true,
  );
});
test("ST-only build publishes complete mapped artifacts with an honest receipt", async () => {
  const f = fixture(),
    first = await buildProject(f.config, { emitOnly: true });
  expect(first.diagnostics).toEqual([]);
  expect(first.status).toBe("emitted");
  const receipt = JSON.parse(readFileSync(join(f.output, "receipt.json"), "utf8"));
  expect(receipt.status).toBe("emitted");
  expect(receipt.vendor).toBeUndefined();
  const owner = JSON.parse(readFileSync(join(f.output, "manifest.json"), "utf8"));
  expect(owner.files.some((file: { path: string }) => file.path === "st/mappings.json")).toBe(true);
  const paths = owner.files.map((file: { path: string }) => file.path);
  expect(paths).toEqual([...paths].sort());
  const second = await buildProject(f.config, { emitOnly: true });
  expect(second.diagnostics).toEqual([]);
  expect(await cleanProject(f.config)).toEqual({ diagnostics: [] });
  expect(existsSync(f.output)).toBe(false);
});
test("failed checks withdraw the successful receipt without publishing partial source", async () => {
  const f = fixture();
  expect((await buildProject(f.config, { emitOnly: true })).diagnostics).toEqual([]);
  const original = readFileSync(join(f.output, "st/F_main/implementation.st"), "utf8");
  writeFileSync(join(f.root, "source/main.ts"), 'export function main(): void { fetch("x"); }');
  expect((await buildProject(f.config, { emitOnly: true })).diagnostics.length).toBeGreaterThan(0);
  expect(existsSync(join(f.output, "receipt.json"))).toBe(false);
  expect(readFileSync(join(f.output, "st/F_main/implementation.st"), "utf8")).toBe(original);
  expect((await cleanProject(f.config)).diagnostics).toEqual([]);
});
test("default build requires codesys-build settings and never claims vendor compilation on failure", async () => {
  const f = fixture(),
    result = await buildProject(f.config);
  expect(result.diagnostics[0]?.origin).toBe("vendor");
  expect(result.diagnostics[0]?.message).toContain("engineering.build");
  expect(existsSync(f.output)).toBe(false);
  expect(
    JSON.parse(readFileSync(join(f.root, ".tsplc/engineering/ownership.json"), "utf8")),
  ).toEqual({ kind: "tsplc-engineering", version: 1, configFile: realpathSync(f.config) });
});
test("build refuses unrelated output files and clean preserves them", async () => {
  const f = fixture();
  await buildProject(f.config, { emitOnly: true });
  writeFileSync(join(f.output, "keep.txt"), "user content");
  expect((await buildProject(f.config, { emitOnly: true })).diagnostics[0]?.message).toContain(
    "unrelated",
  );
  expect(existsSync(join(f.output, "receipt.json"))).toBe(false);
  expect((await cleanProject(f.config)).diagnostics).toEqual([]);
  expect(readFileSync(join(f.output, "keep.txt"), "utf8")).toBe("user content");
});
test("generated file modifications and directory symlinks are preserved", async () => {
  const f = fixture();
  await buildProject(f.config, { emitOnly: true });
  writeFileSync(join(f.output, "st/config.json"), "manual change");
  expect((await cleanProject(f.config)).diagnostics[0]?.message).toContain("edited");
  expect(readFileSync(join(f.output, "st/config.json"), "utf8")).toBe("manual change");
  expect(existsSync(join(f.output, "receipt.json"))).toBe(true);
  expect((await buildProject(f.config, { emitOnly: true })).diagnostics[0]?.message).toContain(
    "edited",
  );
  expect(existsSync(join(f.output, "receipt.json"))).toBe(false);
  expect(readFileSync(join(f.output, "st/config.json"), "utf8")).toBe("manual change");
  const other = fixture(),
    destination = mkdtempSync(join(tmpdir(), "tsplc-unrelated-"));
  directories.push(destination);
  symlinkSync(destination, join(other.root, ".tsplc"));
  expect((await buildProject(other.config, { emitOnly: true })).diagnostics[0]?.message).toContain(
    "real directory",
  );
});
test("rechecking reloads edited configuration and CLI JSON stays parseable", async () => {
  const f = fixture();
  expect((await checkProject(f.config)).diagnostics).toEqual([]);
  writeFileSync(
    f.config,
    readFileSync(f.config, "utf8").replace('name: "Test"', 'name: "Changed"'),
  );
  expect((await checkProject(f.config)).config?.name).toBe("Changed");
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../packages/compiler/project/cli.ts"),
      "check",
      "--config",
      f.config,
      "--format",
      "json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await child.exited).toBe(0);
  expect(JSON.parse(await new Response(child.stdout).text()).ok).toBe(true);
});

test("CLI inspection reaches controller validation without resolving local EDS or libraries", async () => {
  const f = fixture();
  writeFileSync(
    f.config,
    `export default {
    backend: "codesys", build: { template: "missing.project" },
    devices: { unavailable: { file: "missing.eds" } },
    dependencies: { Machine: { path: "missing.library" } }
  };`,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../packages/compiler/project/cli.ts"),
      "inspect",
      "--config",
      f.config,
      "--format",
      "json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await child.exited).toBe(1);
  const response = JSON.parse(await new Response(child.stdout).text());
  expect(response.diagnostics[0].message).toContain("online gateway/device configuration");
  expect(existsSync(join(f.root, "tsplc.lock.json"))).toBe(false);
  expect(existsSync(join(f.root, ".tsplc"))).toBe(false);
});

test("root CLI rejects unknown commands before executing config", async () => {
  const f = fixture();
  writeFileSync(f.config, 'throw new Error("Config was executed."); export default {};');
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../packages/compiler/project/cli.ts"),
      "unknown-command",
      "--config",
      f.config,
      "--format",
      "json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(1);
  expect(JSON.parse(stdout).diagnostics[0].message).toBe("Unknown command unknown-command.");
  expect(existsSync(join(f.root, ".tsplc"))).toBe(false);
});

test("first TypeScript typegen bootstraps hardware before emitting and checking PLC contracts", async () => {
  const f = fixture();
  const cli = join(import.meta.dir, "../packages/compiler/project/cli.ts");
  expect(existsSync(join(f.output, "st"))).toBe(false);
  for (const args of [[], ["--check"]]) {
    const child = Bun.spawn(
      [process.execPath, cli, "typegen", "--config", f.config, "--format", "json", ...args],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr || stdout).toBe(0);
    expect(JSON.parse(stdout).ok).toBe(true);
  }
  expect(existsSync(join(f.root, "generated/hardware.ts"))).toBe(true);
  expect(existsSync(join(f.root, "generated/plc.ts"))).toBe(true);
  expect(existsSync(join(f.output, "st"))).toBe(true);
}, 20_000);

test("raw CLI build preserves successful compilation unless PLC contract generation is explicitly enabled", async () => {
  for (const enabled of [false, true]) {
    const f = fixture();
    mkdirSync(join(f.root, "src"));
    writeFileSync(
      join(f.root, "src/Register.st"),
      "TYPE U_Register : UNION\nBITS : BYTE;\nEND_UNION END_TYPE",
    );
    writeFileSync(
      f.config,
      `export default { backend: "codesys", build: { sourceDir: "src", template: "Template.project" }${enabled ? ", typegen: {}" : ""} };`,
    );
    const builder = join(import.meta.dir, "../packages/build/src/index.ts"),
      cli = join(import.meta.dir, "../packages/compiler/project/cli.ts"),
      script = join(f.root, "raw-build-test.ts"),
      marker = join(f.root, "vendor-compiled");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
import { writeFileSync } from "node:fs";
const builder = await import(${JSON.stringify(builder)});
mock.module(${JSON.stringify(builder)}, () => ({ ...builder,
  installLibraries: async () => [],
  buildProject: async () => { writeFileSync(${JSON.stringify(marker)}, "compiled"); return { vendorCompiled: true }; }
}));
process.argv = [process.execPath, ${JSON.stringify(cli)}, "build", "--config", ${JSON.stringify(f.config)}, "--format", "json"];
await import(${JSON.stringify(cli)});`,
    );
    const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(existsSync(marker)).toBe(true);
    expect(code, stderr).toBe(enabled ? 1 : 0);
    const result = JSON.parse(stdout);
    if (enabled) expect(result.diagnostics[0]?.message).toContain("expected ;, found BITS");
    else {
      expect(result.ok).toBe(true);
      expect(result.vendorCompiled).toBe(true);
      expect(existsSync(join(f.root, "generated/hardware.ts"))).toBe(true);
      expect(existsSync(join(f.root, "generated/plc.ts"))).toBe(false);
    }
  }
}, 20_000);

test("emission returns controller paths and tasks from the emitted bundle", async () => {
  const f = fixture();
  writeFileSync(
    f.config,
    readFileSync(f.config, "utf8").replace(
      'backend:"codesys",',
      'backend:"codesys",build:{template:"template.project",outDir:"build/codesys"},',
    ),
  );
  const emitted = await buildProject(f.config, { emitOnly: true });
  expect(emitted.diagnostics).toEqual([]);
  expect(emitted.controllerConfig?.sourceDir).toBe(join(realpathSync(f.output), "st"));
  expect(emitted.controllerConfig?.entry).toBe(
    join(realpathSync(f.output), "st/PRG_main/declaration.st"),
  );
  expect(emitted.controllerConfig?.outDir).toBe(join(realpathSync(f.root), "build/codesys"));
  expect(emitted.controllerConfig?.tasks?.[0]?.programs).toEqual(["PRG_main"]);
});

test("deployment CLI passes resolved emitted paths to the controller without reparsing them", async () => {
  for (const command of ["download", "online-change"]) {
    const f = fixture();
    writeFileSync(
      f.config,
      readFileSync(f.config, "utf8").replace(
        'backend:"codesys",',
        'backend:"codesys",build:{template:"template.project",outDir:"build/codesys"},',
      ),
    );
    const builder = join(import.meta.dir, "../packages/build/src/index.ts"),
      cli = join(import.meta.dir, "../packages/compiler/project/cli.ts"),
      script = join(f.root, "controller-test.ts"),
      library = { title: "TestLibrary", path: join(f.root, "Test.library"), sha256: "synthetic" };
    writeFileSync(
      script,
      `import { mock } from "bun:test";
const builder = await import(${JSON.stringify(builder)});
mock.module(${JSON.stringify(builder)}, () => ({ ...builder,
  installLibraries: async () => [${JSON.stringify(library)}],
  updateController: async (settings, operation) => ({
    operation, configFile: settings.configFile, sourceDir: settings.sourceDir,
    entry: settings.entry, tasks: settings.tasks, libraries: settings.libraries, io: settings.io,
  }),
}));
process.argv = [process.execPath, ${JSON.stringify(cli)}, ${JSON.stringify(command)}, "--config", ${JSON.stringify(f.config)}, "--format", "json"];
await import(${JSON.stringify(cli)});`,
    );
    const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr || stdout).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.operation).toBe(command);
    expect(typeof result.configFile).toBe("string");
    expect(result.sourceDir).toBe(join(realpathSync(f.output), "st"));
    expect(result.entry).toBe(join(realpathSync(f.output), "st/PRG_main/declaration.st"));
    expect(result.tasks[0].programs).toEqual(["PRG_main"]);
    expect(result.libraries).toEqual([library]);
    expect(result.io).toEqual({});
  }
}, 20_000);

test("vendor builds refuse nonempty unowned and differently owned engineering caches", async () => {
  for (const marker of [
    undefined,
    { kind: "tsplc-engineering", version: 1, configFile: "/another/tsplc.config.ts" },
  ]) {
    const f = fixture(),
      engineering = join(f.root, ".tsplc/engineering");
    mkdirSync(engineering, { recursive: true });
    writeFileSync(join(engineering, "keep.txt"), "user cache");
    if (marker) writeFileSync(join(engineering, "ownership.json"), JSON.stringify(marker));
    const result = await buildProject(f.config);
    expect(result.diagnostics[0]?.origin).toBe("config");
    expect(result.diagnostics[0]?.message).toContain("ownership marker");
    expect(readFileSync(join(engineering, "keep.txt"), "utf8")).toBe("user cache");
    expect(existsSync(f.output)).toBe(false);
  }
});
test("an empty engineering cache is stamped and remains outside clean ownership", async () => {
  const f = fixture(),
    engineering = join(f.root, ".tsplc/engineering");
  mkdirSync(engineering, { recursive: true });
  expect((await buildProject(f.config)).diagnostics[0]?.origin).toBe("vendor");
  expect(JSON.parse(readFileSync(join(engineering, "ownership.json"), "utf8")).configFile).toBe(
    realpathSync(f.config),
  );
  expect((await buildProject(f.config, { emitOnly: true })).diagnostics).toEqual([]);
  expect((await cleanProject(f.config)).diagnostics).toEqual([]);
  expect(existsSync(join(engineering, "ownership.json"))).toBe(true);
});
test("nested engineering cache symlinks are refused before the vendor adapter", async () => {
  for (const linked of [
    ".codesys",
    ".codesys/build",
    ".codesys/build/runtime",
    ".codesys/runtime",
  ]) {
    const f = fixture(),
      engineering = join(f.root, ".tsplc/engineering"),
      target = mkdtempSync(join(tmpdir(), "tsplc-cache-target-"));
    directories.push(target);
    mkdirSync(join(engineering, linked, ".."), { recursive: true });
    writeFileSync(
      join(engineering, "ownership.json"),
      JSON.stringify({ kind: "tsplc-engineering", version: 1, configFile: realpathSync(f.config) }),
    );
    writeFileSync(join(target, "keep.txt"), "external cache");
    symlinkSync(target, join(engineering, linked));
    const result = await buildProject(f.config);
    expect(result.diagnostics[0]?.origin).toBe("config");
    expect(result.diagnostics[0]?.message).toContain("symlinks");
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("external cache");
    expect(existsSync(f.output)).toBe(false);
  }
});
test("engineering markers and artifact receipts must be real files before reading", async () => {
  const target = mkdtempSync(join(tmpdir(), "tsplc-authority-target-"));
  directories.push(target);
  const authority = join(target, "authority.json");
  writeFileSync(authority, "do not parse or remove");
  const f = fixture(),
    engineering = join(f.root, ".tsplc/engineering");
  mkdirSync(engineering, { recursive: true });
  symlinkSync(authority, join(engineering, "ownership.json"));
  expect((await buildProject(f.config)).diagnostics[0]?.message).toContain(
    "marker must be a real file",
  );
  const other = fixture();
  await buildProject(other.config, { emitOnly: true });
  const receipt = join(other.output, "receipt.json");
  rmSync(receipt);
  symlinkSync(authority, receipt);
  expect((await cleanProject(other.config)).diagnostics[0]?.message).toContain(
    "receipt must be a real file",
  );
  expect((await buildProject(other.config, { emitOnly: true })).diagnostics[0]?.message).toContain(
    "receipt must be a real file",
  );
  expect(readFileSync(authority, "utf8")).toBe("do not parse or remove");
});

test("publication preserves files and ownership changed during vendor compilation", async () => {
  for (const change of ["source", "extra", "manifest"]) {
    const f = fixture();
    expect((await buildProject(f.config, { emitOnly: true })).diagnostics).toEqual([]);
    const backend = join(import.meta.dir, "../packages/compiler/backends/codesys/index.ts"),
      project = join(import.meta.dir, "../packages/compiler/project/project.ts");
    const generated = join(f.output, "st/F_main/implementation.st"),
      extra = join(f.output, "keep.txt"),
      manifest = join(f.output, "manifest.json");
    const script = join(f.root, "vendor-test.ts");
    writeFileSync(
      script,
      `import { mock } from "bun:test";
import { writeFileSync, readFileSync } from "node:fs";
const backend = await import(${JSON.stringify(backend)});
mock.module(${JSON.stringify(backend)}, () => ({ ...backend, buildCodesys: async () => {
  const change = ${JSON.stringify(change)};
  if (change === "source") writeFileSync(${JSON.stringify(generated)}, "user edit during compile");
  if (change === "extra") writeFileSync(${JSON.stringify(extra)}, "user file during compile");
  if (change === "manifest") { const path = ${JSON.stringify(manifest)}, value = JSON.parse(readFileSync(path, "utf8")); value.files.reverse(); writeFileSync(path, JSON.stringify(value)); }
  const artifact = ${JSON.stringify(join(f.root, "fake-vendor-artifact"))}; writeFileSync(artifact, "vendor fixture");
  return { application: "Application", project: artifact, output: artifact, checksum: artifact };
} }));
const { buildProject } = await import(${JSON.stringify(project)});
console.log(JSON.stringify(await buildProject(${JSON.stringify(f.config)})));`,
    );
    const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.diagnostics[0]?.message).toContain(
      change === "source" ? "edited" : change === "extra" ? "unrelated" : "ownership changed",
    );
    expect(result.status).toBeUndefined();
    expect(existsSync(join(f.output, "receipt.json"))).toBe(false);
    if (change === "source")
      expect(readFileSync(generated, "utf8")).toBe("user edit during compile");
    if (change === "extra") expect(readFileSync(extra, "utf8")).toBe("user file during compile");
    if (change === "manifest") {
      const paths = JSON.parse(readFileSync(manifest, "utf8")).files.map(
        (file: { path: string }) => file.path,
      );
      expect(paths).toEqual([...paths].sort().reverse());
    }
  }
}, 20_000);
