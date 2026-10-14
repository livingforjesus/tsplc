import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@vplc/compiler";
import { normalizeModule, type PlcModule, type VerifiedCoreModule } from "@vplc/compiler/ir";
import { codesys, direct, planCodesys, emitCodesys } from "@vplc/compiler/codesys";
import { machine } from "./support/machine.ts";

const directories: string[] = [];
function frontend(source: string, extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "plcts-aggregate-"));
  directories.push(root);
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: {
          "@vplc/compiler/types": [join(import.meta.dir, "../packages/compiler/types/index.d.ts")],
          "@vplc/compiler/math": [join(import.meta.dir, "../packages/compiler/stdlib/math.ts")],
        },
      },
      include: ["*.ts"],
    }),
  );
  writeFileSync(
    join(root, "io.d.ts"),
    "declare const Start: Input<BOOL>; declare let Motor: Output<BOOL>;",
  );
  writeFileSync(join(root, "main.ts"), source);
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(root, name), text);
  return analyze({
    tsconfig: join(root, "tsconfig.json"),
    programs: { main: { module: "./main.ts", export: "main" } },
  });
}
function compile(source: string, extra?: Record<string, string>) {
  const result = frontend(source, extra);
  return result.module ? normalizeModule(result.module) : { diagnostics: result.diagnostics };
}
function checked(source: string, extra?: Record<string, string>): VerifiedCoreModule {
  const result = compile(source, extra);
  if (!result.core) throw new Error(JSON.stringify(result.diagnostics));
  return result.core;
}
function planned(core: VerifiedCoreModule) {
  return planCodesys(
    core,
    {
      tasks: [
        { name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] },
      ],
    },
    codesys({
      engineering: { kind: "v3.5" },
      profile: { directAddressing: "byte" },
      io: { Start: direct("%IX0.0"), Motor: direct("%QX0.0") },
    }).options,
  );
}
function emitted(core: VerifiedCoreModule) {
  const result = planned(core);
  if (!result.plan) throw new Error(JSON.stringify(result.diagnostics));
  return emitCodesys(result.plan);
}
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

test("const record bindings have mutable fields; indexed static storage retains its lower bound", () => {
  const core = checked(`interface Card { Enabled: BOOL; Output: { Asserted: BOOL } }
    const cards: FixedArray<Card, 3, 1> = defaultValue<FixedArray<Card, 3, 1>>();
    export function main(): void { for(let i: UINT = 1; i <= 3; i++) { cards[i].Output.Asserted = i > 1; } Motor = cards[2].Output.Asserted; }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("cards")).toEqual([
    { Enabled: false, Output: { Asserted: false } },
    { Enabled: false, Output: { Asserted: true } },
    { Enabled: false, Output: { Asserted: true } },
  ]);
  expect(runtime.get("Motor")).toBe(true);
  const output = emitted(core);
  expect(output.objects.some((object) => object.declaration.includes("ARRAY[1..3]"))).toBe(true);
  expect(
    output.objects.some((object) => object.implementation?.includes(".Output.Asserted :=")),
  ).toBe(true);
});

test("aggregate copy snapshots record and array values while implicit aliases are rejected", () => {
  const core = checked(`interface State { Active: BOOL; Bytes: FixedArray<BYTE, 2> }
    let source: State = { Active: true, Bytes: [1, 2] }; let destination: State = defaultValue<State>();
    export function main(): void { destination = copy(source); source.Bytes[0] = 9; source.Active = false; Motor = destination.Active && destination.Bytes[0] === 1; }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
  expect(runtime.get("destination")).toEqual({ Active: true, Bytes: [1n, 2n] });
  for (const body of [
    "const alias = source;",
    "destination = source;",
    "destination.Bytes = source.Bytes;",
  ])
    expect(
      compile(
        `interface State { Bytes: FixedArray<BYTE, 2> } let source: State = defaultValue<State>(); let destination: State = defaultValue<State>(); export function main(): void { ${body} }`,
      ).core,
    ).toBeUndefined();
});

test("dynamic record construction evaluates fields in order and copies readonly value parameters", () => {
  const core = checked(`interface State { Active: BOOL; Count: UINT }
    let state: State = { Active: false, Count: 1 }; let result: State = defaultValue<State>();
    function mutate(): UINT { state.Count = 2; return 3; }
    function make(value: State): State { return { Active: true, Count: value.Count }; }
    export function main(): void { result = { Active: state.Active, Count: mutate() }; const previous = make(state); state.Count = 4; Motor = !result.Active && result.Count === 3 && previous.Count === 2; }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
  expect(
    compile(
      "interface State { Active: BOOL } function bad(value: State): void { value.Active = true; } export function main(): void {}",
    ).core,
  ).toBeUndefined();
  expect(emitted(core).diagnostics).toEqual([]);
});

test("record paths imported through namespaces resolve to one module storage", () => {
  const core = checked(
    'import * as Shared from "./shared"; export function main(): void { Shared.state.Active = true; Motor = Shared.read(); }',
    {
      "shared.ts":
        "interface State { Active: BOOL } export const state: State = defaultValue<State>(); export function read(): BOOL { return state.Active; }",
    },
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
  expect(core.variables.filter((variable) => variable.name === "state")).toHaveLength(1);
});

test("readonly paths, incomplete layouts and unproved indexes fail compilation", () => {
  for (const source of [
    "interface R { readonly Flag: BOOL } const r: R = { Flag: false }; function bad(): void { r.Flag = true; }",
    "interface R { Flag: BOOL; Count: UINT } const r: R = { Flag: true };",
    "interface R { Maybe?: BOOL } const r: R = defaultValue<R>();",
    "interface R { Next: R } const r: R = defaultValue<R>();",
    "let a: FixedArray<BOOL, 2> = [true];",
    "let a: FixedArray<BOOL, 2> = [true, false]; let i: UINT = 0; function bad(): void { Motor = a[i]; }",
    "let a: FixedArray<BOOL, 2, 1> = [true, false]; function bad(): void { Motor = a[0]; }",
    "let a: FixedArray<BOOL, 1000000> = defaultValue<FixedArray<FixedArray<BOOL, 2>, 1000000>>();",
  ])
    expect(compile(`${source} export function main(): void {}`).core).toBeUndefined();
});

test("enum membership remains distinct from integers and unrelated enums", () => {
  const core = checked(`enum Route { Stop = 0, Left = 3, Right = 7 } let route: Route = Route.Stop;
    function choose(): Route { return Route.Left; }
    export function main(): void { route = choose(); switch(route) { case Route.Left: Motor = true; break; default: Motor = false; break; } }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("route")).toBe(3n);
  expect(runtime.get("Motor")).toBe(true);
  const output = emitted(core);
  expect(
    output.objects.some(
      (object) =>
        object.declaration.includes(") DINT;") &&
        object.declaration.includes("{attribute 'strict'}"),
    ),
  ).toBe(true);
  expect(output.objects.some((object) => object.implementation?.includes(".plc_Left"))).toBe(true);
  for (const text of [
    "let route: Route = 3;",
    "let other: DINT = Route.Left;",
    "function bad(): void { route = route + 1; }",
    "enum Other { A = 3 } function bad(): void { route = Other.A; }",
  ])
    expect(
      compile(
        "enum Route { Stop = 0, Left = 3 } let route: Route = Route.Stop; " +
          text +
          " export function main(): void {}",
      ).core,
    ).toBeUndefined();
});

test("bounded strings validate bytes and backend capability, escaping dollar, quote and controls", () => {
  const core = checked(
    'let text: STRING<10> = "a$\'\\n"; let wide: WSTRING<10> = "b"; export function main(): void { Motor = text === "a$\'\\n"; }',
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
  const output = emitted(core);
  expect(output.objects.some((object) => object.declaration.includes("'a$$$'$0A'"))).toBe(true);
  expect(
    compile('let text: STRING<1> = "é"; export function main(): void {}').core,
  ).toBeUndefined();
  expect(
    compile('let text: STRING<2> = "\\0"; export function main(): void {}').core,
  ).toBeUndefined();
  const nonAscii = checked('let text: STRING<2> = "é"; export function main(): void {}');
  expect(planned(nonAscii).diagnostics.some((item) => item.message.includes("UTF8"))).toBe(true);
  const astral = checked('let text: WSTRING<2> = "😀"; export function main(): void {}');
  expect(planned(astral).diagnostics.some((item) => item.message.includes("UCS-2"))).toBe(true);
});

test("explicit generic function and record specialization keeps concrete widths and separate locals", () => {
  const core = checked(`interface Box<T> { Value: T }
    type Cards<T, N extends number> = FixedArray<Box<T>, N, 1>;
    let small: Box<UINT> = defaultValue<Box<UINT>>(); let wide: Box<ULINT> = defaultValue<Box<ULINT>>();
    const cards: Cards<BOOL, 2> = defaultValue<Cards<BOOL, 2>>();
    function identity<T extends number | bigint>(value: T): T { const local: T = value; return local; }
    export function main(): void { small.Value = identity<UINT>(65535); wide.Value = identity<ULINT>(18446744073709551615n); cards[1].Value = true; Motor = cards[1].Value && small.Value === 65535 && wide.Value > 0n; }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
  const instances = core.functions.filter((fn) => fn.name.startsWith("identity_"));
  expect(instances.map((fn) => fn.result).sort()).toEqual(["UINT", "ULINT"]);
  expect(
    new Set(
      instances.flatMap((fn) => [...fn.parameters, ...fn.locals].map((variable) => variable.id)),
    ).size,
  ).toBe(instances.reduce((count, fn) => count + fn.parameters.length + fn.locals.length, 0));
  expect(
    compile(
      "function id<T>(value: T): T { return value; } export function main(): void { const value = id(1); }",
    ).core,
  ).toBeUndefined();
});

test("source-library generics compile without executing library JavaScript", () => {
  const core = checked(
    'import { min, max } from "@vplc/compiler/math"; let count: UINT = 0; export function main(): void { count = min<UINT>(max<UINT>(5, 8), 6); Motor = count === 6; }',
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("count")).toBe(6n);
  expect(runtime.get("Motor")).toBe(true);
  expect(core.functions.filter((fn) => fn.name.startsWith("min_"))).toHaveLength(1);
});

test("interface inheritance preserves complete layout through generic base interfaces", () => {
  const core = checked(
    "interface Base<T> { Value: T } interface Middle<T> extends Base<T> { Flag: BOOL } interface State extends Middle<UINT> { Count: UINT } let state: State = { Value: 1, Flag: true, Count: 2 }; export function main(): void { Motor = state.Flag && state.Value === 1; }",
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
});

test("raw IR cannot forge readonly paths, partial local initialization or recursive layouts", () => {
  const result = frontend(
    "interface State { readonly Flag: BOOL } const state: State = { Flag: false }; export function main(): void { Motor = state.Flag; }",
  );
  if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
  const module = structuredClone(result.module),
    entry = module.functions.find((fn) => fn.name === "main")!,
    state = module.variables.find((variable) => variable.name === "state")!;
  entry.body = [
    {
      kind: "assign",
      destination: { root: state.id, path: [{ kind: "field", name: "Flag" }] },
      value: {
        kind: "constant",
        type: "BOOL",
        value: { kind: "bool", value: true },
        span: entry.span,
      },
      span: entry.span,
    },
  ];
  expect(normalizeModule(module).core).toBeUndefined();
  const recursive = structuredClone(result.module);
  recursive.types = [
    ...recursive.types,
    { id: "Recursive", kind: "array", element: "Recursive", length: 1, lowerBound: 0 },
  ];
  expect(normalizeModule(recursive).core).toBeUndefined();
  const partial: PlcModule = structuredClone(result.module);
  const fn = partial.functions.find((fn) => fn.name === "main")!;
  const local = { ...state, id: "partial", storage: "local" as const, mutable: true };
  delete local.initial;
  fn.locals = [local];
  fn.body = [
    {
      kind: "assign",
      destination: { root: local.id, path: [{ kind: "field", name: "Flag" }] },
      value: {
        kind: "constant",
        type: "BOOL",
        value: { kind: "bool", value: true },
        span: fn.span,
      },
      span: fn.span,
    },
  ];
  expect(normalizeModule(partial).core).toBeUndefined();
});

test("static array length preserves receiver calls while avoiding unused payload snapshots", () => {
  const core = checked(
    "let size: DINT = 0; function make(): FixedArray<BOOL, 2> { Motor = true; return [true, false]; } export function main(): void { Motor = false; size = make().length + 1; }",
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
  expect(runtime.get("size")).toBe(3n);
  expect(core.functions.some((fn) => fn.name === "make")).toBe(true);
});
test("nested generic anonymous layouts and inferred const record bindings stay distinct", () => {
  const core = checked(
    "interface Holder<T> { inner: { value: T } } const b = defaultValue<Holder<BOOL>>(); const n = defaultValue<Holder<UINT>>(); export function main(): void { b.inner.value = true; n.inner.value = 1; Motor = b.inner.value && n.inner.value === 1; }",
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
  expect(core.variables.find((variable) => variable.name === "b")?.storage).toBe("module");
});

test("string and template literals receive comparison context in either operand order", () => {
  const core = checked(
    'let text: STRING<3> = "x"; export function main(): void { Motor = ("x") === text && `x` === text && text === "x"; }',
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("Motor")).toBe(true);
});

test("raw layout depth is independent of type declaration order", () => {
  const result = frontend("export function main(): void { Motor = true; }");
  if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
  const records = Array.from({ length: 100 }, (_, index) => ({
    id: `R${index}`,
    kind: "record" as const,
    fields: [{ name: "item", type: index ? `R${index - 1}` : "BOOL", readonly: false }],
  }));
  for (const ordered of [records, [...records].reverse()])
    expect(
      normalizeModule({ ...result.module, types: [...result.module.types, ...ordered] }).core,
    ).toBeUndefined();
});
