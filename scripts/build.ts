import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const entries = {
  config: { schema: "src/schema.ts", index: "src/index.ts", build: "src/build.ts" },
  build: { index: "src/index.ts", cli: "src/cli.ts", libraries: "src/libraries.ts" },
  typegen: {
    hardware: "src/hardware.ts",
    index: "src/index.ts",
    cli: "src/cli.ts",
    codegen: "src/codegen/generate.ts",
  },
  compiler: {
    index: "src/index.ts",
    cli: "project/cli.ts",
    ir: "ir/index.ts",
    codesys: "backends/codesys/index.ts",
    project: "project/index.ts",
    math: "stdlib/math.ts",
  },
};
for (const [name, files] of Object.entries(entries)) {
  const directory = resolve(root, "packages", name);
  await mkdir(resolve(directory, "dist"), { recursive: true });
  for (const [output, input] of Object.entries(files)) {
    const result = await Bun.build({
      entrypoints: [resolve(directory, input)],
      outdir: resolve(directory, "dist"),
      naming: `${output}.js`,
      target: "node",
      packages: "external",
      sourcemap: "linked",
    });
    if (!result.success)
      throw new AggregateError(result.logs, `Failed to build ${name}/${output}.`);
    if (output === "cli") {
      const path = resolve(directory, "dist/cli.js"),
        text = await readFile(path, "utf8");
      await writeFile(path, text.replace(/^#![^\n]*\n/, "#!/usr/bin/env bun\n"));
    }
  }
}
const extension = Bun.spawn([process.execPath, "scripts/build.ts"], {
  cwd: resolve(root, "packages/vscode-extension"),
  stdout: "inherit",
  stderr: "inherit",
});
if (await extension.exited) throw new Error("VS Code extension build failed.");
