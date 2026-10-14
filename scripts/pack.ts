import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const destination = resolve(root, "artifacts/packages");
await mkdir(destination, { recursive: true });
const dependencies: Record<string, string> = {};
for (const name of ["config", "build", "typegen", "compiler"]) {
  const child = Bun.spawn(
    [process.execPath, "pm", "pack", "--destination", destination, "--quiet"],
    {
      cwd: resolve(root, "packages", name),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (await child.exited) throw new Error(`Failed to pack @tsplc/${name}.`);
  const metadata = JSON.parse(
    await readFile(resolve(root, "packages", name, "package.json"), "utf8"),
  ) as { version: string };
  const filename = `tsplc-${name}-${metadata.version}`;
  const archive = resolve(destination, `${filename}.tgz`);
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex")
    .slice(0, 16);
  // Bun caches local archives by path. A content address makes repacking the
  // same unpublished version install the changed code in external projects.
  const addressed = resolve(destination, `${filename}-${digest}.tgz`);
  await cp(archive, addressed);
  dependencies[`@tsplc/${name}`] = `file:${addressed}`;
}
await writeFile(
  resolve(destination, "install.json"),
  JSON.stringify({ dependencies, overrides: dependencies }, null, 2) + "\n",
);
