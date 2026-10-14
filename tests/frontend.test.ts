import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@tsplc/compiler";

const directories: string[] = [];
function fixture(
  source: string,
  extra: Record<string, string> = {},
  compilerOptions: Record<string, unknown> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "tsplc-frontend-"));
  directories.push(directory);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { ...compilerOptions, strict: true }, include: ["*.ts"] }),
  );
  writeFileSync(join(directory, "main.ts"), source);
  writeFileSync(
    join(directory, "io.d.ts"),
    "declare const Start: Input<BOOL>;\ndeclare let Motor: Output<BOOL>;\n",
  );
  for (const [name, content] of Object.entries(extra))
    writeFileSync(join(directory, name), content);
  return analyze({
    tsconfig: join(directory, "tsconfig.json"),
    programs: { main: { module: "./main.ts", export: "main" } },
  });
}
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("TypeScript frontend", () => {
  test("builds target-neutral Boolean state and control flow with source locations", () => {
    const result = fixture(
      "let running: BOOL = false;\nexport function main(): void { if (Start && !running) running = true; else running = false; Motor = running; }",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.module?.variables.find((variable) => variable.name === "running")).toMatchObject({
      type: "BOOL",
      storage: "module",
      initial: { kind: "bool", value: false },
    });
    expect(result.module?.functions[0]?.body.map((statement) => statement.kind)).toEqual([
      "if",
      "assign",
    ]);
    expect(result.module?.functions[0]?.span.line).toBe(2);
  });
  test("resolves imported and reexported type aliases through symbols", () => {
    const result = fixture(
      'import type { Flag } from "./alias";\nlet value: Flag = false; export function main(): void { value = Start; Motor = value; }',
      {
        "types.ts": "export type LocalFlag = BOOL;",
        "alias.ts": 'export type { LocalFlag as Flag } from "./types";',
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.module?.variables.find((variable) => variable.name === "value")?.type).toBe(
      "BOOL",
    );
  });
  test("locals initialize on their invocation path", () => {
    const result = fixture(
      "export function main(): void { let temporary: BOOL = Start; Motor = temporary; }",
    );
    expect(result.module?.functions[0]?.locals[0]?.storage).toBe("local");
    expect(result.module?.functions[0]?.body[0]?.kind).toBe("assign");
  });
  test("retains TypeScript diagnostics without claiming valid PLC output", () => {
    const result = fixture('let value: BOOL = "bad"; export function main(): void {}');
    expect(result.module).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "TS2322")).toBe(true);
  });
  test("rejects async, host calls, dynamic arrays and executable module statements", () => {
    for (const source of [
      "export async function main() {}",
      "export function main(): void { console.log(1); }",
      "const dynamic = []; export function main(): void {}",
      "Motor = true; export function main(): void {}",
    ]) {
      const result = fixture(source);
      expect(result.module).toBeUndefined();
      expect(result.diagnostics.some((diagnostic) => diagnostic.origin === "plc")).toBe(true);
    }
  });
  test("rejects writes to inputs, arbitrary ambient globals and wrong I/O declarations", () => {
    expect(
      fixture("export function main(): void { Start = true; }").diagnostics.some(
        (item) => item.code === "PLC3002",
      ),
    ).toBe(true);
    expect(
      fixture("export function main(): void {}", {
        "external.d.ts": "declare let Unbound: BOOL;",
      }).diagnostics.some((item) => item.code === "PLC4002"),
    ).toBe(true);
    expect(
      fixture("declare const Wrong: Output<BOOL>; export function main(): void {}").module,
    ).toBeUndefined();
  });
  test("same-named declarations do not acquire SDK identity", () => {
    const result = fixture("export function main(): void {}", {
      "fake.d.ts": "export type Input<T> = T; export declare const Unbound: Input<BOOL>;",
    });
    expect(result.module).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "PLC4002")).toBe(true);
  });
  test("lexical shadowing uses distinct storage symbols", () => {
    const result = fixture(
      "let flag: BOOL = false; export function main(): void { let flag: BOOL = Start; Motor = flag; }",
    );
    expect(result.diagnostics).toEqual([]);
    const global = result.module?.variables.find((variable) => variable.name === "flag");
    const local = result.module?.functions[0]?.locals[0];
    if (!global || !local) throw new Error("Expected global and local storage");
    expect(global.id).not.toBe(local.id);
    const assignment = result.module?.functions[0]?.body[1];
    if (assignment?.kind !== "assign" || assignment.value.kind !== "load")
      throw new Error("Expected local load");
    expect(assignment.value.place.root).toBe(local.id);
  });
  test("checking cannot be disabled by config or source directives", () => {
    const source = "export function main(): void { let value: BOOL = value; Motor = value; }";
    expect(fixture(source, {}, { noCheck: true }).module).toBeUndefined();
    for (const directive of ["@ts-nocheck", "@ts-ignore", "@ts-expect-error"]) {
      const result = fixture(`// ${directive}\n${source}`);
      expect(result.module).toBeUndefined();
      expect(result.diagnostics.some((item) => item.code === "PLC1009")).toBe(true);
    }
    const imported = fixture(
      'import { remote } from "./state"; export function main(): void {\n// @ts-ignore\nremote = true; }',
      {
        "state.ts": "export let remote: BOOL = false;",
      },
    );
    expect(imported.diagnostics.some((item) => item.code === "PLC3002")).toBe(true);
  });
  test("runtime imports and reexports require implementation provenance", () => {
    const dependency = {
      "host.d.ts": "export declare const value: BOOL;",
      "host.js": "globalThis.executed = true;",
    };
    for (const statement of [
      'import "./host.js";',
      'import {} from "./host.js";',
      'import { value } from "./host.js";',
      'export {} from "./host.js";',
      'export { value } from "./host.js";',
    ]) {
      const result = fixture(
        `${statement} export function main(): void { Motor = false; }`,
        dependency,
      );
      expect(result.module).toBeUndefined();
      expect(result.diagnostics.some((item) => item.code === "PLC1008")).toBe(true);
    }
    expect(
      fixture(
        'import type { Flag } from "./types"; let value: Flag = false; export function main(): void { Motor = value; }',
        {
          "types.d.ts": "export type Flag = BOOL;",
        },
      ).diagnostics,
    ).toEqual([]);
    expect(
      fixture('import "./io"; export function main(): void { Motor = Start; }').diagnostics,
    ).toEqual([]);
  });
  test("rejects unresolved entry exports and state without initialization", () => {
    expect(
      fixture("export function other(): void {}").diagnostics.some(
        (item) => item.code === "PLC4001",
      ),
    ).toBe(true);
    expect(
      fixture("let state: BOOL; export function main(): void { Motor = state; }").diagnostics.some(
        (item) => item.code === "PLC3001",
      ),
    ).toBe(true);
  });
});
