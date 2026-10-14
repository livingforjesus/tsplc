import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ResolvedConfig } from "./config.ts";

export async function mountLibraries(libraries: ResolvedConfig["libraries"], directory: string) {
  if (!libraries?.length) return undefined;
  await mkdir(resolve(directory, "libraries"), { recursive: true });
  return Promise.all(
    libraries.map(async (library) => {
      const data = await readFile(library.path);
      if (createHash("sha256").update(data).digest("hex") !== library.sha256)
        throw new Error(`Library changed after installation: ${library.title}`);
      const filename = `${library.sha256}-${basename(library.path)}`;
      await writeFile(resolve(directory, "libraries", filename), data);
      return { ...library, path: `/input/libraries/${filename}` };
    }),
  );
}
