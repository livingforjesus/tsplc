import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

test.skipIf(process.platform === "win32")(
  "a failed operation retains its cause when worker shutdown also fails",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "codesys-controller-cleanup-"));
    try {
      const probe = resolve(root, "probe.ts");
      const modulePath = (path: string) =>
        JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
      await writeFile(
        probe,
        `
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveContainerConfig } from ${modulePath("../docker/config.ts")};
import { runControllerSession } from ${modulePath("./controller-session.ts")};
await mkdir("src");
await writeFile("src/Main.st", "PROGRAM Main\\nRETURN;\\nEND_PROGRAM");
await writeFile("template.project", "Fixture project, never opened");
const config = resolveContainerConfig({
  template: "template.project", outDir: "output",
  online: { gateway: { host: "fixture" }, device: { host: "fixture" } },
  timeouts: { startup: 2000, stop: 150, terminate: 1000 },
}, resolve("vplc.config.ts"));
await mkdir("prefix/dosdevices", { recursive: true });
await symlink("/", "prefix/dosdevices/z:");
config.codesys.wine.prefix = resolve("prefix");
config.codesys.executable = resolve("CODESYS.exe");
await writeFile(config.codesys.executable, "Fixture executable, never run");
config.codesys.wine.binary = resolve("wine");
await writeFile(config.codesys.wine.binary, ${JSON.stringify(`#!${process.execPath}
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
if (process.argv[2] === "--version") process.exit(0);
setInterval(() => {
  if (!existsSync("request.json")) return;
  const command = JSON.parse(readFileSync("request.json", "utf8"));
  unlinkSync("request.json");
  const response = { id: command.id, ok: command.action !== "online" };
  if (!response.ok) response.error = "Original boot path failure";
  writeFileSync(command.id + ".tmp", JSON.stringify(response));
  renameSync(command.id + ".tmp", command.id + ".json");
  // Keep running after stop acknowledgement to exercise forced shutdown.
}, 5);
`)}, { mode: 0o755 });
const pointer = resolve("output/.codesys/controller/current.json");
await mkdir(resolve(pointer, ".."), { recursive: true });
await writeFile(pointer, "Existing baseline pointer");
let failure;
try {
  await runControllerSession(config, "download", {
    imageId: "sha256:" + "0".repeat(64),
    operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
} catch (error) { failure = error; }
console.log(JSON.stringify({
  name: failure?.name,
  errors: failure instanceof AggregateError ? failure.errors.map(error => error.message) : [],
  pointer: await readFile(pointer, "utf8"),
}));
`,
      );
      const { stdout } = await execute(process.execPath, [probe], { cwd: root, timeout: 8000 });
      const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
      expect(result.name).toBe("AggregateError");
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toBe("Original boot path failure");
      expect(result.errors[1]).toContain("required forced termination");
      expect(result.errors[1]).toContain("/codesys.log");
      expect(result.pointer).toBe("Existing baseline pointer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  10000,
);
