import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@vplc/compiler";
import { normalizeModule, type VerifiedCoreModule } from "@vplc/compiler/ir";
import { codesys, planCodesys, emitCodesys } from "@vplc/compiler/codesys";
import { machine } from "./support/machine.ts";

const directories: string[] = [];
function frontend(source: string) {
  const directory = mkdtempSync(join(tmpdir(), "plcts-blocks-"));
  directories.push(directory);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: {
          "@vplc/compiler/types": [join(import.meta.dir, "../packages/compiler/types/index.d.ts")],
        },
      },
      include: ["*.ts"],
    }),
  );
  writeFileSync(join(directory, "main.ts"), source);
  return analyze({
    tsconfig: join(directory, "tsconfig.json"),
    programs: { main: { module: "./main.ts", export: "main" } },
  });
}
function compile(source: string) {
  const result = frontend(source);
  return result.module ? normalizeModule(result.module) : { diagnostics: result.diagnostics };
}
function checked(source: string): VerifiedCoreModule {
  const result = compile(source);
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
    codesys({ engineering: { kind: "v3.5" }, profile: { directAddressing: "byte" }, io: {} })
      .options,
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

test("time constructors preserve exact milliseconds and calendar domains", () => {
  const core = checked(
    'let fraction: TIME = seconds(.5); let hexadecimal: TIME = ms(0x10); let delay: TIME = seconds(1.001); let maximum: TIME = ms(4294967295); let day: DATE = date("2000-02-29"); let clock: TIME_OF_DAY = timeOfDay("23:59:59.999"); let stamp: DATE_AND_TIME = dateAndTime("2106-02-07T06:28:15"); let ok: BOOL = false; export function main(): void { ok = delay > ms(1000) && day < date("2001-01-01"); }',
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("delay")).toBe(1001000000n);
  expect(runtime.get("fraction")).toBe(500000000n);
  expect(runtime.get("hexadecimal")).toBe(16000000n);
  expect(runtime.get("ok")).toBe(true);
  const bundle = emitted(core);
  expect(bundle.diagnostics).toEqual([]);
  expect(bundle.objects.some((object) => object.declaration.includes("T#1001ms"))).toBe(true);
  for (const value of [
    "seconds(0.0001)",
    "ms(-1)",
    "ms(4294967296)",
    'date("1900-02-29")',
    'date("2001-02-29")',
    'timeOfDay("24:00:00")',
    'dateAndTime("2106-02-07T06:28:16")',
  ])
    expect(compile(`const bad = ${value}; export function main(): void {}`).core).toBeUndefined();
  expect(
    compile("let value: TIME = seconds(1); export function main(): void { value = value + value; }")
      .core,
  ).toBeUndefined();
});

test("user block instances keep separate state while invocation locals reset", () => {
  const core = checked(`interface Inputs { Enabled: BOOL } interface Outputs { Active: BOOL }
    class Latch extends FunctionBlock<Inputs, Outputs> {
      private previous: BOOL = false;
      protected execute(input: Inputs): Outputs {
        let local: BOOL = false;
        const active: BOOL = (input.Enabled || false) && !this.previous && !local;
        this.previous = input.Enabled; local = true;
        return { Active: active };
      }
    }
    const first = new Latch(); const second = new Latch(); let enabled: BOOL = true;
    let firstOut: BOOL = false; let secondOut: BOOL = false;
    export function main(): void { first.update({ Enabled: enabled }); second.update({ Enabled: false }); firstOut = first.out.Active; secondOut = second.out.Active; }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("firstOut")).toBe(true);
  expect(runtime.get("secondOut")).toBe(false);
  runtime.scan();
  expect(runtime.get("firstOut")).toBe(false);
  runtime.set("enabled", false);
  runtime.scan();
  runtime.set("enabled", true);
  runtime.scan();
  expect(runtime.get("firstOut")).toBe(true);
  const block = emitted(core).objects.find((object) => object.kind === "functionBlock")!;
  expect(block.declaration).toContain("VAR_TEMP");
  expect(block.declaration).toContain("VAR_OUTPUT");
});

test("nested blocks and indexed record borrows write the original storage", () => {
  const core =
    checked(`interface State { Flag: BOOL } interface Inputs { State: InOut<State>; Enabled: BOOL }
    class Writer extends FunctionBlock<Inputs> { protected execute(input: Inputs): void { input.State.Flag = input.Enabled; } }
    class Parent extends FunctionBlock<Inputs> { private child = new Writer(); protected execute(input: Inputs): void { this.child.update({ State: ref(input.State), Enabled: input.Enabled }); } }
    const writer = new Parent(); const data: FixedArray<State, 2, 1> = defaultValue<FixedArray<State, 2, 1>>();
    export function main(): void { writer.update({ Enabled: true, State: ref(data[2]) }); }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("data")).toEqual([{ Flag: false }, { Flag: true }]);
  expect(emitted(core).diagnostics).toEqual([]);
});

test("existing loop counters retain header semantics on completion, break, continue and return", () => {
  const core = checked(`
    import { wrapAdd } from "@vplc/compiler/types";
    interface Inputs { Mode: UINT }
    interface Outputs { Counter: UINT; Sum: UINT }
    class Counter extends FunctionBlock<Inputs, Outputs> {
      private index: UINT = 0;
      protected execute(input: Inputs): Outputs {
        let sum: UINT = 0;
        for (this.index = 1; this.index <= 4; this.index++) {
          if (input.Mode === 1 && this.index === 2) break;
          if (input.Mode === 2 && this.index === 2) continue;
          if (input.Mode === 3 && this.index === 2) return { Counter: this.index, Sum: sum };
          sum = wrapAdd<UINT>(sum, this.index);
        }
        return { Counter: this.index, Sum: sum };
      }
    }
    const counter = new Counter();
    let mode: UINT = 0; let observed: UINT = 0; let sum: UINT = 0;
    export function main(): void {
      counter.update({ Mode: mode }); observed = counter.out.Counter; sum = counter.out.Sum;
    }`);
  const runtime = machine(core);
  for (const [mode, counter, sum] of [
    [0, 5, 10],
    [1, 2, 1],
    [2, 5, 8],
    [3, 2, 1],
  ]) {
    runtime.set("mode", BigInt(mode!));
    runtime.scan();
    expect(runtime.get("observed")).toBe(BigInt(counter!));
    expect(runtime.get("sum")).toBe(BigInt(sum!));
  }
  const block = emitted(core).objects.find((object) => object.kind === "functionBlock")!;
  expect(block.implementation).toContain("END_FOR;");
  expect(block.implementation!.split("END_FOR;")[1]).toContain("index := TO_UINT");
});

test("existing local and module loop counters are initialized even when the loop is empty", () => {
  const core = checked(`let index: INT = 0; let localValue: INT = 0;
    export function main(): void {
      let local: INT = 0;
      for (local = 4; local > 0; local -= 2) {}
      localValue = local;
      for (index = 6; index < 2; index++) {}
    }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("localValue")).toBe(0n);
  expect(runtime.get("index")).toBe(6n);
  expect(emitted(core).diagnostics).toEqual([]);
});

test("persistent counters reject overflowing termination and writes in the body", () => {
  for (const source of [
    "let i: USINT = 0; export function main(): void { for (i = 254; i <= 255; i++) {} }",
    "let i: INT = 0; export function main(): void { for (i = 0; i < 4; i++) { i = 2; } }",
  ])
    expect(compile(source).core).toBeUndefined();
});

test("bounded counters cannot be mutated through helper calls", () => {
  for (const call of ["mutate()", "forward()"]) {
    const result = compile(`let index: INT = 0;
      function mutate(): void { index = 0; }
      function forward(): void { mutate(); }
      export function main(): void {
        for (index = 0; index < 4; index++) { ${call}; }
      }`);
    expect(result.core).toBeUndefined();
    expect(result.diagnostics.some((item) => item.message.includes("active loop counter"))).toBe(
      true,
    );
  }
  expect(
    compile(`let index: INT = 0; let seen: INT = 0;
    function observe(): void { seen = index; }
    export function main(): void {
      for (index = 0; index < 4; index++) observe();
    }`).core,
  ).toBeDefined();
});

test("native timer and trigger interfaces compile and trace state transitions", () => {
  const core =
    checked(`const timer = new TON(); const edge = new R_TRIG(); let signal: BOOL = false; let done: BOOL = false; let rising: BOOL = false; let elapsed: TIME = ms(0);
    export function main(): void { timer.update({ IN: signal, PT: ms(100) }); edge.update({ CLK: signal }); done = timer.out.Q; elapsed = timer.out.ET; rising = edge.out.Q; }`);
  const runtime = machine(core);
  runtime.scan();
  runtime.set("signal", true);
  runtime.scan(10);
  expect(runtime.get("rising")).toBe(true);
  expect(runtime.get("done")).toBe(false);
  runtime.scan(100);
  expect(runtime.get("rising")).toBe(false);
  expect(runtime.get("done")).toBe(true);
  expect(runtime.get("elapsed")).toBe(100000000n);
  runtime.set("signal", false);
  runtime.scan();
  expect(runtime.get("done")).toBe(false);
  expect(runtime.get("elapsed")).toBe(0n);
  const bundle = emitted(core);
  expect(bundle.diagnostics).toEqual([]);
  expect(bundle.objects.some((object) => object.implementation?.includes("IN :="))).toBe(true);
});

test("borrow lifetime, input completeness, readonly outputs and restricted classes are enforced", () => {
  const base = `interface State { Flag: BOOL } interface Inputs { Left: InOut<State>; Right: InOut<State> }
    class Writer extends FunctionBlock<Inputs> { protected execute(input: Inputs): void { input.Left.Flag = true; } }
    const writer = new Writer(); let state: State = defaultValue<State>();`;
  for (const body of [
    "writer.update({ Left: ref(state), Right: ref(state) });",
    "writer.update({ Left: ref(state) });",
    "const alias = ref(state);",
    "const alias = writer;",
    "const local = new TON();",
  ])
    expect(compile(`${base} export function main(): void { ${body} }`).core).toBeUndefined();
  expect(
    compile("const timer = new TON(); export function main(): void { timer.out.Q = true; }").core,
  ).toBeUndefined();
  expect(
    compile(
      "class Bad extends FunctionBlock<{}> { public state: BOOL = false; protected execute(input: {}): void {} } export function main(): void {}",
    ).core,
  ).toBeUndefined();
  expect(
    compile(
      "class Bad extends FunctionBlock<{}> { constructor() { super(); } protected execute(input: {}): void {} } export function main(): void {}",
    ).core,
  ).toBeUndefined();
});

test("disjoint field borrows and retained storage have explicit backend contracts", () => {
  const core =
    checked(`interface State { Flag: BOOL } interface Pair { Left: State; Right: State } interface Inputs { Left: InOut<State>; Right: InOut<State> }
    class Writer extends FunctionBlock<Inputs> { protected execute(input: Inputs): void { input.Left.Flag = true; input.Right.Flag = false; } }
    const writer = new Writer(); const pair: Pair = defaultValue<Pair>(); let latch: BOOL = retain(false);
    export function main(): void { writer.update({ Left: ref(pair.Left), Right: ref(pair.Right) }); latch = true; }`);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("pair")).toEqual({ Left: { Flag: true }, Right: { Flag: false } });
  expect(
    emitted(core).objects.some((object) => object.declaration.includes("VAR_GLOBAL RETAIN")),
  ).toBe(true);
  const unsafe = checked(
    `interface Inputs { State: InOut<BOOL> } class Writer extends FunctionBlock<Inputs> { private flag: BOOL = retain(false); protected execute(input: Inputs): void { input.State = this.flag; } } const writer = new Writer(); let state: BOOL = false; export function main(): void { writer.update({ State: ref(state) }); }`,
  );
  expect(planned(unsafe).plan).toBeUndefined();
});

test("private state access cannot silently select another instance", () => {
  expect(
    compile(
      "class L extends FunctionBlock<{}> { private state: BOOL = false; protected execute(input: {}): void { second.state = true; } } const first = new L(); const second = new L(); export function main(): void { first.update({}); }",
    ).core,
  ).toBeUndefined();
});

test("generic input schemas preserve borrow modes and readonly values", () => {
  expect(
    compile(
      "interface Box<T> { X: T } class Writer extends FunctionBlock<Box<InOut<BOOL>>> { protected execute(input: Box<InOut<BOOL>>): void { input.X = true; } } class Reader extends FunctionBlock<Box<BOOL>> { protected execute(input: Box<BOOL>): void { input.X = false; } } const reader = new Reader(); let flag: BOOL = true; export function main(): void { reader.update({ X: ref(flag) }); }",
    ).core,
  ).toBeUndefined();
});

test("whole block outputs are captured as a value record before later updates", () => {
  const core = checked(
    "interface Inputs { X: BOOL } interface Outputs { Q: BOOL } class L extends FunctionBlock<Inputs, Outputs> { protected execute(input: Inputs): Outputs { return { Q: input.X }; } } const block = new L(); let result: Outputs = defaultValue<Outputs>(); export function main(): void { block.update({ X: true }); result = copy(block.out); block.update({ X: false }); }",
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("result")).toEqual({ Q: true });
  const output = emitted(core);
  expect(output.diagnostics).toEqual([]);
  expect(output.objects.some((object) => object.implementation?.includes(".Q"))).toBe(true);
});

test("inferred retained aggregate bindings preserve writable payloads", () => {
  const core = checked(
    "interface State { Flag: BOOL } const state = retain(defaultValue<State>()); export function main(): void { state.Flag = true; }",
  );
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("state")).toEqual({ Flag: true });
  expect(core.variables.find((variable) => variable.name === "state")?.retain).toBe(true);
  expect(
    emitted(core).objects.some((object) => object.declaration.includes("VAR_GLOBAL RETAIN")),
  ).toBe(true);
  expect(
    compile("const scalar = retain(false); export function main(): void {}").core,
  ).toBeUndefined();
});

test("TIME milliseconds preserve unsigned boundaries and evaluate the source exactly once", () => {
  const core = checked(`
    const zero: UDINT = timeToMilliseconds(ms(0));
    const maximum: UDINT = timeToMilliseconds(ms(4294967295));
    const fraction: UDINT = timeToMilliseconds(seconds(.5));
    let elapsed: TIME = ms(4294967295);
    let called: BOOL = false;
    let before: UDINT = 0;
    let after: UDINT = 0;
    function next(): TIME {
      called = !called;
      let previous: TIME = elapsed;
      elapsed = ms(0);
      return previous;
    }
    export function main(): void {
      before = timeToMilliseconds(next());
      after = timeToMilliseconds(elapsed);
    }
  `);
  const runtime = machine(core);
  expect(runtime.get("zero")).toBe(0n);
  expect(runtime.get("maximum")).toBe(4294967295n);
  expect(runtime.get("fraction")).toBe(500n);
  runtime.scan();
  expect(runtime.get("called")).toBe(true);
  expect(runtime.get("before")).toBe(4294967295n);
  expect(runtime.get("after")).toBe(0n);
  runtime.scan();
  expect(runtime.get("called")).toBe(false);
  expect(runtime.get("before")).toBe(0n);

  const bundle = emitted(core);
  expect(bundle.objects.some((object) => object.implementation?.includes("TIME_TO_UDINT("))).toBe(
    true,
  );
  expect(bundle.objects.some((object) => object.declaration.includes("UDINT#4294967295"))).toBe(
    true,
  );
});

test("TIME milliseconds require the canonical intrinsic and exact TIME-to-UDINT domains", () => {
  for (const source of [
    "let value: UDINT = timeToMilliseconds(1);",
    'import { exact } from "@vplc/compiler/types"; let value: UDINT = exact<UDINT>(ms(1));',
    'let value: UDINT = timeToMilliseconds(date("2000-01-01"));',
    "let value: TIME = timeToMilliseconds(ms(1));",
    "let value: UDINT = timeToMilliseconds<TIME>(ms(1));",
    "declare function timeToMilliseconds(value: TIME): UDINT; let value: UDINT = timeToMilliseconds(ms(1));",
  ]) {
    expect(compile(`${source} export function main(): void {}`).core).toBeUndefined();
  }

  // Raw HIR must pass the same domain check as canonical SDK calls.
  const authored = frontend(`let elapsed: TIME = ms(1); let result: UDINT = 0;
    export function main(): void { result = timeToMilliseconds(elapsed); }`);
  if (!authored.module) throw new Error(JSON.stringify(authored.diagnostics));
  const assignment = authored.module.functions[0]?.body[0];
  if (assignment?.kind !== "assign" || assignment.value.kind !== "unary")
    throw new Error("Expected milliseconds assignment");
  const originalOperand = assignment.value.operand;
  assignment.value.operand = {
    kind: "constant",
    type: "UDINT",
    value: { kind: "integer", value: "1" },
    span: assignment.span,
  };
  expect(normalizeModule(authored.module).diagnostics).toContainEqual(
    expect.objectContaining({ message: "timeToMilliseconds requires TIME and returns UDINT." }),
  );
  assignment.value.operand = originalOperand;
  assignment.value.type = "DINT";
  const destination = authored.module.variables.find((variable) => variable.name === "result");
  if (!destination) throw new Error("Missing authored result variable");
  destination.type = "DINT";
  expect(normalizeModule(authored.module).diagnostics).toContainEqual(
    expect.objectContaining({ message: "timeToMilliseconds requires TIME and returns UDINT." }),
  );
});

test("TIME milliseconds aliases keep SDK identity while same-named helpers keep authored behavior", () => {
  const alias = machine(
    checked(`
    import { timeToMilliseconds as milliseconds } from "@vplc/compiler/types";
    let elapsed: TIME = seconds(.5);
    let result: UDINT = 0;
    export function main(): void { result = milliseconds(elapsed); }
  `),
  );
  alias.scan();
  expect(alias.get("result")).toBe(500n);

  const authored = checked(`
    function timeToMilliseconds(value: TIME): UDINT { return 7; }
    let elapsed: TIME = ms(1);
    let result: UDINT = 0;
    export function main(): void { result = timeToMilliseconds(elapsed); }
  `);
  const runtime = machine(authored);
  runtime.scan();
  expect(runtime.get("result")).toBe(7n);
  expect(
    emitted(authored).objects.some((object) => object.implementation?.includes("TIME_TO_UDINT(")),
  ).toBe(false);
});

test("native BLINK preserves continuous timed phases and holds its output when disabled", () => {
  const core = checked(`
    import { BLINK as NativeBlink } from "@vplc/compiler/types";
    const blink = retain(new NativeBlink());
    let enabled: BOOL = true;
    let flashing: BOOL = false;
    export function main(): void {
      blink.update({ ENABLE: enabled, TIMELOW: ms(40), TIMEHIGH: ms(60) });
      flashing = blink.out.OUT;
    }
  `);
  const runtime = machine(core);
  expect(runtime.get("blink")).toEqual({ out: { OUT: false } });
  runtime.scan();
  expect(runtime.get("flashing")).toBe(false);
  runtime.scan();
  expect(runtime.get("flashing")).toBe(false);
  runtime.scan();
  expect(runtime.get("flashing")).toBe(true);
  runtime.set("enabled", false);
  runtime.scan(100);
  expect(runtime.get("flashing")).toBe(true);

  const bundle = emitted(core);
  expect(bundle.objects.some((object) => object.declaration.includes(": Util.BLINK;"))).toBe(true);
  expect(bundle.objects.some((object) => object.declaration.includes("VAR_GLOBAL RETAIN"))).toBe(
    true,
  );
  expect(bundle.objects.some((object) => object.implementation?.includes("(ENABLE :="))).toBe(true);
  expect(bundle.objects.some((object) => object.implementation?.includes(".OUT"))).toBe(true);
  expect(bundle.objects.some((object) => object.kind === "functionBlock")).toBe(false);
});

test("native BLINK high and low durations and per-instance state remain independent", () => {
  const runtime = machine(
    checked(`
    const fast = new BLINK();
    const slow = new BLINK();
    let fastOutput: BOOL = false;
    let slowOutput: BOOL = false;
    export function main(): void {
      fast.update({ ENABLE: true, TIMELOW: ms(40), TIMEHIGH: ms(60) });
      slow.update({ ENABLE: true, TIMELOW: ms(80), TIMEHIGH: ms(40) });
      fastOutput = fast.out.OUT;
      slowOutput = slow.out.OUT;
    }
  `),
  );
  runtime.scan();
  runtime.scan(40);
  expect(runtime.get("fastOutput")).toBe(true);
  expect(runtime.get("slowOutput")).toBe(false);
  runtime.scan(40);
  expect(runtime.get("fastOutput")).toBe(true);
  expect(runtime.get("slowOutput")).toBe(true);
  runtime.scan(20);
  expect(runtime.get("fastOutput")).toBe(false);
  expect(runtime.get("slowOutput")).toBe(true);
});

test("native BLINK validates complete ports, TIME domains, readonly output and canonical schemas", () => {
  for (const body of [
    "blink.update({ ENABLE: true, TIMELOW: ms(40) });",
    "blink.update({ ENABLE: true, TIMELOW: ms(40), TIMEHIGH: ms(60), EXTRA: false });",
    "blink.update({ ENABLE: ms(1), TIMELOW: ms(40), TIMEHIGH: ms(60) });",
    "blink.update({ ENABLE: true, TIMELOW: 40, TIMEHIGH: ms(60) });",
    'blink.update({ ENABLE: true, TIMELOW: ms(40), TIMEHIGH: date("2000-01-01") });',
    "blink.out.OUT = true;",
  ]) {
    expect(
      compile(`const blink = new BLINK(); export function main(): void { ${body} }`).core,
    ).toBeUndefined();
  }

  const authored = frontend(`const blink = new BLINK(); export function main(): void {
    blink.update({ ENABLE: true, TIMELOW: ms(40), TIMEHIGH: ms(60) });
  }`);
  if (!authored.module) throw new Error(JSON.stringify(authored.diagnostics));
  for (const corruption of ["input", "initial", "name"] as const) {
    const module = structuredClone(authored.module);
    const block = module.blocks.find((block) => block.standard === "BLINK");
    if (!block) throw new Error("Missing canonical BLINK definition");
    if (corruption === "input") {
      const input = block.inputs.find((input) => input.name === "TIMELOW");
      if (!input) throw new Error("Missing TIMELOW input");
      input.type = "BOOL";
    } else if (corruption === "initial") {
      const output = block.outputs[0];
      if (!output) throw new Error("Missing OUT output");
      output.initial = { kind: "bool", value: true };
    } else block.name = "UserBlink";
    expect(normalizeModule(module).diagnostics).toContainEqual(
      expect.objectContaining({ message: "Invalid canonical standard block definition." }),
    );
  }
});

test("an authored BLINK class never acquires native Util provenance by its name", () => {
  const core = checked(`
    interface Inputs { ENABLE: BOOL; TIMELOW: TIME; TIMEHIGH: TIME }
    interface Outputs { OUT: BOOL }
    class BLINK extends FunctionBlock<Inputs, Outputs> {
      protected execute(input: Inputs): Outputs { return { OUT: input.ENABLE }; }
    }
    const blink = new BLINK();
    let output: BOOL = false;
    export function main(): void {
      blink.update({ ENABLE: true, TIMELOW: ms(40), TIMEHIGH: ms(60) });
      output = blink.out.OUT;
    }
  `);
  const runtime = machine(core);
  runtime.scan();
  expect(runtime.get("output")).toBe(true);
  const bundle = emitted(core);
  expect(bundle.objects.some((object) => object.kind === "functionBlock")).toBe(true);
  expect(bundle.objects.some((object) => object.declaration.includes("Util.BLINK"))).toBe(false);
});

test("the BLINK test model rejects timing traces outside documented continuous phases", () => {
  const core = checked(`
    const blink = new BLINK();
    let enabled: BOOL = true;
    let low: TIME = ms(40);
    let high: TIME = ms(60);
    export function main(): void {
      blink.update({ ENABLE: enabled, TIMELOW: low, TIMEHIGH: high });
    }
  `);
  const skipped = machine(core);
  skipped.scan();
  expect(() => skipped.scan(41)).toThrow(
    "BLINK skipped phase boundaries require native Util execution",
  );

  const changed = machine(core);
  changed.scan();
  changed.set("low", 50_000_000n);
  expect(() => changed.scan()).toThrow("BLINK duration changes require native Util execution");

  const restarted = machine(core);
  restarted.scan();
  restarted.set("enabled", false);
  restarted.scan();
  restarted.set("enabled", true);
  expect(() => restarted.scan()).toThrow("BLINK restart timing requires native Util execution");

  const zero = machine(core);
  zero.set("high", 0n);
  expect(() => zero.scan()).toThrow("BLINK zero-time behavior requires native Util execution");
});

test("native BLINK keeps the Util namespace distinct from authored block inputs and fields", () => {
  const core = checked(`
    interface Inputs { Util: BOOL }
    interface Outputs { OUT: BOOL }
    class Controller extends FunctionBlock<Inputs, Outputs> {
      private Util: BOOL = false;
      private blink = new BLINK();
      protected execute(input: Inputs): Outputs {
        this.Util = input.Util;
        this.blink.update({ ENABLE: this.Util, TIMELOW: ms(40), TIMEHIGH: ms(60) });
        return { OUT: this.blink.out.OUT };
      }
    }
    const controller = new Controller();
    export function main(): void { controller.update({ Util: true }); }
  `);
  const block = emitted(core).objects.find((object) => object.kind === "functionBlock");
  if (!block) throw new Error("Missing authored Controller block");
  expect(block.declaration).toContain("Util_2 : BOOL;");
  expect(block.declaration).toContain("Util_3 : BOOL := FALSE;");
  expect(block.declaration).toContain(": Util.BLINK;");
  expect(block.declaration).not.toMatch(/^\s+Util\s*:/im);
  expect(block.implementation).toContain("Util_3 :=");
  const runtime = machine(core);
  runtime.scan();
  runtime.scan(40);
  expect(runtime.get("controller")).toEqual(expect.objectContaining({ out: { OUT: true } }));
});

test("explicit CODESYS object names cannot shadow the referenced native Util namespace", () => {
  const core = checked(`const blink = new BLINK(); export function main(): void {
    blink.update({ ENABLE: true, TIMELOW: ms(40), TIMEHIGH: ms(60) });
  }`);
  const deployment = {
    tasks: [{ name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] }],
  };
  const options = codesys({
    engineering: { kind: "v3.5" },
    profile: { directAddressing: "byte" },
    io: {},
  }).options;
  for (const override of [
    { programNames: { main: "Util" } },
    { globalListNames: { main: "uTiL" } },
  ]) {
    const result = planCodesys(core, deployment, { ...options, ...override });
    expect(result.plan).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        message: `IEC object name ${"programNames" in override ? "Util" : "uTiL"} shadows the Util library namespace required by BLINK.`,
      }),
    );
  }
  const withoutBlink = checked("export function main(): void {}");
  expect(
    planCodesys(withoutBlink, deployment, { ...options, programNames: { main: "Util" } }).plan,
  ).toBeDefined();
});
