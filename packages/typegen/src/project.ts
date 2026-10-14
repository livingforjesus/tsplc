import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { format } from "prettier";
import { loadTsplcConfig, typegenSchema, type ResolvedTsplcConfig } from "@tsplc/config";
import { generateTypes, stFiles } from "./codegen/generate.ts";
import { generateHardwareTypes, type IoTarget, loadHardware, resolveIo } from "./hardware.ts";

/**
 * Explicit typegen directories take every .st file. Otherwise TYPE and VAR_GLOBAL files are
 * picked from the compiler's emitted ST or the raw build sources.
 */
async function contractSources(
  config: ResolvedTsplcConfig,
  root: string,
  settings: { types?: string | string[]; globals?: string | string[] },
): Promise<{ types: string[]; globals: string[]; explicit: boolean } | undefined> {
  const directories = (setting: string | string[] | undefined) =>
    setting ? [setting].flat().map((path) => resolve(root, path)) : [];
  const types = directories(settings.types),
    globals = directories(settings.globals);
  if (types.length || globals.length) {
    const sources = { types: [] as string[], globals: [] as string[], explicit: true };
    for (const directory of types) sources.types.push(...(await stFiles(directory)));
    for (const directory of globals) sources.globals.push(...(await stFiles(directory)));
    if (!sources.types.length && !sources.globals.length)
      throw new Error("no .st declarations found in the configured typegen directories");
    return sources;
  }
  const source = config.compiler ? ".tsplc/artifacts/st" : config.build?.sourceDir;
  if (!source) {
    if (config.typegen)
      throw new Error("Configure build.sourceDir or typegen.types/globals to generate PLC types.");
    return undefined;
  }
  const sourceRoot = resolve(root, source);
  const files = await stFiles(sourceRoot);
  if (!files.length) throw new Error(`no .st declarations found in ${sourceRoot}`);
  const sources = { types: [] as string[], globals: [] as string[], explicit: false };
  for (const file of files) {
    const body = (await readFile(file, "utf8"))
      .replace(/\(\*[\s\S]*?\*\)|\/\/[^\r\n]*|\{[^}]*\}/g, "")
      .trimStart();
    if (/^TYPE\b/i.test(body)) sources.types.push(file);
    else if (/^VAR_GLOBAL\b/i.test(body)) sources.globals.push(file);
  }
  return sources;
}

export async function generateProject(
  file = "tsplc.config.ts",
  options: {
    check?: boolean;
    hardwareOnly?: boolean;
    /** Bindable targets of a compiled TS project; they type the `io` keys. */
    targets?: readonly IoTarget[];
    loaded?: Awaited<ReturnType<typeof loadTsplcConfig>>;
  } = {},
) {
  const { config, root, configFile } = options.loaded ?? (await loadTsplcConfig(file));
  const settings = typegenSchema.parse(config.typegen ?? {});
  const catalog = await loadHardware(config, root),
    io = resolveIo(config, catalog);
  const project = {
    version: 1,
    configFile,
    config,
    symbols: config.compiler
      ? JSON.parse(
          await readFile(resolve(root, ".tsplc/artifacts/st/io-symbols.json"), "utf8").catch(
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
      content: await format(generateHardwareTypes(catalog, options.targets), {
        parser: "typescript",
      }),
    },
    {
      path: resolve(root, ".tsplc/project.json"),
      content: JSON.stringify(project, null, 2) + "\n",
    },
  ];
  const sources = options.hardwareOnly ? undefined : await contractSources(config, root, settings);
  if (sources)
    outputs.push({
      path: resolve(root, settings.out),
      content: await format(
        await generateTypes({
          types: sources.types,
          globals: sources.globals,
          publishedGlobalsOnly: !!config.compiler && !sources.explicit,
        }),
        { parser: "typescript" },
      ),
    });
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
