import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { packageDirectory } from "./package-path.ts";

export async function prepareDockerContext() {
  const context = await mkdtemp(resolve(tmpdir(), "vplc-docker-"));
  try {
    for (const directory of ["src", "python", "docker", "runtime"])
      await cp(resolve(packageDirectory, directory), resolve(context, directory), {
        recursive: true,
      });
    const configRoot = resolve(
      dirname(createRequire(import.meta.url).resolve("@vplc/config/build")),
      "..",
    );
    await mkdir(resolve(context, "shared-config"));
    await cp(resolve(configRoot, "src"), resolve(context, "shared-config/src"), {
      recursive: true,
    });
    await cp(resolve(configRoot, "package.json"), resolve(context, "shared-config/package.json"));
    await writeFile(
      resolve(context, "package.json"),
      JSON.stringify({ type: "module", dependencies: { zod: "4.3.6", jiti: "2.7.0" } }),
    );
    return context;
  } catch (cause) {
    await rm(context, { recursive: true, force: true });
    throw cause;
  }
}
