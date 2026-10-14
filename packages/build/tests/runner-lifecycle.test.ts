import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildFailureFile, buildFailureSchema } from "../src/diagnostics.ts";

for (const scenario of ["success", "shutdown-fails", "both-fail"]) {
  test(`container build publication: ${scenario}`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "tsplc-runner-lifecycle-"));
    const operationId = randomUUID();
    try {
      const process = Bun.spawn(
        [
          Bun.which("bun")!,
          resolve(import.meta.dir, "fixtures/runner-lifecycle.ts"),
          root,
          scenario,
          operationId,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      if (scenario === "success") {
        expect(code).toBe(0);
        expect(JSON.parse(await readFile(resolve(root, "build.json"), "utf8"))).toEqual({
          mode: "build",
          application: "Application",
        });
        expect(stdout).toContain("Completed build");
        await expect(readFile(resolve(root, buildFailureFile))).rejects.toThrow();
      } else {
        expect(code).not.toBe(0);
        await expect(readFile(resolve(root, "build.json"))).rejects.toThrow();
        expect(stdout).not.toContain("Completed build");
        expect(stderr).toContain("Worker shutdown failed");
        const failure = buildFailureSchema.parse(
          JSON.parse(await readFile(resolve(root, buildFailureFile), "utf8")),
        );
        expect(failure.operationId).toBe(operationId);
        expect(failure.message).toContain("Worker shutdown failed");
        if (scenario === "both-fail") {
          expect(stderr).toContain("Original compiler failure");
          expect(failure.message).toContain("Original compiler failure");
          expect(failure.diagnostics).toHaveLength(1);
          expect(failure.diagnostics[0]?.text).toBe("Unknown fixture identifier");
          expect(failure.diagnostics[0]?.object?.applicationPath).toEqual(["controls", "Main"]);
          expect(failure.diagnostics[0]?.position).toBe("18446744073709551615");
        } else expect(failure.diagnostics).toEqual([]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
