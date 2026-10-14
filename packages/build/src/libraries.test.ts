import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { installLibraries, validateLibrary } from "./libraries.ts";

function registry(payload = "vendor bytes") {
  const responses: Record<string, string> = {
    "/System/index": "Standard\r\nUtil\r\n",
    "/System/Standard/index": "3.5.22.0\r\n",
    "/System/Standard/3.5.22.0/index": "Standard.compiled-library-v3\r\n",
    "/System/Standard/3.5.22.0/Standard.compiled-library-v3": payload,
  };
  return Object.assign(async (input: URL | Request | string) => {
    const path = String(input).split("/CODESYSLibs")[1]!;
    return new Response(responses[path] ?? "missing", {
      status: responses[path] === undefined ? 404 : 200,
    });
  }, {}) as typeof fetch;
}
test("locks the advertised binary by hash and reuses it after the project moves", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tsplc-libraries-"));
  const [installed] = await installLibraries({ Standard: "3.5.22.0" }, root, {
    fetcher: registry(),
  });
  expect(installed?.path).toEndWith("-Standard.compiled-library-v3");
  const lock = JSON.parse(await readFile(resolve(root, "tsplc.lock.json"), "utf8"));
  expect(lock.dependencies.Standard.path).toStartWith(".tsplc/libraries/");
  const moved = `${root}-moved`;
  await rename(root, moved);
  const restored = await installLibraries({ Standard: "3.5.22.0" }, moved, {
    frozen: true,
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  expect(await readFile(restored[0]!.path, "utf8")).toBe("vendor bytes");
});
test("refuses a changed cached binary in frozen mode and a changed registry payload for the locked version", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tsplc-libraries-"));
  const installed = await installLibraries({ Standard: "3.5.22.0" }, root, { fetcher: registry() });
  await writeFile(installed[0]!.path, "changed cache");
  await expect(
    installLibraries({ Standard: "3.5.22.0" }, root, { frozen: true, fetcher: registry() }),
  ).rejects.toThrow("missing or changed");
  await expect(
    installLibraries({ Standard: "3.5.22.0" }, root, {
      fetcher: registry("replaced registry bytes"),
    }),
  ).rejects.toThrow("Registry payload changed");
});
test("validates exact case and version and hashes local libraries", async () => {
  await expect(validateLibrary("standard", "3.5.22.0", "System", registry())).rejects.toThrow(
    "case sensitive",
  );
  await expect(validateLibrary("Standard", "3.5.99.0", "System", registry())).rejects.toThrow(
    "Unknown version",
  );
  const root = await mkdtemp(resolve(tmpdir(), "tsplc-local-library-"));
  await mkdir(resolve(root, "libs"));
  await writeFile(resolve(root, "libs/Machine.library"), "local bytes");
  const libraries = await installLibraries({ Machine: { path: "libs/Machine.library" } }, root);
  expect(libraries[0]?.url).toBeUndefined();
  await writeFile(resolve(root, "libs/Machine.library"), "changed");
  await expect(
    installLibraries({ Machine: { path: "libs/Machine.library" } }, root, { frozen: true }),
  ).rejects.toThrow("missing or changed");
});
