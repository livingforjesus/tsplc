import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { build } from "esbuild";

// Bun's JavaScriptCore can optimize recursion that overflows V8 in VS Code.
// Exercise the actual server runtime as well as the fast in-process test runner.
const runInNode = async (body: string) => {
  const result = await build({
    stdin: {
      contents: `
import { parse } from "./src/language/parser";
import { Project } from "./src/language/project";
import { namedType } from "./src/language/model";
${body}
`,
      resolveDir: join(import.meta.dir, ".."),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("No Node test bundle was produced");
  return spawnSync("node", ["--input-type=commonjs"], {
    input: output.text,
    encoding: "utf8",
    timeout: 15_000,
  });
};

it("resolves a long acyclic alias chain without overflowing Node's stack", async () => {
  const result = await runInNode(`
const files = new Map();
for (let index = 0; index < 10_000; index++) {
	const uri = "file:///Alias" + index + ".st";
	const target = index === 9_999 ? "INT" : "Alias" + (index + 1);
	files.set(uri, parse(uri, "TYPE Alias" + index + " : " + target + "; END_TYPE"));
}
const resolved = new Project(files).resolveType(namedType("Alias0"));
if (resolved.kind !== "named" || resolved.name !== "INT") throw new Error("Alias chain did not resolve to INT");
`);
  expect({
    status: result.status,
    error: result.error?.message,
    stderr: result.stderr,
  }).toEqual({ status: 0, error: undefined, stderr: "" });
});

it("traverses deep inheritance without overflowing Node's stack", async () => {
  const result = await runInNode(`
const files = new Map();
for (let index = 0; index < 5_000; index++) {
	const uri = "file:///FB_" + index + ".st";
	const extendsClause = index === 4_999 ? "" : " EXTENDS FB_" + (index + 1);
	const members = index === 4_999 ? " VAR_INPUT Enabled : BOOL; END_VAR " : " ";
	files.set(uri, parse(uri, "FUNCTION_BLOCK FB_" + index + extendsClause + members + "END_FUNCTION_BLOCK"));
}
const project = new Project(files);
const first = project.global("FB_0");
const last = project.global("FB_4999");
if (!first || !last) throw new Error("Inheritance fixture symbols missing");
if (!project.allMembers(first).some(member => member.name === "Enabled")) throw new Error("Inherited member missing");
if (!project.isDescendant(first, last)) throw new Error("Base relationship missing");
`);
  expect({
    status: result.status,
    error: result.error?.message,
    stderr: result.stderr,
  }).toEqual({ status: 0, error: undefined, stderr: "" });
});
