import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const templates = join(import.meta.dir, "../examples/templates");

test("the shared virtual template matches its pinned project hash and Util reference", () => {
  const provenance: { project: string; sha256: string; addedLibrary: string } = JSON.parse(
    readFileSync(join(templates, "provenance.json"), "utf8"),
  );
  const hash = createHash("sha256")
    .update(readFileSync(join(templates, provenance.project)))
    .digest("hex");
  expect(hash).toBe(provenance.sha256);
  expect(provenance.addedLibrary).toBe("Util, 3.5.22.0 (System)");
});
