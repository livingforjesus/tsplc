import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@tsplc/compiler";
import {
  normalizeModule,
  isVerifiedCore,
  type PlcModule,
  type Deployment,
} from "@tsplc/compiler/ir";
import { codesys, direct, emitCodesys, ioTargets, planCodesys } from "@tsplc/compiler/codesys";

const directories: string[] = [];
function frontend(
  source = "let running: BOOL = false; export function main(): void { if (Start && !running) { running = true; Motor = true; return; } Motor = false; }",
  declarations = "",
): PlcModule {
  const directory = mkdtempSync(join(tmpdir(), "tsplc-backend-"));
  directories.push(directory);
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({ include: ["*.ts"] }));
  writeFileSync(join(directory, "main.ts"), source);
  writeFileSync(
    join(directory, "io.d.ts"),
    `declare const Start: Input<BOOL>; declare let Motor: Output<BOOL>; ${declarations}`,
  );
  const result = analyze({
    tsconfig: join(directory, "tsconfig.json"),
    programs: { main: { module: "./main.ts", export: "main" } },
  });
  if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
  return result.module;
}
const deployment: Deployment = {
  tasks: [{ name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] }],
};
const options = () =>
  codesys({
    engineering: { kind: "v3.5" },
    profile: { directAddressing: "byte" },
    io: { Start: direct("%IX0.0"), Motor: direct("%QX0.0") },
    programNames: { main: "Main" },
  }).options;
function core() {
  const result = normalizeModule(frontend());
  if (!result.core) throw new Error(JSON.stringify(result.diagnostics));
  return result.core;
}
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("verified core", () => {
  test("detaches and freezes checked storage and bodies", () => {
    const input = frontend();
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error("Expected verified core");
    expect(isVerifiedCore(normalized.core)).toBe(true);
    expect(isVerifiedCore(structuredClone(normalized.core))).toBe(false);
    expect(Object.isFrozen(normalized.core.functions[0]?.body)).toBe(true);
    const initial = input.variables.find((item) => item.name === "running")?.initial;
    if (initial?.kind !== "bool") throw new Error("Expected initial state");
    initial.value = true;
    expect(normalized.core.variables.find((item) => item.name === "running")?.initial).toEqual({
      kind: "bool",
      value: false,
    });
  });
  test("verified REAL constants already carry their typed rounding", () => {
    const input = frontend(
      "const value: REAL = 1.1; export function main(): void { Motor = value === 1.1; }",
    );
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error("Expected rounded REAL core");
    const assignment = normalized.core.functions[0]?.body.at(-1);
    expect(assignment?.kind === "assign" ? assignment.value : undefined).toMatchObject({
      kind: "constant",
      value: { kind: "bool", value: true },
    });
    const value = input.variables.find((item) => item.name === "value");
    if (!value) throw new Error("Expected REAL constant");
    value.initial = { kind: "float", value: 1.1 };
    expect(normalizeModule(input).core).toBeUndefined();
  });
  test("rejects duplicate conflicting type entries", () => {
    const input = frontend();
    input.types = [...input.types, { id: "BOOL", kind: "integer", bits: 16, signed: true }];
    expect(normalizeModule(input).core).toBeUndefined();
  });
  test("rejects recursive calls, unknown storage and uninitialized local reads", () => {
    for (const kind of ["call", "unknown", "uninitialized"] as const) {
      const input = frontend(
        "export function main(): void { let flag: BOOL = Start; Motor = flag; }",
      );
      const fn = input.functions[0];
      if (!fn) throw new Error("Expected function");
      const body = [...fn.body];
      const assignment = body[0];
      if (assignment?.kind !== "assign") throw new Error("Expected assignment");
      if (kind === "call")
        assignment.value = {
          kind: "unary",
          operator: "not",
          type: "BOOL",
          span: assignment.span,
          operand: {
            kind: "call",
            function: fn.id,
            arguments: [],
            type: "BOOL",
            span: assignment.span,
          },
        };
      if (kind === "unknown") assignment.destination.root = "missing";
      if (kind === "uninitialized") body.shift();
      fn.body = body;
      const result = normalizeModule(input);
      expect(result.core).toBeUndefined();
      expect(result.diagnostics[0]?.code).toBe("PLC6001");
    }
  });
  test("proves local initialization across fallthrough branches", () => {
    const input = frontend(
      "export function main(): void { let value: BOOL = false; if (Start) value = true; Motor = value; }",
    );
    const fn = input.functions[0];
    if (!fn) throw new Error("Expected function");
    fn.body = fn.body.slice(1);
    expect(normalizeModule(input).core).toBeUndefined();
    const branch = fn.body[0];
    if (branch?.kind !== "if") throw new Error("Expected branch");
    branch.else = [{ kind: "return", span: branch.span }];
    expect(normalizeModule(input).diagnostics).toEqual([]);
  });
});

describe("CODESYS backend", () => {
  test("generated logical IO is published read-only at its allocated symbol paths", () => {
    const planned = planCodesys(core(), deployment, options());
    if (!planned.plan) throw new Error("Expected plan");
    const output = emitCodesys(planned.plan);
    const io = output.objects.find((object) => object.id === "io");
    expect(io?.declaration).toContain("{attribute 'linkalways'}");
    for (const [logical, symbol] of Object.entries(output.ioSymbols)) {
      expect(symbol).toBe(`GVL_IO.${logical}`);
      expect(io?.declaration).toContain(`{attribute 'symbol' := 'read'}\n    ${logical} : BOOL`);
      expect(io?.declaration).not.toContain(
        `{attribute 'symbol' := 'read'}\n    ${logical}_physical`,
      );
    }
    expect(Object.keys(output.ioSymbols).sort()).toEqual(["Motor", "Start"]);
    const source = output.artifacts.find((artifact) => artifact.path === io?.sourcePath);
    for (const mapping of output.mappings.filter((mapping) => mapping.path === io?.sourcePath))
      expect(source?.content.split("\n")[mapping.line - 1]).toMatch(/ : BOOL/);
  });

  test("local names cannot shadow qualified global objects", () => {
    const input = frontend(
      "export function main(): void { let GVL_IO: BOOL = Start; Motor = GVL_IO; }",
    );
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error("Expected core");
    const planned = planCodesys(normalized.core, deployment, options());
    if (!planned.plan) throw new Error("Expected plan");
    const output = emitCodesys(planned.plan);
    const fn = output.objects.find((item) => item.kind === "function");
    expect(fn?.declaration).toContain("GVL_IO_2 : BOOL");
    expect(fn?.implementation).toContain("GVL_IO.Start");
  });
  test("I/O dictionaries require own bindings for prototype-like logical names", () => {
    const input = frontend();
    input.variables.find((item) => item.name === "Start")!.name = "toString";
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error("Expected core");
    expect(
      planCodesys(normalized.core, deployment, {
        ...options(),
        io: { Motor: direct("%QX0.0") },
      }).diagnostics.some((item) => item.message.includes("Missing I/O binding")),
    ).toBe(true);
    const bound = planCodesys(normalized.core, deployment, {
      ...options(),
      io: { toString: direct("%IX0.0"), Motor: direct("%QX0.0") },
    });
    expect(bound.diagnostics).toEqual([]);
    input.programs = [{ ...input.programs[0]!, name: "constructor" }];
    const renamed = normalizeModule(input);
    if (!renamed.core) throw new Error("Expected core");
    const planned = planCodesys(
      renamed.core,
      { tasks: [{ ...deployment.tasks[0]!, programs: ["constructor"] }] },
      {
        ...options(),
        io: { toString: direct("%IX0.0"), Motor: direct("%QX0.0") },
        programNames: {},
      },
    );
    if (!planned.plan) throw new Error("Expected plan");
    expect(emitCodesys(planned.plan).objects.find((item) => item.kind === "program")?.name).toBe(
      "PRG_constructor",
    );
  });
  test("emits a complete object bundle with scan epilogue and qualified storage", () => {
    const result = planCodesys(core(), deployment, options());
    if (!result.plan) throw new Error(JSON.stringify(result.diagnostics));
    const output = emitCodesys(result.plan);
    expect(output.diagnostics).toEqual([]);
    const program = output.objects.find((item) => item.kind === "program");
    const fn = output.objects.find((item) => item.kind === "function");
    const io = output.objects.find((item) => item.id === "io");
    expect(program?.name).toBe("Main");
    expect(io?.declaration).toContain("AT %IX0.0 : BOOL");
    expect(io?.declaration).toContain("AT %QX0.0 : BOOL");
    expect(program?.implementation?.split("\n").filter(Boolean)).toHaveLength(3);
    expect(program?.implementation?.split("\n")[1]).toMatch(/plc_discard := .*\(\);/);
    expect(fn?.implementation).toContain("RETURN;");
    expect(fn?.implementation).not.toContain(" AND ");
    expect(output.artifacts.some((item) => item.path === "Main/declaration.st")).toBe(true);
    expect(
      output.mappings.some((item) => item.span.file.endsWith("main.ts") && item.span.line === 1),
    ).toBe(true);
    expect(output.mappings.some((item) => item.path.endsWith("declaration.st"))).toBe(true);
    for (const mapping of output.mappings) {
      const artifact = output.artifacts.find((item) => item.path === mapping.path);
      expect(artifact).toBeDefined();
      expect(mapping.line).toBeGreaterThan(0);
      expect(mapping.line).toBeLessThanOrEqual(artifact!.content.split("\n").length);
    }
  });
  test("rejects incomplete, unknown, overlapping, wrongly sized and wrong-region bindings", () => {
    const valid = options();
    for (const io of [
      { Start: valid.io.Start },
      { ...valid.io, Unknown: direct("%IX1.0") },
      { Start: direct("%QX0.1"), Motor: direct("%QX0.0") },
      { Start: { kind: "direct", address: "%IX0" }, Motor: valid.io.Motor },
      { Start: { kind: "direct", address: "%IX0.8" }, Motor: valid.io.Motor },
      { Start: direct("%IX2147483648.0"), Motor: valid.io.Motor },
    ]) {
      expect(planCodesys(core(), deployment, { ...valid, io }).plan).toBeUndefined();
    }
    const input = frontend("export function main(): void { Motor = Start; }");
    const extra = {
      ...input.variables.find((item) => item.name === "Start")!,
      id: "extra",
      name: "Extra",
    };
    input.variables = [...input.variables, extra];
    // The generated I/O table must also reject equivalent spellings of one input bit.
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error("Expected core");
    expect(
      planCodesys(normalized.core, deployment, {
        ...valid,
        io: { ...valid.io, Extra: direct("%IX00.0") },
      }).plan,
    ).toBeUndefined();
  });
  test("binds fixed arrays to consecutive I/O spans with layout-checked types", () => {
    const input = frontend(
      "export function main(): void { Motor = Start; Copy = copy(Data); Copy[0] = Tail; }",
      "declare const Data: Input<FixedArray<BYTE, 4>>; declare const Tail: Input<BYTE>; declare let Copy: Output<FixedArray<BYTE, 4>>;",
    );
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error(JSON.stringify(normalized.diagnostics));
    const checked = normalized.core;
    const valid = {
      ...options(),
      profile: { directAddressing: "byte" as const, numericAddressing: "byte" as const },
      io: {
        ...options().io,
        Data: { ...direct("%IB16"), type: "ARRAY[0..3] OF BYTE" },
        Tail: direct("%IB20"),
        Copy: direct("%QB8"),
      },
    };
    const planned = planCodesys(checked, deployment, valid);
    if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
    const output = emitCodesys(planned.plan);
    const io = output.objects.find((item) => item.id === "io");
    const program = output.objects.find((item) => item.kind === "program");
    expect(io?.declaration).toMatch(/Data_physical AT %IB16 : \S+;/);
    expect(io?.declaration).toMatch(/Copy_physical AT %QB8 : \S+;/);
    expect(program?.implementation).toContain("GVL_IO.Data := GVL_IO.Data_physical;");
    expect(program?.implementation).toContain("GVL_IO.Copy_physical := GVL_IO.Copy;");
    const rejected = (io: Record<string, { kind: "direct"; address: string; type?: string }>) =>
      planCodesys(checked, deployment, { ...valid, io: { ...valid.io, ...io } }).diagnostics.map(
        (item) => item.message,
      );
    // The four-byte span ends at %IB19, so a byte there overlaps it.
    expect(rejected({ Tail: direct("%IB19") })).toEqual([
      expect.stringContaining("Overlapping I/O address %IB19 with Data"),
    ]);
    expect(rejected({ Data: { ...direct("%IB16"), type: "ARRAY[0..2] OF BYTE" } })).toEqual([
      expect.stringContaining("I/O type mismatch for Data"),
    ]);
    expect(rejected({ Data: { ...direct("%IB16"), type: "ARRAY[0..3] OF WORD" } })).toEqual([
      expect.stringContaining("I/O type mismatch for Data"),
    ]);
    expect(rejected({ Data: direct("%IW16") })).toContainEqual(
      expect.stringContaining("Address size does not match Data"),
    );
  });
  test("binds I/O straight to fields of authored module storage", () => {
    const input = frontend(
      `export interface Card { Run: BOOL; Code: WORD; }
export let Cards: FixedArray<Card, 2, 1> = defaultValue<FixedArray<Card, 2, 1>>();
export let Data: FixedArray<BYTE, 4> = defaultValue<FixedArray<BYTE, 4>>();
export let Idle: BOOL = false;
export function main(): void { Motor = Start; Cards[1].Run = Cards[2].Run; Data[0] = Data[1]; }`,
    );
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error(JSON.stringify(normalized.diagnostics));
    const checked = normalized.core;
    const valid = {
      ...options(),
      profile: { directAddressing: "byte" as const, numericAddressing: "byte" as const },
      io: {
        ...options().io,
        "main.Cards[2].Run": direct("%IX1.0"),
        "main.Cards[1].Run": direct("%QX1.0"),
        // An EDS UINT flag word binds to a WORD field of the same width.
        "main.Cards[1].Code": { ...direct("%IW2"), type: "UINT" },
        "main.Data": { ...direct("%IB4"), type: "ARRAY[0..3] OF BYTE" },
      },
    };
    const planned = planCodesys(checked, deployment, valid);
    if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
    const output = emitCodesys(planned.plan);
    const io = output.objects.find((item) => item.id === "io")?.declaration ?? "";
    const scan = (output.objects.find((item) => item.kind === "program")?.implementation ?? "")
      .split("\n")
      .filter(Boolean);
    expect(io).toContain("main_Cards_2_Run_physical AT %IX1.0 : BOOL;");
    expect(io).toContain("main_Cards_1_Code_physical AT %IW2 : WORD;");
    expect(io).toMatch(/main_Data_physical AT %IB4 : \S+;/);
    const call = scan.findIndex((line) => line.startsWith("plc_discard"));
    const before = scan.slice(0, call),
      after = scan.slice(call + 1);
    expect(before).toContainEqual(
      expect.stringMatching(/\.Cards\[2\]\.Run := GVL_IO\.main_Cards_2_Run_physical;$/),
    );
    expect(before).toContainEqual(expect.stringMatching(/\.Data := GVL_IO\.main_Data_physical;$/));
    expect(after).toContainEqual(
      expect.stringMatching(/^GVL_IO\.main_Cards_1_Run_physical := .*\.Cards\[1\]\.Run;$/),
    );
    expect(output.ioSymbols["main.Cards[1].Run"]).toMatch(/\.Cards\[1\]\.Run$/);
    // Typegen turns these into the typed keys of HardwareIoMapping.
    const targets = ioTargets(checked);
    expect(targets).toEqual(
      expect.arrayContaining([
        { key: "Start", layout: "BOOL" },
        { key: "main.Cards[${number}].Run", layout: "BOOL" },
        { key: "main.Cards[${number}].Code", layout: "INT16" },
        { key: "main.Data", layout: "4xINT8" },
        { key: "main.Data[${number}]", layout: "INT8" },
      ]),
    );
    expect(targets.some((target) => target.key === "main.Cards[${number}]")).toBe(false);

    const rejected = (io: Record<string, { kind: "direct"; address: string; type?: string }>) =>
      planCodesys(checked, deployment, { ...valid, io: { ...valid.io, ...io } }).diagnostics.map(
        (item) => item.message,
      );
    expect(rejected({ "main.Cards[1].Nope": direct("%IX9.0") })).toEqual([
      expect.stringContaining("no field Nope"),
    ]);
    expect(rejected({ "main.Cards[3].Run": direct("%IX9.0") })).toEqual([
      expect.stringContaining("index 3 is outside 1..2"),
    ]);
    expect(rejected({ "Other.Cards[1].Run": direct("%IX9.0") })).toEqual([
      expect.stringContaining("no mutable module variable Other.Cards"),
    ]);
    expect(rejected({ "main.Cards[2]": direct("%IB8") })).toContainEqual(
      expect.stringContaining("overlaps the binding main.Cards[2].Run"),
    );
    expect(rejected({ "main.Cards[1].Code": { ...direct("%IW2"), type: "REAL" } })).toEqual([
      expect.stringContaining("I/O type mismatch for main.Cards[1].Code"),
    ]);
    expect(rejected({ "main.Idle": direct("%IX9.0") })).toEqual([
      expect.stringContaining("no scheduled program uses Idle"),
    ]);
  });
  test("rejects BOOL arrays because CODESYS does not bit-pack them at %IX", () => {
    const input = frontend(
      "export function main(): void { Motor = Flags[0]; }",
      "declare const Flags: Input<FixedArray<BOOL, 8>>;",
    );
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error(JSON.stringify(normalized.diagnostics));
    expect(
      planCodesys(normalized.core, deployment, {
        ...options(),
        io: { ...options().io, Flags: direct("%IX1.0") },
      }).diagnostics.map((item) => item.message),
    ).toEqual([expect.stringContaining("BOOL arrays are not bit-packed")]);
  });
  test("rejects task omissions, duplicate names, invalid TIME schedules and cross-task state", () => {
    const checked = core();
    for (const tasks of [
      [],
      [{ ...deployment.tasks[0]!, priority: 32 }],
      [{ ...deployment.tasks[0]!, intervalNanoseconds: "20000001" }],
      [...deployment.tasks, { ...deployment.tasks[0]!, name: "maintask" }],
    ])
      expect(planCodesys(checked, { tasks }, options()).plan).toBeUndefined();
    const input = frontend();
    input.programs = [
      ...input.programs,
      { id: "second", name: "second", entry: input.programs[0]!.entry },
    ];
    const normalized = normalizeModule(input);
    if (!normalized.core) throw new Error("Expected core");
    expect(
      planCodesys(
        normalized.core,
        {
          tasks: [
            ...deployment.tasks,
            {
              name: "OtherTask",
              intervalNanoseconds: "10000000",
              priority: 2,
              programs: ["second"],
            },
          ],
        },
        options(),
      ).diagnostics.some((item) => item.message.includes("shared across")),
    ).toBe(true);
  });
  test("validates names and detaches plans from caller-owned configuration", () => {
    const checked = core();
    for (const name of [
      "FUNCTION",
      "ACTION",
      "END_ACTION",
      "END_FUNCTION",
      "END_FUNCTION_BLOCK",
      "END_PROGRAM",
      "Main__Internal",
      "UNION",
      "END_UNION",
      "VAR_EXTERNAL",
      "VAR_STAT",
      "VAR_INST",
      "VAR_CONFIG",
      "VAR_GENERIC",
      "CONSTANT",
      "NON_RETAIN",
      "CONTINUE",
      "OVERRIDE",
      "BOOL_TO_DINT",
    ]) {
      expect(
        planCodesys(checked, deployment, { ...options(), programNames: { main: name } }).plan,
      ).toBeUndefined();
    }
    const config = options();
    const result = planCodesys(checked, deployment, config);
    if (!result.plan) throw new Error("Expected plan");
    config.io.Motor = direct("%QX1.0");
    expect(
      emitCodesys(result.plan).objects.find((item) => item.id === "io")?.declaration,
    ).toContain("%QX0.0");
  });
});
