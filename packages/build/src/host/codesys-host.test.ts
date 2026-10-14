import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveContainerConfig } from "../../docker/config.ts";
import { createCodesysHost } from "./codesys-host.ts";

test.skipIf(process.platform === "win32").each([0, 5])(
  "a launcher retains diagnostics and its exit status %i",
  async (status) => {
    const root = await mkdtemp(resolve(tmpdir(), "codesys-host-diagnostics-"));
    try {
      const directory = resolve(root, "worker");
      await mkdir(directory);
      await mkdir(resolve(root, "dosdevices"));
      await symlink("/", resolve(root, "dosdevices/z:"));
      const executable = resolve(root, "CODESYS.exe");
      await writeFile(executable, "fixture, never executed");
      await writeFile(resolve(directory, "worker.py"), "fixture, never executed");
      const wine = resolve(root, "wine");
      await writeFile(
        wine,
        '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\n' +
          `echo "Fixture Wine debug: $WINEDEBUG"\necho "Fixture launcher finished" >&2\nexit ${status}\n`,
        { mode: 0o755 },
      );
      const config = resolveContainerConfig(
        { template: "fixture.project" },
        resolve(root, "config.ts"),
      );
      if (!config.codesys.wine) throw new Error("Missing fixture Wine configuration");
      config.codesys.executable = executable;
      config.codesys.wine = { ...config.codesys.wine, prefix: root, binary: wine };
      const host = createCodesysHost(config);
      const pid = await host.startWorker(directory);
      const log = resolve(directory, "codesys.log");
      let text = "";
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        text = await readFile(log, "utf8");
        if (text.includes(`CODESYS launcher exit status: ${status}`)) break;
        await Bun.sleep(10);
      }
      expect(text).toContain("Fixture Wine debug: -all,err+seh");
      expect(text).toContain("Fixture launcher finished");
      expect(text).toContain(`CODESYS launcher exit status: ${status}`);
      expect(await host.exitStatus(directory, pid)).toEqual({ pid, code: status, signal: null });
      expect(await host.exitStatus(directory, pid + 1)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "a successful launcher cannot hide a Rosetta helper assertion",
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "codesys-host-rosetta-"));
    try {
      const config = resolveContainerConfig(
        { template: "fixture.project" },
        resolve(directory, "config.ts"),
      );
      const host = createCodesysHost(config);
      const pid = 42;
      await writeFile(
        resolve(directory, "launcher-exit.json"),
        JSON.stringify({ pid, code: 0, signal: null }),
      );
      const assertion =
        "assertion failed [x86_avx_state_ptr->xsave_header.xfeatures == kSupportedXFeatureBits]: \n" +
        "(ThreadContextSignals.cpp:414 rt_sigreturn)\nCODESYS launcher exit status: 0\n";
      for (const text of [
        assertion,
        assertion.replaceAll("\n", "\r\r\n"),
        "\u001b[?25h\u001b[?25l" + assertion.replaceAll("\n", "\r\n"),
      ]) {
        await writeFile(resolve(directory, "codesys.log"), text);
        await expect(host.exitStatus(directory, pid)).rejects.toThrow("Wine translation aborted");
      }
      // An unrelated launcher's old receipt is never evidence about this process.
      expect(await host.exitStatus(directory, pid + 1)).toBeUndefined();
      await writeFile(resolve(directory, "codesys.log"), "Compiler diagnostic: assertion failed\n");
      expect(await host.exitStatus(directory, pid)).toEqual({ pid, code: 0, signal: null });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
