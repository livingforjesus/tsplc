#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateProject } from "./project.ts";
import { generateTypes } from "./codegen/generate";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      types: { type: "string" },
      globals: { type: "string" },
      out: { type: "string" },
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: vplc-typegen --types src/types [--globals src/globals] --out generated.ts [--check]\n\nGenerate TypeScript types and runtime field metadata from CODESYS ST declarations.\n--check exits unsuccessfully if the output is missing or stale, without writing files.",
    );
    return;
  }
  if (!values.types && !values.out) {
    const result = await generateProject(values.config, { check: values.check });
    console.log(`Generated ${result.files.join(", ")}`);
    return;
  }
  if (!values.types || !values.out)
    throw new Error("--types and --out are required; run vplc-typegen --help");
  const out = resolve(values.out);
  if (!/\.ts$/i.test(out) || /\.d\.ts$/i.test(out))
    throw new Error("--out must be a .ts file (the generated file contains runtime metadata)");
  const result = await generateTypes({
    types: resolve(values.types),
    globals: values.globals ? resolve(values.globals) : undefined,
  });
  if (values.check) {
    const existing = await readFile(out, "utf8").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing !== result)
      throw new Error(`${out} is missing or stale; rerun vplc-typegen without --check`);
    console.log(`Up to date: ${out}`);
    return;
  }
  await mkdir(dirname(out), { recursive: true });
  const temporary = `${out}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, result, { flag: "wx" });
    await rename(temporary, out);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`Generated ${out}`);
}

main().catch((error: unknown) => {
  console.error(`vplc-typegen: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
