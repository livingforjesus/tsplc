import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format } from "prettier";
import { loadVplcConfig, typegenSchema } from "@vplc/config";
import { generateTypes } from "./codegen/generate.ts";
import { generateHardwareTypes, loadHardware, resolveIo } from "./hardware.ts";

async function stFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? stFiles(resolve(path, entry.name))
          : entry.isFile() && /\.st$/i.test(entry.name)
            ? [resolve(path, entry.name)]
            : [],
      ),
    )
  ).flat();
}
export async function generateProject(
  file = "vplc.config.ts",
  options: {
    check?: boolean;
    sourceDir?: string;
    hardwareOnly?: boolean;
    loaded?: Awaited<ReturnType<typeof loadVplcConfig>>;
  } = {},
) {
  const { config, root, configFile } = options.loaded ?? (await loadVplcConfig(file));
  const settings = typegenSchema.parse(config.typegen ?? {});
  const catalog = await loadHardware(config, root),
    io = resolveIo(config, catalog);
  const project = {
    version: 1,
    configFile,
    config,
    symbols: config.compiler
      ? JSON.parse(
          await readFile(resolve(root, ".vplc/artifacts/st/io-symbols.json"), "utf8").catch(
            () => "{}",
          ),
        )
      : Object.fromEntries(
          Object.keys(io)
            .filter((symbol) => symbol.includes("."))
            .map((symbol) => [symbol, symbol]),
        ),
  };
  const outputs = [
    {
      path: resolve(root, settings.hardwareOut),
      content: await format(generateHardwareTypes(catalog), { parser: "typescript" }),
    },
    { path: resolve(root, ".vplc/project.json"), content: JSON.stringify(project, null, 2) + "\n" },
  ];
  if (!options.hardwareOnly) {
    const roots = (setting: string | string[] | undefined) =>
      setting
        ? (typeof setting === "string" ? [setting] : setting).map((path) => resolve(root, path))
        : [];
    const types = roots(settings.types),
      globals = roots(settings.globals);
    const typeFiles: string[] = [],
      globalFiles: string[] = [];
    const source =
      options.sourceDir ?? (config.compiler ? ".vplc/artifacts/st" : config.build?.sourceDir);
    const generateContract = !!(types.length || globals.length || source || config.typegen);
    if (types.length || globals.length) {
      for (const [files, directories] of [
        [typeFiles, types],
        [globalFiles, globals],
      ] as const)
        for (const directory of directories) files.push(...(await stFiles(directory)));
      if (!typeFiles.length && !globalFiles.length)
        throw new Error("no .st declarations found in the configured typegen directories");
    } else if (source) {
      const sourceRoot = resolve(root, source);
      const files = await stFiles(sourceRoot);
      if (!files.length) throw new Error(`no .st declarations found in ${sourceRoot}`);
      for (const source of files) {
        const text = await readFile(source, "utf8"),
          body = text.replace(/\(\*[\s\S]*?\*\)|\/\/[^\r\n]*|\{[^}]*\}/g, "").trimStart();
        const kind = /^TYPE\b/i.test(body)
          ? "types"
          : /^VAR_GLOBAL\b/i.test(body)
            ? "globals"
            : undefined;
        if (!kind) continue;
        (kind === "types" ? typeFiles : globalFiles).push(source);
      }
    } else if (config.typegen)
      throw new Error("Configure build.sourceDir or typegen.types/globals to generate PLC types.");
    if (generateContract)
      outputs.push({
        path: resolve(root, settings.out),
        content: await format(
          await generateTypes({
            types: typeFiles,
            globals: globalFiles,
            publishedGlobalsOnly: !!config.compiler && !types.length && !globals.length,
          }),
          { parser: "typescript" },
        ),
      });
  }
  for (const output of outputs) {
    if (options.check) {
      const actual = await readFile(output.path, "utf8").catch(() => undefined);
      // Consumers may format generated TS with their own formatter. Compare the
      // same normalized syntax while preserving changes to values and comments.
      const normalized =
        actual !== undefined && /\.ts$/i.test(output.path)
          ? await format(actual, { parser: "typescript" })
          : actual;
      if (normalized !== output.content)
        throw new Error(`Generated file is missing or stale: ${output.path}`);
    } else {
      await mkdir(dirname(output.path), { recursive: true });
      const temp = `${output.path}.${process.pid}.tmp`;
      await writeFile(temp, output.content);
      await rename(temp, output.path);
    }
  }
  return { catalog, io, files: outputs.map((o) => o.path) };
}
