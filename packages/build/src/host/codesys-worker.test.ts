import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveContainerConfig } from "../../docker/config.ts";
import { createCodesysWorker } from "./codesys-worker.ts";

const execute = promisify(execFile);

const runWorker = async (
  stopBehavior: "hang" | "exit5" | "signal" | "clean",
  check: (worker: ReturnType<typeof createCodesysWorker>, directory: string) => Promise<void>,
  detachedOwner = false,
) => {
  const root = await mkdtemp(resolve(tmpdir(), "codesys-worker-stop-"));
  const directory = resolve(root, "output/.codesys/worker");
  try {
    await mkdir(resolve(root, "prefix/dosdevices"), { recursive: true });
    await symlink("/", resolve(root, "prefix/dosdevices/z:"));
    const executable = resolve(root, "CODESYS.exe");
    await writeFile(executable, "Fixture vendor executable, never run");
    const wine = resolve(root, "wine");
    await writeFile(
      wine,
      `#!${process.execPath}
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
if (process.argv[2] === "--version") process.exit(0);
writeFileSync("fixture.pid", String(process.pid));
setInterval(() => {
  if (!existsSync("request.json")) return;
  const command = JSON.parse(readFileSync("request.json", "utf8"));
  unlinkSync("request.json");
  writeFileSync(command.id + ".tmp", JSON.stringify({ id: command.id, ok: true }));
  renameSync(command.id + ".tmp", command.id + ".json");
  if (command.action === "stop") {
    console.log("Fixture acknowledged stop");
    if (${JSON.stringify(stopBehavior)} === "exit5") process.exit(5);
    if (${JSON.stringify(stopBehavior)} === "signal") process.kill(Number(readFileSync("launcher.pid", "utf8")), "SIGTERM");
    if (${JSON.stringify(stopBehavior)} === "clean") process.exit(0);
  }
}, 5);
`,
      { mode: 0o755 },
    );
    const config = resolveContainerConfig(
      {
        template: "fixture.project",
        outDir: "output",
        timeouts: { startup: 2000, stop: 150, terminate: 1000 },
      },
      resolve(root, "vplc.config.ts"),
    );
    if (!config.codesys.wine) throw new Error("Missing fixture Wine configuration");
    config.codesys.executable = executable;
    config.codesys.wine = { ...config.codesys.wine, prefix: resolve(root, "prefix"), binary: wine };
    if (detachedOwner) {
      const probe = resolve(root, "launch.ts");
      await writeFile(
        probe,
        `
import { writeFile } from "node:fs/promises";
import { createCodesysWorker } from ${JSON.stringify(fileURLToPath(new URL("./codesys-worker.ts", import.meta.url)))};
const session = await createCodesysWorker(${JSON.stringify(config)}).launch();
await writeFile(session.directory + "/launcher.pid", String(session.pid));
`,
      );
      // The subprocess exits while its unref'd launcher remains alive. It can
      // no longer observe or publish that launcher's eventual exit status.
      await execute(process.execPath, [probe], { timeout: 8000 });
    } else {
      const session = await createCodesysWorker(config).launch();
      await writeFile(resolve(directory, "launcher.pid"), String(session.pid));
    }
    // A fresh wrapper reads the saved session rather than owning the launcher.
    await check(createCodesysWorker(config), directory);
  } finally {
    const pid = Number(await readFile(resolve(directory, "fixture.pid"), "utf8").catch(() => "0"));
    if (pid > 0) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The fixture may have exited while its launcher was being reaped.
      }
    }
    await rm(root, { recursive: true, force: true });
  }
};

test.skipIf(process.platform === "win32")(
  "an acknowledged stop that hangs is terminated and reported as failure",
  async () => {
    await runWorker("hang", async (worker, directory) => {
      const stopped = worker.stop();
      await expect(stopped).rejects.toThrow("the worker required forced termination");
      await expect(stopped).rejects.toThrow(`See ${directory}/codesys.log`);
      expect(await readFile(resolve(directory, "codesys.log"), "utf8")).toContain(
        "CODESYS launcher exit status: SIGKILL",
      );
    });
  },
);

test.skipIf(process.platform === "win32").each(["clean", "exit5"] as const)(
  "a saved worker's %s exit after its launcher owner exits is reported as unknown",
  async (behavior) => {
    await runWorker(
      behavior,
      async (worker, directory) => {
        const stopped = worker.stop();
        await expect(stopped).rejects.toThrow("its exit status is unavailable");
        await expect(stopped).rejects.toThrow(`See ${directory}/codesys.log`);
      },
      true,
    );
  },
  10000,
);

test.skipIf(process.platform === "win32").each(["exit5", "signal"] as const)(
  "an acknowledged stop followed by %s is reported as failure",
  async (behavior) => {
    await runWorker(behavior, async (worker, directory) => {
      const stopped = worker.stop();
      await expect(stopped).rejects.toThrow(
        `CODESYS launcher exited with ${behavior === "exit5" ? "5" : "SIGTERM"}`,
      );
      await expect(stopped).rejects.toThrow(`See ${directory}/codesys.log`);
      // The persisted status also prevents a later stop from treating a failed session as clean.
      await expect(worker.stop()).rejects.toThrow("CODESYS launcher exited with");
    });
  },
);

test.skipIf(process.platform === "win32")(
  "a clean stop remains successful, including a later stop of the saved session",
  async () => {
    await runWorker("clean", async (worker, directory) => {
      await worker.stop();
      expect(await readFile(resolve(directory, "codesys.log"), "utf8")).toContain(
        "CODESYS launcher exit status: 0",
      );
      await worker.stop();
    });
  },
);
