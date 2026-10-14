import { machine } from "./support/machine.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@tsplc/compiler";
import {
  normalizeModule,
  parseInteger,
  primitiveTypes,
  type PlcModule,
  type VerifiedCoreModule,
} from "@tsplc/compiler/ir";
import { codesys, direct, planCodesys, emitCodesys } from "@tsplc/compiler/codesys";

const directories: string[] = [];
function compile(
  source: string,
  io = "declare const Start: Input<BOOL>; declare let Motor: Output<BOOL>;",
) {
  const directory = mkdtempSync(join(tmpdir(), "tsplc-numeric-"));
  directories.push(directory);
  const sdk = join(import.meta.dir, "../packages/compiler/types/index.d.ts");
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { paths: { "@tsplc/compiler/types": [sdk] } },
      include: ["*.ts"],
    }),
  );
  writeFileSync(join(directory, "io.d.ts"), io);
  writeFileSync(join(directory, "main.ts"), source);
  const frontend = analyze({
    tsconfig: join(directory, "tsconfig.json"),
    programs: { main: { module: "./main.ts", export: "main" } },
  });
  if (!frontend.module) return { diagnostics: frontend.diagnostics };
  return normalizeModule(frontend.module);
}
function checked(source: string): VerifiedCoreModule {
  const result = compile(source);
  if (!result.core) throw new Error(JSON.stringify(result.diagnostics));
  return result.core;
}
function emit(core: VerifiedCoreModule) {
  const plan = planCodesys(
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
  if (!plan.plan) throw new Error(JSON.stringify(plan.diagnostics));
  return emitCodesys(plan.plan);
}
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("numeric PLC semantics", () => {
  test("keeps exact 64-bit constants and parses bases, exponents and separators", () => {
    const core = checked(
      "let maximum: ULINT = 18446744073709551615n; let minimum: LINT = -9223372036854775808n; export function main(): void { Motor = maximum > 0n && minimum < 0n; }",
    );
    expect(core.variables.find((item) => item.name === "maximum")?.initial).toEqual({
      kind: "integer",
      value: "18446744073709551615",
    });
    expect(parseInteger("0xff_ff")).toBe(65535n);
    expect(parseInteger("-1.25e2")).toBe(-125n);
    expect(() => parseInteger("1.1")).toThrow();
    expect(
      emit(core).objects.some((item) => item.declaration.includes("ULINT#18446744073709551615")),
    ).toBe(true);
  });
  test("rejects range violations, domain mixing, unproved overflow and unsafe division", () => {
    for (const source of [
      "let value: UINT = -1;",
      "let value: UINT = 65536;",
      "let value: ULINT = 18446744073709551616n;",
      "let value = 1;",
      "let value: UINT = 0; function bad(): void { value = value + 1; }",
      "let value: UINT = 0; let bits: WORD = 0; function bad(): void { value = bits; }",
      "let value: DINT = 0; let divisor: DINT = 1; function bad(): void { value = value / divisor; }",
      "let value: LINT = -9223372036854775808n; function bad(): void { value = value / -1n; }",
    ])
      expect(compile(`${source} export function main(): void {}`).core).toBeUndefined();
  });
  test("proves widened sums and checks returns, recursion and entry calls", () => {
    const core = checked(
      "function sum(a: UINT, b: UINT): UDINT { return a + b; } let result: UDINT = 0; export function main(): void { result = sum(65535, 65535); Motor = result === 131070; }",
    );
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("result")).toBe(131070n);
    expect(runtime.get("Motor")).toBe(true);
    for (const source of [
      "function missing(a: BOOL): BOOL { if (a) return true; }",
      "function first(): BOOL { return second(); } function second(): BOOL { return first(); }",
      "function helper(): void { main(); }",
    ])
      expect(compile(`${source} export function main(): void {}`).core).toBeUndefined();
    expect(core.functions.map((fn) => fn.name).sort()).toEqual(["main", "sum"]);
  });
  test("wraps and saturates signed/unsigned arithmetic and conversions at exact widths", () => {
    const core =
      checked(`import { wrapAdd, wrapMultiply, saturatingSubtract, saturatingMultiply, wrap, saturate } from "@tsplc/compiler/types";
      let small: UINT = 65535; let full: ULINT = 18446744073709551615n; let signed: LINT = -9223372036854775808n;
      let product: LINT = -9223372036854775808n; let narrow: SINT = 0;
      export function main(): void {
        small = wrapAdd<UINT>(small, 1); full = wrapMultiply<ULINT>(full, 2n);
        signed = saturatingSubtract<LINT>(signed, 1n); product = saturatingMultiply<LINT>(product, -1n);
        narrow = wrap<SINT>(255); Motor = saturate<UINT>(-1) === 0;
      }`);
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("small")).toBe(0n);
    expect(runtime.get("full")).toBe(18446744073709551614n);
    expect(runtime.get("signed")).toBe(-9223372036854775808n);
    expect(runtime.get("product")).toBe(9223372036854775807n);
    expect(runtime.get("narrow")).toBe(-1n);
    expect(runtime.get("Motor")).toBe(true);
    const output = emit(core);
    expect(output.diagnostics).toEqual([]);
    expect(
      output.objects.some((item) => item.implementation?.includes("FOR i := 1 TO 64 DO")),
    ).toBe(true);
  });
  test("captures reads and arguments before helper effects, and guards calls in Boolean/conditional expressions", () => {
    const core = checked(`let state: DINT = 1; let result: DINT = 0; let touched: BOOL = false;
      function change(value: DINT): DINT { state = 2; return value; }
      function first(a: DINT, b: DINT): DINT { return a; }
      function touch(): BOOL { touched = true; return true; }
      export function main(): void { result = first(state, change(state)); Motor = false && touch(); Motor = Start ? touch() : false; }`);
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("state")).toBe(2n);
    expect(runtime.get("result")).toBe(1n);
    expect(runtime.get("touched")).toBe(false);
    runtime.set("Start", true);
    runtime.scan();
    expect(runtime.get("touched")).toBe(true);
    expect(runtime.get("Motor")).toBe(true);
    expect(emit(core).objects.some((item) => item.implementation?.includes(" AND "))).toBe(false);
  });
  test("executes bounded loops with break/continue and grouped switch labels", () => {
    const core = checked(`import { wrapAdd } from "@tsplc/compiler/types"; let result: UINT = 0;
      function route(value: UINT): UINT { switch(value) { case 0: case 1: return 4; default: return 2; } }
      export function main(): void { result = 0; for(let i: UINT = 0; i < 4; i++) { if(i === 2) continue; result = wrapAdd<UINT>(result, i); } Motor = result === route(1); }`);
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("result")).toBe(4n);
    expect(runtime.get("Motor")).toBe(true);
    expect(emit(core).objects.some((item) => item.implementation?.includes("CONTINUE;"))).toBe(
      true,
    );
    expect(
      compile(
        "export function main(): void { for(let i: UINT = 0; i < 3; i++) { switch(i) { case 1: if(Start) break; Motor = true; break; default: break; } } }",
      ).core,
    ).toBeUndefined();
    for (const loop of [
      "for(let i: UINT = 0; i < 4; i--) {}",
      "for(let i: UINT = 0; i < 4; i++) { i = 0; }",
      "while(Start) {}",
      "for(let i: UDINT = 0; i < 1000001; i++) {}",
    ])
      expect(compile(`export function main(): void { ${loop} }`).core).toBeUndefined();
  });
  test("emits supported casts for identity conversions and 64-bit loop counters", () => {
    const core =
      checked(`import { exact, wrapAdd } from "@tsplc/compiler/types"; let value: UINT = 1; let signed: LINT = 0n; let full: ULINT = 0n;
      export function main(): void { value = exact<UINT>(value); for(let i: LINT = -2n; i < 2n; i++) { signed = wrapAdd<LINT>(signed, i); } for(let i: ULINT = 2n; i > 0n; i--) { full = wrapAdd<ULINT>(full, i); } Motor = true; }`);
    const output = emit(core);
    for (const object of output.objects.filter((object) => object.implementation !== undefined)) {
      expect(object.implementation).not.toContain("LINT_TO_LINT(");
      expect(object.implementation).not.toContain("ULINT_TO_ULINT(");
      expect(object.implementation).not.toContain("UINT_TO_UINT(");
    }
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("signed")).toBe(-2n);
    expect(runtime.get("full")).toBe(3n);
  });
  test("enforces bit-string domains and narrows bitwise results", () => {
    const core = checked(
      "let bits: WORD = 65535; export function main(): void { bits = (bits << 1) & 255; Motor = bits === 254; }",
    );
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("bits")).toBe(254n);
    expect(runtime.get("Motor")).toBe(true);
    expect(
      compile("let bits: WORD = 1; export function main(): void { bits = bits << 16; }").core,
    ).toBeUndefined();
  });

  test("defines truncating division and dividend-signed remainder", () => {
    const core =
      checked(`import { div } from "@tsplc/compiler/types"; let value: DINT = -11; let quotient: DINT = 0; let remainder: DINT = 0;
      export function main(): void { quotient = div<DINT>(value, 4); remainder = value % 4; Motor = quotient === -2 && remainder === -3; }`);
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("quotient")).toBe(-2n);
    expect(runtime.get("remainder")).toBe(-3n);
    expect(emit(core).objects.every((item) => !item.implementation?.includes(" MOD "))).toBe(true);
  });
  test("float saturation clips before rounding and preserves boundaries, ties, subnormals and signed zero", () => {
    const maximum = (2 - 2 ** -23) * 2 ** 127;
    const cases: readonly [number, number][] = [
      [Number.MAX_VALUE, maximum],
      [-Number.MAX_VALUE, -maximum],
      [maximum, maximum],
      [-maximum, -maximum],
      [maximum + 2 ** 102, maximum],
      [1 + 2 ** -24, 1],
      [1 + 3 * 2 ** -24, 1 + 2 ** -22],
      [-(1 + 2 ** -24), -1],
      [2 ** -149, 2 ** -149],
      [2 ** -150, 0],
      [-(2 ** -150), -0],
      [3 * 2 ** -150, 2 ** -148],
      [Number.MIN_VALUE, 0],
      [-Number.MIN_VALUE, -0],
      [0, 0],
      [-0, -0],
    ];
    const constants = cases
      .map(
        ([value], index) => `
      const source${index}: LREAL = ${Object.is(value, -0) ? "-0.0" : String(value)};
      const folded${index}: REAL = saturate<REAL>(source${index});
    `,
      )
      .join("\n");
    const core = checked(`
      import { saturate } from "@tsplc/compiler/types";
      ${constants}
      let input: LREAL = 0;
      let narrow: REAL = 0;
      let same: REAL = 0;
      let widened: LREAL = 0;
      let identity: LREAL = 0;
      let called: BOOL = false;
      function next(): LREAL { called = !called; return input; }
      export function main(): void {
        narrow = saturate<REAL>(next());
        same = saturate<REAL>(narrow);
        widened = saturate<LREAL>(narrow);
        identity = saturate<LREAL>(input);
      }
    `);
    const runtime = machine(core);
    cases.forEach(([value, expected], index) => {
      expect(Object.is(runtime.get(`folded${index}`), expected)).toBe(true);
      runtime.set("input", value);
      runtime.scan();
      expect(Object.is(runtime.get("narrow"), expected)).toBe(true);
      expect(Object.is(runtime.get("same"), expected)).toBe(true);
      expect(Object.is(runtime.get("widened"), expected)).toBe(true);
      expect(Object.is(runtime.get("identity"), value)).toBe(true);
      expect(runtime.get("called")).toBe(index % 2 === 0);
    });

    const bundle = emit(core);
    const helper = bundle.objects.find((object) => object.id === "numeric:saturate_LREAL_REAL");
    if (!helper) throw new Error("Missing narrowing saturation helper");
    expect(helper.declaration).toContain("value : LREAL;");
    expect(helper.declaration).toMatch(/FUNCTION .* : REAL/);
    expect(helper.implementation).toContain("IF value < LREAL#-3.4028234663852886E+38 THEN");
    expect(helper.implementation).toContain("IF value > LREAL#3.4028234663852886E+38 THEN");
    expect(helper.implementation).toContain("TO_REAL(value)");
    expect(bundle.objects.some((object) => object.id === "numeric:saturate_REAL_LREAL")).toBe(
      false,
    );
    expect(bundle.objects.some((object) => object.implementation?.includes("TO_LREAL("))).toBe(
      true,
    );
  });

  test("float saturation preserves strict conversion domains and cannot launder invalid raw constants", () => {
    for (const conversion of [
      "wrap<REAL>(wide)",
      "wrap<LREAL>(narrow)",
      "saturate<REAL>(integer)",
      "saturate<UINT>(wide)",
      "exact<REAL>(wide)",
      "exact<REAL>(1.0000000596046448)",
    ]) {
      expect(
        compile(`import { wrap, saturate, exact } from "@tsplc/compiler/types";
        let wide: LREAL = 1;
        let narrow: REAL = 1;
        let integer: UINT = 1;
        export function main(): void { const rejected = ${conversion}; }
      `).core,
      ).toBeUndefined();
    }
    const span = { file: "forged.ts", start: 0, end: 1, line: 1, column: 1 };
    const forged = (value: number, policy = "saturate", nested = false): PlcModule => ({
      types: primitiveTypes,
      variables: [
        {
          id: "result",
          name: "result",
          type: "REAL",
          storage: "module",
          mutable: true,
          retain: false,
          initial: { kind: "float", value: 0 },
          span,
        },
      ],
      functions: [
        {
          id: "main",
          name: "main",
          parameters: [],
          locals: [],
          span,
          body: [
            {
              kind: "assign",
              destination: { root: "result", path: [] },
              span,
              value: {
                kind: "convert",
                type: "REAL",
                policy: nested ? "saturate" : JSON.parse(JSON.stringify(policy)),
                operand: nested
                  ? {
                      kind: "convert",
                      type: "LREAL",
                      policy: JSON.parse(JSON.stringify(policy)),
                      operand: {
                        kind: "constant",
                        type: "LREAL",
                        value: { kind: "float", value },
                        span,
                      },
                      span,
                    }
                  : { kind: "constant", type: "LREAL", value: { kind: "float", value }, span },
                span,
              },
            },
          ],
        },
      ],
      blocks: [],
      programs: [{ id: "program", name: "main", entry: "main" }],
    });
    // Runtime HIR admission must inspect the child before folding its parent.
    for (const invalid of [Infinity, -Infinity, NaN])
      expect(normalizeModule(forged(invalid)).core).toBeUndefined();
    for (const nested of [false, true])
      expect(normalizeModule(forged(1, "unknown", nested)).diagnostics).toContainEqual(
        expect.objectContaining({ message: "Unknown numeric conversion policy." }),
      );
  });

  test("rounds REAL constants at typed operations and rejects nonfinite results", () => {
    const core = checked(
      "let value: REAL = 0; export function main(): void { value = 3.5 % 2; Motor = value === 1.5; }",
    );
    expect(emit(core).objects.some((item) => item.implementation?.includes("REAL#1.5"))).toBe(true);
    expect(compile("let value: REAL = 1e40; export function main(): void {}").core).toBeUndefined();
    expect(
      compile("let value: REAL = 1; export function main(): void { value = value * 2; }").core,
    ).toBeUndefined();
    expect(
      compile(
        'import { exact } from "@tsplc/compiler/types"; export function main(): void { const value = exact<REAL>(16777217.0); }',
      ).core,
    ).toBeUndefined();
    expect(
      compile(
        "const bits: WORD = 1; let value: UINT = 0; export function main(): void { value = bits; }",
      ).core,
    ).toBeUndefined();
  });
  test("proves finite floating increments without changing rounding or operand order", () => {
    for (const type of ["REAL", "LREAL"]) {
      const core = checked(`
        let value: ${type} = 25;
        let reverse: ${type} = -2;
        export function main(): void {
          value = value + 0.1;
          value = value - 0.2;
          reverse = 0.1 - reverse;
        }
      `);
      const runtime = machine(core);
      runtime.scan();
      const round = type === "REAL" ? Math.fround : (value: number) => value;
      expect(runtime.get("value")).toBe(round(round(25 + round(0.1)) - round(0.2)));
      expect(runtime.get("reverse")).toBe(round(round(0.1) - -2));
      expect(emit(core).diagnostics).toEqual([]);
    }
  });

  test("rejects floating overflow ties after rounding the authored constant", () => {
    for (const [type, maximum, cutoff, below] of [
      ["REAL", Math.fround((2 - 2 ** -23) * 2 ** 127), 2 ** 103, 2 ** 103 - 2 ** 79],
      ["LREAL", Number.MAX_VALUE, 2 ** 970, 2 ** 970 - 2 ** 917],
    ] as const) {
      for (const sign of [1, -1]) {
        for (const expression of [
          `value + (${sign * cutoff})`,
          `value - (${sign * cutoff})`,
          `(${sign * cutoff}) - value`,
        ]) {
          expect(
            compile(
              `let value: ${type} = 0; export function main(): void { value = ${expression}; }`,
            ).core,
          ).toBeUndefined();
        }
      }
      const core = checked(`
        let high: ${type} = ${maximum};
        let low: ${type} = ${-maximum};
        export function main(): void {
          high = high + ${below};
          low = low - ${below};
        }
      `);
      const runtime = machine(core);
      runtime.scan();
      expect(runtime.get("high")).toBe(maximum);
      expect(runtime.get("low")).toBe(-maximum);
    }

    // This decimal is below the tie in binary64, but rounds to the REAL tie.
    expect(
      compile(
        `let value: REAL = 0; export function main(): void { value = value + ${2 ** 103 - 2 ** 77}; }`,
      ).core,
    ).toBeUndefined();
    for (const operation of ["+", "-", "*", "/"]) {
      expect(
        compile(
          `let a: REAL = 1; let b: REAL = 2; export function main(): void { a = a ${operation} b; }`,
        ).core,
      ).toBeUndefined();
    }
  });

  test("keeps signed-zero floating arithmetic instead of substituting an identity", () => {
    const core = checked(`
      let sum: REAL = -0.0;
      let difference: REAL = -0.0;
      let reverse: REAL = 0.0;
      export function main(): void {
        sum = sum + 0.0;
        difference = difference - 0.0;
        reverse = -0.0 - reverse;
      }
    `);
    const runtime = machine(core);
    runtime.scan();
    expect(Object.is(runtime.get("sum"), 0)).toBe(true);
    expect(Object.is(runtime.get("difference"), -0)).toBe(true);
    expect(Object.is(runtime.get("reverse"), -0)).toBe(true);
    const bundle = emit(core);
    expect(bundle.objects.some((object) => object.declaration.includes("REAL#-0.0"))).toBe(true);
    expect(bundle.objects.some((object) => object.implementation?.includes(" + "))).toBe(true);
  });

  test("resolves inferred constants after their dependencies and preserves grouped default labels", () => {
    const core = checked(
      "const a: UINT = 1; const b = a + 1; let value: UINT = 2; export function main(): void { switch(value) { default: case 1: Motor = true; break; } }",
    );
    expect(core.variables.find((item) => item.name === "b")?.initial).toEqual({
      kind: "integer",
      value: "2",
    });
    const forward = checked(
      "function read(): DINT { return VALUE; } export function main(): void { Motor = FLAG && read() === 1; } const VALUE = 1; const FLAG = true;",
    );
    const forwardRuntime = machine(forward);
    forwardRuntime.scan();
    expect(forwardRuntime.get("Motor")).toBe(true);
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("Motor")).toBe(true);
    const hexadecimal = checked(
      "let value: REAL = -0xff; export function main(): void { Motor = value === -255; }",
    );
    expect(hexadecimal.variables.find((item) => item.name === "value")?.initial).toEqual({
      kind: "float",
      value: -255,
    });
    for (const source of [
      "function bad(): Input<BOOL> { return true; }",
      "function bad(): Output<UINT> { return 1; }",
      "function bad(): void { for(let i: Input<UINT> = 0; i < 2; i++) {} }",
    ])
      expect(compile(`${source} export function main(): void {}`).core).toBeUndefined();
  });
  test("contextualizes parenthesized and negative comparison literals", () => {
    const core = checked(
      "let wide: ULINT = 2n; let real: REAL = 0; export function main(): void { Motor = (1n) < wide && (-1) < real && -(1) < real && -(-1n) < wide; }",
    );
    const runtime = machine(core);
    runtime.scan();
    expect(runtime.get("Motor")).toBe(true);
  });
  test("rejects physical floating inputs until a nonfinite boundary policy exists", () => {
    const result = compile(
      "export function main(): void { Result = Sensor * 1; }",
      "declare const Sensor: Input<REAL>; declare let Result: Output<REAL>;",
    );
    if (!result.core) throw new Error(JSON.stringify(result.diagnostics));
    const planned = planCodesys(
      result.core,
      {
        tasks: [
          { name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] },
        ],
      },
      {
        engineering: { kind: "v3.5" },
        profile: { directAddressing: "byte", numericAddressing: "byte" },
        io: { Sensor: direct("%ID0"), Result: direct("%QD0") },
      },
    );
    expect(planned.plan).toBeUndefined();
    expect(planned.diagnostics.some((item) => item.message.includes("nonfinite policy"))).toBe(
      true,
    );
  });
  test("requires numeric address units and detects byte/word/bit overlaps", () => {
    const result = compile(
      "export function main(): void { Motor = Start > 0; }",
      "declare const Start: Input<UINT>; declare let Motor: Output<BOOL>;",
    );
    if (!result.core) throw new Error(JSON.stringify(result.diagnostics));
    const options = {
      engineering: { kind: "v3.5" },
      profile: { directAddressing: "byte" },
      io: { Start: direct("%IW0"), Motor: direct("%QX0.0") },
    };
    const deployment = {
      tasks: [
        { name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] },
      ],
    };
    expect(planCodesys(result.core, deployment, options).plan).toBeUndefined();
    const plan = planCodesys(result.core, deployment, {
      ...options,
      profile: { ...options.profile, numericAddressing: "element" },
    });
    expect(plan.diagnostics).toEqual([]);
    if (!plan.plan) throw new Error("Expected plan");
    expect(emitCodesys(plan.plan).objects.find((item) => item.id === "io")?.declaration).toContain(
      "AT %IW0 : UINT",
    );
    const overlapping = compile(
      "export function main(): void { Motor = Start > 0 && Enable; }",
      "declare const Start: Input<UINT>; declare const Enable: Input<BOOL>; declare let Motor: Output<BOOL>;",
    );
    if (!overlapping.core) throw new Error(JSON.stringify(overlapping.diagnostics));
    const overlapOptions = {
      ...options,
      profile: { ...options.profile, numericAddressing: "element" },
      io: { ...options.io, Enable: direct("%IX1.0") },
    };
    expect(
      planCodesys(overlapping.core, deployment, overlapOptions).diagnostics.some((item) =>
        item.message.includes("Overlapping"),
      ),
    ).toBe(true);
    expect(
      planCodesys(overlapping.core, deployment, {
        ...overlapOptions,
        io: { ...overlapOptions.io, Enable: direct("%IX2.0") },
      }).diagnostics,
    ).toEqual([]);
  });
});
