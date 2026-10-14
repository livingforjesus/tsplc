import { execFile, spawn } from "node:child_process";
import { appendFileSync, constants, renameSync, writeFileSync } from "node:fs";
import { access, open, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ResolvedConfig } from "../config";
import { codesysCommand, codesysCommandFilename, getHostCommand } from "./codesys-command";
import { toWindowsPath } from "./windows-path";

const execute = promisify(execFile);
const exitSchema = z.object({
  pid: z.int().positive(),
  code: z.int().nullable(),
  signal: z.string().nullable(),
});

export const createCodesysHost = (config: ResolvedConfig) => {
  const native = process.platform === "win32";
  const { codesys, timeouts } = config;
  const hostEnv = {
    // Child processes inherit OS settings such as PATH and DISPLAY.
    ...process.env,
    WINEPREFIX: codesys.wine?.prefix,
    WINEDEBUG: codesys.wine?.debug,
    CODESYS_BUILD_NATIVE_EXIT: String(codesys.wine?.nativeExit ?? false),
  };

  /** Start the headless worker script; its launcher outlives this CLI process. */
  const startWorker = async (directory: string) => {
    if (!native) {
      await execute(codesys.wine?.binary ?? "wine", ["--version"], {
        env: hostEnv,
        timeout: timeouts.hostCommand,
      }).catch((cause: unknown) => {
        throw new Error("Wine is missing. Install Wine; Winetricks alone cannot run CODESYS", {
          cause,
        });
      });
      const candidates = (process.env["PATH"] ?? "").split(delimiter);
      const available = await Promise.all(
        candidates.map((path) =>
          access(resolve(path, "script"), constants.X_OK).then(
            () => true,
            () => false,
          ),
        ),
      );
      if (!available.some(Boolean)) {
        throw new Error(
          "Headless Wine builds require the script utility (install util-linux on Linux)",
        );
      }
    }
    await writeFile(resolve(directory, codesysCommandFilename), codesysCommand);
    const env = {
      ...hostEnv,
      CODESYS_BUILD_SCRIPT: await toWindowsPath(resolve(directory, "worker.py"), codesys.wine),
      CODESYS_BUILD_SESSION: await toWindowsPath(directory, codesys.wine),
      CODESYS_BUILD_EXE: await toWindowsPath(codesys.executable, codesys.wine),
      CODESYS_BUILD_PROFILE: codesys.profile,
    };
    const launcher = getHostCommand(codesys);
    const logPath = resolve(directory, "codesys.log");
    const exitPath = resolve(directory, "launcher-exit.json");
    await rm(exitPath, { force: true });
    const log = await open(logPath, "w");
    try {
      const child = spawn(launcher.executable, launcher.args, {
        cwd: directory,
        detached: true,
        windowsHide: true,
        env,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.once("exit", (code, signal) => {
        try {
          appendFileSync(logPath, `\nCODESYS launcher exit status: ${signal ?? code}\n`);
        } catch {
          // A failed diagnostic write must preserve the original process failure.
        }
        try {
          const temporary = `${exitPath}.${child.pid}.tmp`;
          writeFileSync(temporary, JSON.stringify({ pid: child.pid, code, signal }));
          renameSync(temporary, exitPath);
        } catch {
          // The log still records the exit if the optional status file cannot be published.
        }
      });
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      if (!child.pid) {
        throw new Error("CODESYS launcher has no process ID");
      }
      child.unref();
      return child.pid;
    } finally {
      await log.close();
    }
  };

  return {
    exitStatus: async (directory: string, pid: number) => {
      const path = resolve(directory, "launcher-exit.json");
      const value = await readFile(path, "utf8").catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
        throw error;
      });
      if (value === undefined) return;
      const status = exitSchema.parse(JSON.parse(value));
      if (status.pid !== pid) return;
      if (!native && status.code === 0 && status.signal === null) {
        const logPath = resolve(directory, "codesys.log");
        const log = (await readFile(logPath, "utf8"))
          // Terminal color escapes must not hide a native assertion signature.
          // eslint-disable-next-line no-control-regex
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/\r/g, "");
        // A Wine helper can abort under Rosetta while the main launcher returns 0.
        // That command still failed; publishing its artifacts would hide the fault.
        const assertion =
          /^assertion failed \[[^\n]+\]:[^\n]*\n[ \t]*\(ThreadContext[^\n]*\)/m.exec(log);
        if (assertion) {
          throw new Error(
            `Wine translation aborted: ${assertion[0].replace(/\s+/g, " ")}. See ${logPath}`,
          );
        }
      }
      return status;
    },
    startWorker,
    terminate: async (pid: number) => {
      if (native) {
        await execute("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
          env: hostEnv,
          timeout: timeouts.hostCommand,
        });
        return;
      }
      process.kill(-pid, "SIGKILL");
    },
  };
};
