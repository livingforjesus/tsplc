import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze } from "@vplc/compiler";
import { normalizeModule } from "@vplc/compiler/ir";
import { planCodesys, emitCodesys } from "@vplc/compiler/codesys";

const roots: string[] = [];
function compile(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "plcts-global-names-"));
  roots.push(root);
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ include: ["**/*.ts"] }));
  for (const [file, source] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  const frontend = analyze({
    tsconfig: join(root, "tsconfig.json"),
    programs: { main: { module: "./main.ts", export: "main" } },
  });
  if (!frontend.module) throw new Error(JSON.stringify(frontend.diagnostics));
  const normalized = normalizeModule(frontend.module);
  if (!normalized.core) throw new Error(JSON.stringify(normalized.diagnostics));
  return normalized.core;
}
const deployment = {
  tasks: [{ name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] }],
};
const options = {
  engineering: { kind: "v3.5" },
  profile: { directAddressing: "byte" },
  io: {},
  globalListNames: { LineIO: "LineIO" },
};
const globals =
  "interface Estop { Valid: BOOL; Pressed: BOOL } export const EmergencyStop01: Estop = defaultValue<Estop>();";
const main =
  'import * as LineIO from "./LineIO"; export function main(): void { LineIO.EmergencyStop01.Valid = true; }';
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("explicit global-list names preserve the symbolic device ABI and source mappings", () => {
  const core = compile({ "LineIO.ts": globals, "main.ts": main });
  const result = planCodesys(core, deployment, options);
  if (!result.plan) throw new Error(JSON.stringify(result.diagnostics));
  const bundle = emitCodesys(result.plan),
    list = bundle.objects.find((object) => object.kind === "globalList")!;
  expect(list.name).toBe("LineIO");
  expect(list.declaration).toContain("EmergencyStop01 : ");
  expect(list.declaration).not.toContain("plc_EmergencyStop01");
  expect(bundle.objects.find((object) => object.kind === "function")?.implementation).toContain(
    "LineIO.EmergencyStop01.Valid := TRUE;",
  );
  expect(
    bundle.mappings.some(
      (mapping) => mapping.path === "LineIO.st" && mapping.span.file.endsWith("/LineIO.ts"),
    ),
  ).toBe(true);
  const defaults = planCodesys(core, deployment, { ...options, globalListNames: {} });
  if (!defaults.plan) throw new Error(JSON.stringify(defaults.diagnostics));
  expect(
    emitCodesys(defaults.plan).objects.find((object) => object.kind === "globalList")?.name,
  ).toBe("GVL_LineIO_state");
});

test("ABI overrides reject unknown or ambiguous source groups and conflicting IEC object names", () => {
  const core = compile({ "LineIO.ts": globals, "main.ts": main });
  for (const value of [
    { ...options, globalListNames: { Missing: "DeviceIO" } },
    { ...options, programNames: { main: "LineIO" } },
    { ...options, globalListNames: { LineIO: "TASK" } },
  ])
    expect(planCodesys(core, deployment, value).plan).toBeUndefined();
  const mixed = compile({
    "LineIO.ts": `${globals} export const Capacity: UINT = 256;`,
    "main.ts": main,
  });
  expect(
    planCodesys(mixed, deployment, options).diagnostics.some((item) =>
      item.message.includes("found 2"),
    ),
  ).toBe(true);
  const duplicate = compile({
    "a/LineIO.ts": globals,
    "b/LineIO.ts": globals,
    "main.ts": "export function main(): void {}",
  });
  expect(
    planCodesys(duplicate, deployment, options).diagnostics.some((item) =>
      item.message.includes("found 2"),
    ),
  ).toBe(true);
});

test("preserved global variable names reject IEC keywords and case-insensitive collisions", () => {
  for (const declarations of [
    "export const Task: Estop = defaultValue<Estop>();",
    "export const run: Estop = defaultValue<Estop>(); export const Run: Estop = defaultValue<Estop>();",
  ]) {
    const core = compile({
      "LineIO.ts": `interface Estop { Valid: BOOL } ${declarations}`,
      "main.ts": "export function main(): void {}",
    });
    expect(planCodesys(core, deployment, options).plan).toBeUndefined();
  }
});

test("symbol publication is explicit and rejects unknown, duplicate, constant and ambiguous lists", () => {
  const core = compile({ "LineIO.ts": globals, "main.ts": main });
  const published = planCodesys(core, deployment, { ...options, publishGlobalLists: ["LineIO"] });
  if (!published.plan) throw new Error(JSON.stringify(published.diagnostics));
  const bundle = emitCodesys(published.plan);
  const list = bundle.objects.find((object) => object.kind === "globalList");
  if (!list) throw new Error("Expected the published global list.");
  expect(list.declaration).toStartWith("{attribute 'linkalways'}");
  expect(list.declaration).toContain("{attribute 'symbol' := 'readwrite'}");
  const mapped = bundle.mappings.find((mapping) => mapping.path === "LineIO.st");
  if (!mapped) throw new Error("Expected a mapped variable declaration.");
  expect(list.declaration.split("\n")[mapped.line - 1]).toContain("EmergencyStop01 :");

  const unpublished = planCodesys(core, deployment, options);
  if (!unpublished.plan) throw new Error(JSON.stringify(unpublished.diagnostics));
  expect(
    emitCodesys(unpublished.plan).objects.find((object) => object.kind === "globalList")
      ?.declaration,
  ).not.toContain("attribute 'symbol'");
  for (const publishGlobalLists of [["Missing"], ["LineIO", "LineIO"]]) {
    expect(planCodesys(core, deployment, { ...options, publishGlobalLists }).plan).toBeUndefined();
  }
  for (const files of <Record<string, string>[]>[
    { "LineIO.ts": "export const Number: INT = 1;", "main.ts": "export function main(): void {}" },
    {
      "a/LineIO.ts": globals,
      "b/LineIO.ts": globals,
      "main.ts": "export function main(): void {}",
    },
  ]) {
    expect(
      planCodesys(compile(files), deployment, { ...options, publishGlobalLists: ["LineIO"] }).plan,
    ).toBeUndefined();
  }
});

test("declarations omit redundant zero aggregates while preserving nonzero defaults and sparse enums", () => {
  const core = compile({
    "LineIO.ts": `
      enum Sparse { First = 5, Second = 7 }
      interface State { Flag: BOOL; Count: INT }
      interface SparseState { Tag: Sparse; Flag: BOOL }
      export let zeros: FixedArray<BYTE, 484> = defaultValue<FixedArray<BYTE, 484>>();
      export let state: State = defaultValue<State>();
      export let nonzero: State = { Flag: true, Count: 2 };
      export let sparse: SparseState = defaultValue<SparseState>();
      export let samples: FixedArray<INT, 2> = [0, 3];
      interface FloatState { Value: LREAL }
      export let signedZero: FloatState = { Value: -0 };
    `,
    "main.ts": "export function main(): void {}",
  });
  const planned = planCodesys(core, deployment, options);
  if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
  const list = emitCodesys(planned.plan).objects.find((object) => object.name === "LineIO");
  if (!list) throw new Error("Expected the global list.");
  const lines = list.declaration.split("\n");
  expect(lines.find((line) => line.includes("zeros :"))).not.toContain(":=");
  expect(lines.find((line) => line.includes("state :"))).not.toContain(":=");
  expect(lines.find((line) => line.includes("nonzero :"))).toContain(
    "Flag := TRUE, Count := INT#2",
  );
  expect(lines.find((line) => line.includes("sparse :"))).toContain(".First");
  expect(lines.find((line) => line.includes("samples :"))).toContain("[INT#0, INT#3]");
  expect(lines.find((line) => line.includes("signedZero :"))).toContain("Value := LREAL#-0.0");
});
