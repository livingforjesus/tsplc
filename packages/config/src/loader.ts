import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";
import { tsplcConfigSchema } from "./schema.ts";
export async function loadTsplcConfig(file = "tsplc.config.ts") {
  const configFile = resolve(file);
  await readFile(configFile);
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: false,
    interopDefault: false,
    // Bun can import TS natively, but its module cache would hide config edits.
    tryNative: false,
  });
  const module = await jiti.import<{ default?: unknown; config?: unknown }>(configFile);
  const config = tsplcConfigSchema.parse(module.default ?? module.config);
  if (config.compiler && !config.tasks)
    throw new Error("TypeScript programs require a tasks configuration.");
  return { configFile, root: dirname(configFile), config };
}
