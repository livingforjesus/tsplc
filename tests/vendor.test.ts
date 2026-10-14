import { expect, test } from "bun:test";
import { CodesysCompilerError, resolveConfig, type CodesysCompilerDiagnostic } from "@vplc/build";
import { diagnoseCodesys } from "@vplc/compiler/codesys";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withWorkerShutdown } from "../packages/build/src/host/codesys-worker.ts";

const span = { file: "source/control.ts", start: 10, end: 20, line: 2, column: 3 };
type Bundle = Parameters<typeof diagnoseCodesys>[1];
const bundle: Bundle = {
  objects: [
    {
      id: "main",
      kind: "function" as const,
      name: "plc_F_main",
      sourcePath: "plc_F_main/declaration.st",
      declaration: "FUNCTION plc_F_main : BOOL",
      implementation: "x := y;",
    },
    {
      id: "state",
      kind: "globalList",
      name: "plc_GVL_state",
      sourcePath: "plc_GVL_state.st",
      declaration: "VAR_GLOBAL",
    },
  ],
  mappings: [
    { path: "plc_F_main/implementation.st", line: 1, span },
    { path: "plc_F_main/declaration.st", line: 3, span },
    { path: "plc_GVL_state.st", line: 3, span },
  ],
};
function vendor(positionText: string | null, name = "plc_F_main"): CodesysCompilerDiagnostic {
  return {
    text: "Identifier is not defined",
    severity: "Error",
    category: "compiler",
    project: "private.project",
    object: { name, guid: "vendor-id", isApplicationChild: true, path: ["Application", name] },
    position: "18446744073709551615",
    positionText,
    positionOffset: 9,
    length: 12,
    prefix: "C",
    number: 46,
  };
}
function diagnose(item: CodesysCompilerDiagnostic, input: Bundle = bundle) {
  return diagnoseCodesys(
    new Error("Build failed; inspect error.txt and codesys.log", {
      cause: new CodesysCompilerError("Compiler failed", [item]),
    }),
    input,
  )[0]!;
}
test("vendor implementation and declaration lines map exact generated locations to source", () => {
  for (const [text, name, path] of [
    ["Line 1, Column 1 (Impl)", "plc_F_main", "plc_F_main/implementation.st:1:1"],
    ["Line 3 (Decl)", "plc_F_main", "plc_F_main/declaration.st:3"],
    ["Line 3 (Decl)", "plc_GVL_state", "plc_GVL_state.st:3"],
  ] as const) {
    const result = diagnose(vendor(text, name));
    expect(result.span).toEqual(span);
    expect(result.notes).toContain(`Generated ST: ${path}`);
    expect(result.notes?.[0]).toContain("error.txt");
    expect(result.notes?.at(-1)).toContain("18446744073709551615");
  }
});
test("unknown vendor text, objects and unmapped wrapper lines retain raw context without inventing spans", () => {
  for (const item of [
    vendor(null),
    vendor("uninterpreted vendor context"),
    vendor("Line 2, Column 1 (Impl)"),
    vendor("Line 1, Column 1 (Impl)", "TemplateObject"),
    vendor("Line 3 (Impl)", "plc_GVL_state"),
  ]) {
    const result = diagnose(item);
    expect(result.span).toBeUndefined();
    expect(result.message).toBe(item.text);
    expect(result.notes?.at(-1)).toContain(JSON.stringify(item));
  }
});
test("ordinary engineering failures retain the cause chain and actionable message", () => {
  expect(
    diagnoseCodesys(new Error("Build failed", { cause: new Error("Template missing") }), bundle),
  ).toEqual([
    {
      origin: "vendor",
      code: "PLC8001",
      severity: "error",
      message: "Build failed",
      notes: ["Template missing"],
    },
  ]);
});

test("a compiler location remains mapped when worker shutdown also fails", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "codesys-shutdown-diagnostics-"));
  try {
    const primary = new CodesysCompilerError("Compiler failed", [
      vendor("Line 1, Column 1 (Impl)"),
    ]);
    const shutdown = new Error("Worker stop timed out; inspect codesys.log");
    const config = resolveConfig({ template: "fixture.project" }, resolve(root, "config.ts"));
    let failure: unknown;
    try {
      await withWorkerShutdown(
        config,
        {
          stop: async () => {
            throw shutdown;
          },
        },
        () => Promise.reject(primary),
      );
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    const mapped = diagnoseCodesys(
      new Error("Docker build failed", { cause: failure }),
      bundle,
    )[0]!;
    expect(mapped.span).toEqual(span);
    expect(mapped.message).toBe("Identifier is not defined");
    expect(mapped.notes).toContain("Generated ST: plc_F_main/implementation.st:1:1");
    expect(mapped.notes?.at(-1)).toContain("18446744073709551615");
    if (!(failure instanceof AggregateError)) throw new Error("Expected both lifecycle failures");
    expect(failure.cause).toBe(primary);
    expect(failure.errors).toEqual([primary, shutdown]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-leaf template folders and nested objects are never attributed to root generated objects", () => {
  const item = vendor("Line 1, Column 1 (Impl)");
  const nested = {
    ...item,
    object: {
      ...item.object!,
      isApplicationChild: false,
      path: ["Device", "Plc Logic", "Application", "TemplateFolder", "plc_F_main"],
    },
  };
  expect(diagnose(nested).span).toBeUndefined();
  const unknown = { ...item, object: { ...item.object!, isApplicationChild: null } };
  expect(diagnose(unknown).span).toBeUndefined();
});

test("verified nested POU declaration and implementation map their emitted source paths", () => {
  const input: Bundle = {
    objects: [{ ...bundle.objects[0]!, sourcePath: "controls/pumps/plc_F_main/declaration.st" }],
    mappings: [
      { path: "controls/pumps/plc_F_main/declaration.st", line: 3, span },
      { path: "controls/pumps/plc_F_main/implementation.st", line: 1, span },
    ],
  };
  for (const [position, sourcePath] of [
    ["Line 3 (Decl)", "controls/pumps/plc_F_main/declaration.st:3"],
    ["Line 1, Column 4 (Impl)", "controls/pumps/plc_F_main/implementation.st:1:4"],
  ]) {
    const item = vendor(position!);
    const result = diagnose(
      {
        ...item,
        object: {
          ...item.object!,
          path: ["Device", "Plc Logic", "CustomApplication", "controls", "pumps", "plc_F_main"],
          isApplicationChild: false,
          applicationPath: ["controls", "pumps", "plc_F_main"],
        },
      },
      input,
    );
    expect(result.span).toEqual(span);
    expect(result.notes).toContain(`Generated ST: ${sourcePath}`);
  }
});

test("nested DUT and GVL declarations map complete files rather than split POU paths", () => {
  for (const kind of ["dataType", "globalList"] as const) {
    const name = kind === "dataType" ? "T_Pump" : "GVL_Pump";
    const sourcePath = `controls/types/${name}.st`;
    const input: Bundle = {
      objects: [{ id: name, kind, name, sourcePath, declaration: "declaration" }],
      mappings: [{ path: sourcePath, line: 3, span }],
    };
    const item = vendor("Line 3 (Decl)", name);
    const object = {
      ...item.object!,
      path: ["Device", "CustomApplication", "controls", "types", name],
      isApplicationChild: false,
      applicationPath: ["controls", "types", name],
    };
    expect(diagnose({ ...item, object }, input).span).toEqual(span);
    expect(
      diagnose({ ...item, object, positionText: "Line 3 (Impl)" }, input).span,
    ).toBeUndefined();
  }
});

test("full application-relative identity rejects template suffix collisions and other applications", () => {
  const input: Bundle = {
    objects: [{ ...bundle.objects[0]!, sourcePath: "controls/plc_F_main/declaration.st" }],
    mappings: [{ path: "controls/plc_F_main/implementation.st", line: 1, span }],
  };
  const item = vendor("Line 1 (Impl)");
  for (const object of [
    {
      ...item.object!,
      isApplicationChild: false,
      path: ["Device", "Application", "TemplateFolder", "controls", "plc_F_main"],
      applicationPath: ["TemplateFolder", "controls", "plc_F_main"],
    },
    {
      ...item.object!,
      isApplicationChild: false,
      path: ["Device", "OtherApplication", "controls", "plc_F_main"],
    },
    {
      ...item.object!,
      isApplicationChild: false,
      path: ["Device", "Application", "controls", "DifferentObject"],
      applicationPath: ["controls", "plc_F_main"],
    },
  ]) {
    const result = diagnose({ ...item, object }, input);
    expect(result.span).toBeUndefined();
    expect(result.notes?.at(-1)).toContain(JSON.stringify(object));
  }
});

test("verified root identities reject contradictory, missing and ambiguous emitted paths", () => {
  const item = vendor("Line 1 (Impl)");
  const root = { ...item.object!, applicationPath: ["plc_F_main"] };
  expect(diagnose({ ...item, object: root }).span).toEqual(span);
  for (const object of [
    { ...root, isApplicationChild: false },
    { ...root, isApplicationChild: null },
    { ...root, applicationPath: null },
    { ...root, path: ["plc_F_main"] },
    { ...root, path: ["Application", "DifferentObject"] },
    { ...root, applicationPath: ["OtherFolder", "plc_F_main"] },
  ]) {
    expect(diagnose({ ...item, object }).span).toBeUndefined();
  }
  expect(
    diagnose(
      { ...item, object: root },
      { ...bundle, objects: [...bundle.objects, { ...bundle.objects[0]!, id: "duplicate" }] },
    ).span,
  ).toBeUndefined();
  expect(
    diagnose(
      { ...item, object: root },
      { ...bundle, mappings: [...bundle.mappings, bundle.mappings[0]!] },
    ).span,
  ).toBeUndefined();
});

test("equal leaf names in distinct emitted folders map only the matching source identity", () => {
  const other = { ...span, file: "source/other.ts" };
  const input: Bundle = {
    objects: [
      { ...bundle.objects[0]!, sourcePath: "controls/plc_F_main/declaration.st" },
      { ...bundle.objects[0]!, id: "other", sourcePath: "other/plc_F_main/declaration.st" },
    ],
    mappings: [
      { path: "controls/plc_F_main/implementation.st", line: 1, span },
      { path: "other/plc_F_main/implementation.st", line: 1, span: other },
    ],
  };
  const item = vendor("Line 1 (Impl)");
  expect(
    diagnose(
      {
        ...item,
        object: {
          ...item.object!,
          isApplicationChild: false,
          path: ["Application", "other", "plc_F_main"],
          applicationPath: ["other", "plc_F_main"],
        },
      },
      input,
    ).span,
  ).toEqual(other);
});
