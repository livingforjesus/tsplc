import { expect, test } from "bun:test";
import {
  type Expression,
  normalizeModule,
  type PlcModule,
  primitiveTypes,
  type Variable,
} from "@tsplc/compiler/ir";
import { emitCodesys, planCodesys } from "./index.ts";
import { CodesysTypes } from "./types.ts";

const span = { file: "machine.ts", start: 0, end: 1, line: 1, column: 1 };
const number = (value: string, type = "UDINT"): Expression => ({
  kind: "constant",
  type,
  value: { kind: "integer", value },
  span,
});
function fixture(): PlcModule {
  const variable = (
    id: string,
    type: string,
    storage: Variable["storage"],
    mutable: boolean,
  ): Variable => ({ id, name: id, type, storage, mutable, retain: false, span });
  return {
    types: [
      ...primitiveTypes,
      { id: "Box", kind: "record", fields: [{ name: "count", type: "UDINT", readonly: false }] },
      { id: "Cells", kind: "array", element: "Box", length: 2, lowerBound: 1 },
      { id: "Data", kind: "record", fields: [{ name: "cells", type: "Cells", readonly: false }] },
      {
        id: "Result",
        kind: "record",
        fields: [{ name: "current", type: "UDINT", readonly: false }],
      },
      { id: "MutatorType", kind: "block", block: "mutator", output: "Result" },
    ],
    variables: [
      {
        ...variable("data", "Data", "module", true),
        initial: {
          kind: "record",
          fields: {
            cells: {
              kind: "array",
              items: [0, 0].map(() => ({
                kind: "record",
                fields: { count: { kind: "integer", value: "0" } },
              })),
            },
          },
        },
      },
      variable("instance", "MutatorType", "instance", false),
      {
        ...variable("observed", "UDINT", "module", true),
        initial: { kind: "integer", value: "0" },
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
            kind: "blockUpdate",
            instance: "instance",
            inputs: {
              enabled: {
                kind: "constant",
                type: "BOOL",
                value: { kind: "bool", value: true },
                span,
              },
              target: {
                kind: "borrow",
                type: "Box",
                place: {
                  root: "data",
                  path: [
                    { kind: "field", name: "cells" },
                    { kind: "index", value: number("1", "DINT") },
                  ],
                },
                span,
              },
            },
            span,
          },
          {
            kind: "assign",
            destination: { root: "observed", path: [] },
            value: {
              kind: "load",
              type: "UDINT",
              place: {
                root: "instance",
                path: [
                  { kind: "field", name: "out" },
                  { kind: "field", name: "current" },
                ],
              },
              span,
            },
            span,
          },
        ],
      },
    ],
    blocks: [
      {
        id: "mutator",
        name: "Mutator",
        inputs: [
          variable("enabled", "BOOL", "parameter", false),
          { ...variable("target", "Box", "parameter", true), mode: "inOut" },
        ],
        outputs: [
          {
            ...variable("current", "UDINT", "blockOutput", false),
            initial: { kind: "integer", value: "0" },
          },
        ],
        state: [
          {
            ...variable("counter", "UDINT", "field", true),
            initial: { kind: "integer", value: "0" },
          },
        ],
        locals: [],
        result: "Result",
        span,
        body: [
          {
            kind: "assign",
            destination: { root: "target", path: [{ kind: "field", name: "count" }] },
            value: number("3"),
            span,
          },
          { kind: "assign", destination: { root: "counter", path: [] }, value: number("9"), span },
          {
            kind: "return",
            value: {
              kind: "record",
              type: "Result",
              fields: {
                current: {
                  kind: "load",
                  type: "UDINT",
                  place: { root: "target", path: [{ kind: "field", name: "count" }] },
                  span,
                },
              },
              span,
            },
            span,
          },
        ],
      },
    ],
    programs: [{ id: "program", name: "main", entry: "main" }],
  };
}
const deployment = {
  tasks: [{ name: "MainTask", intervalNanoseconds: "20000000", priority: 1, programs: ["main"] }],
};
const options = { engineering: { kind: "v3.5" }, profile: { directAddressing: "byte" }, io: {} };
function checked(module: PlcModule) {
  const result = normalizeModule(module);
  if (!result.core) throw new Error(JSON.stringify(result.diagnostics));
  return result.core;
}

test("TIME/calendar literals preserve exact units and civil timestamp spelling", () => {
  const types = new CodesysTypes(
    new Map(primitiveTypes.map((type) => [type.id, type])),
    (label) => label,
    new Map(),
  );
  expect(types.literal({ kind: "duration", nanoseconds: "4294967295000000" }, "TIME")).toBe(
    "T#4294967295ms",
  );
  expect(types.literal({ kind: "calendar", value: "2106-02-07" }, "DATE")).toBe("D#2106-02-07");
  expect(types.literal({ kind: "calendar", value: "23:59:59.999" }, "TIME_OF_DAY")).toBe(
    "TOD#23:59:59.999",
  );
  expect(types.literal({ kind: "calendar", value: "2106-02-07T06:28:15" }, "DATE_AND_TIME")).toBe(
    "DT#2106-02-07-06:28:15",
  );
});

test("user blocks borrow indexed record storage, preserve call order, and flatten outputs", () => {
  const planned = planCodesys(checked(fixture()), deployment, options);
  if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
  const emitted = emitCodesys(planned.plan);
  const block = emitted.objects.find((object) => object.kind === "functionBlock")!;
  expect(block.declaration).toContain("VAR_IN_OUT\n    target : ");
  expect(block.declaration).toContain("VAR_OUTPUT\n    current : UDINT");
  expect(block.declaration).toContain("VAR\n    counter : UDINT := UDINT#0;");
  expect(block.declaration).toContain("VAR_TEMP");
  expect(block.implementation).toMatch(/current := temporary_\d+\.current;\nRETURN;/);
  const entryObject = emitted.objects.find(
    (object) => object.kind === "function" && object.id === "main",
  );
  if (!entryObject) throw new Error("Missing emitted main function");
  const entry = entryObject.implementation;
  expect(entry).toMatch(/\(enabled := TRUE, target := .*\.cells\[DINT#1\]\);/);
  expect(entry).toMatch(/\.instance\.current/);
  expect(entry).not.toContain(".out.");
});

test("retained blocks containing mutable borrows are rejected before emission", () => {
  const module = fixture();
  module.blocks[0]!.state[0]!.retain = true;
  expect(planCodesys(checked(module), deployment, options).diagnostics).toContainEqual(
    expect.objectContaining({
      message: "Retained function blocks cannot contain direct or nested InOut references.",
    }),
  );
});

test("referent storage and instances cannot be owned by two cyclic tasks", () => {
  const module = fixture();
  module.functions = [
    ...module.functions,
    { ...module.functions[0]!, id: "second", name: "second" },
  ];
  module.programs = [...module.programs, { id: "second-program", name: "second", entry: "second" }];
  const planned = planCodesys(
    checked(module),
    {
      tasks: [
        ...deployment.tasks,
        { name: "OtherTask", intervalNanoseconds: "20000000", priority: 2, programs: ["second"] },
      ],
    },
    options,
  );
  expect(
    planned.diagnostics.some((item) => item.message.includes("Storage instance is shared")),
  ).toBe(true);
  expect(planned.diagnostics.some((item) => item.message.includes("Storage data is shared"))).toBe(
    true,
  );
});

test("native timer calls preserve vendor formals and expose direct outputs", () => {
  const module = fixture();
  const variable = (
    id: string,
    name: string,
    type: string,
    storage: Variable["storage"],
  ): Variable => ({ id, name, type, storage, mutable: false, retain: false, span });
  module.types = [
    ...module.types,
    {
      id: "TimerOutput",
      kind: "record",
      fields: [
        { name: "Q", type: "BOOL", readonly: true },
        { name: "ET", type: "TIME", readonly: true },
      ],
    },
    { id: "TimerType", kind: "block", block: "timer", output: "TimerOutput" },
  ];
  module.blocks = [
    ...module.blocks,
    {
      id: "timer",
      name: "TON",
      standard: "TON",
      result: "TimerOutput",
      inputs: [
        variable("timerIN", "IN", "BOOL", "parameter"),
        variable("timerPT", "PT", "TIME", "parameter"),
      ],
      outputs: [
        {
          ...variable("timerQ", "Q", "BOOL", "blockOutput"),
          initial: { kind: "bool", value: false },
        },
        {
          ...variable("timerET", "ET", "TIME", "blockOutput"),
          initial: { kind: "duration", nanoseconds: "0" },
        },
      ],
      state: [],
      locals: [],
      body: [],
      span,
    },
  ];
  module.variables = [
    ...module.variables,
    variable("delay", "delay", "TimerType", "instance"),
    {
      ...variable("ready", "ready", "BOOL", "module"),
      mutable: true,
      initial: { kind: "bool", value: false },
    },
  ];
  const main = module.functions[0]!;
  main.body = [
    ...main.body,
    {
      kind: "blockUpdate",
      instance: "delay",
      inputs: {
        IN: { kind: "constant", type: "BOOL", value: { kind: "bool", value: true }, span },
        PT: {
          kind: "constant",
          type: "TIME",
          value: { kind: "duration", nanoseconds: "2000000000" },
          span,
        },
      },
      span,
    },
    {
      kind: "assign",
      destination: { root: "ready", path: [] },
      value: {
        kind: "load",
        type: "BOOL",
        place: {
          root: "delay",
          path: [
            { kind: "field", name: "out" },
            { kind: "field", name: "Q" },
          ],
        },
        span,
      },
      span,
    },
  ];
  const planned = planCodesys(checked(module), deployment, options);
  if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
  const emitted = emitCodesys(planned.plan);
  expect(
    emitted.objects.some((object) => object.kind === "functionBlock" && object.id === "timer"),
  ).toBe(false);
  expect(emitted.objects.some((object) => object.declaration.includes("delay : TON;"))).toBe(true);
  const entryObject = emitted.objects.find((object) => object.id === "main");
  if (!entryObject) throw new Error("Missing emitted main function");
  const entry = entryObject.implementation;
  expect(entry).toContain("delay(IN := TRUE, PT := T#2000ms);");
  expect(entry).toContain("delay.Q");
});

test("retained private state promotes its outer static instance and groups declarations", () => {
  const module = fixture(),
    block = module.blocks[0]!;
  const { mode: _mode, ...target } = block.inputs[1]!;
  block.inputs = [block.inputs[0]!, { ...target, mutable: false }];
  block.state[0]!.retain = true;
  block.body = [
    { kind: "assign", destination: { root: "counter", path: [] }, value: number("9"), span },
    {
      kind: "return",
      value: { kind: "record", type: "Result", fields: { current: number("3") }, span },
      span,
    },
  ];
  const update = module.functions[0]!.body[0]!;
  if (update.kind !== "blockUpdate" || update.inputs.target?.kind !== "borrow")
    throw new Error("Expected fixture borrow");
  module.functions[0]!.body = [
    {
      ...update,
      inputs: {
        ...update.inputs,
        target: { kind: "load", type: "Box", place: update.inputs.target.place, span },
      },
    },
    ...module.functions[0]!.body.slice(1),
  ];
  const planned = planCodesys(checked(module), deployment, options);
  if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
  const emitted = emitCodesys(planned.plan);
  expect(emitted.objects.find((object) => object.kind === "functionBlock")?.declaration).toContain(
    "VAR RETAIN\n    counter : UDINT := UDINT#0;",
  );
  const global = emitted.objects.find(
    (object) => object.kind === "globalList" && object.declaration.includes("instance :"),
  )!;
  expect(global.declaration).toContain("VAR_GLOBAL RETAIN");
  expect(global.declaration).not.toContain("plc_data");
});

test("copying an entire output schema projects the block fields into a record snapshot", () => {
  const module = fixture();
  module.variables = [
    ...module.variables,
    {
      id: "snapshot",
      name: "snapshot",
      type: "Result",
      storage: "module",
      mutable: true,
      retain: false,
      initial: { kind: "record", fields: { current: { kind: "integer", value: "0" } } },
      span,
    },
  ];
  const main = module.functions[0]!;
  main.body = [
    ...main.body,
    {
      kind: "assign",
      destination: { root: "snapshot", path: [] },
      value: {
        kind: "copy",
        type: "Result",
        operand: {
          kind: "load",
          type: "Result",
          place: { root: "instance", path: [{ kind: "field", name: "out" }] },
          span,
        },
        span,
      },
      span,
    },
  ];
  const planned = planCodesys(checked(module), deployment, options);
  if (!planned.plan) throw new Error(JSON.stringify(planned.diagnostics));
  const entryObject = emitCodesys(planned.plan).objects.find((object) => object.id === "main");
  if (!entryObject) throw new Error("Missing emitted main function");
  const entry = entryObject.implementation;
  expect(entry).toMatch(/temporary_\d+ := .*\.instance\.current;/);
  expect(entry).toMatch(/temporary_\d+\.current := temporary_\d+;/);
  expect(entry).toMatch(/\.snapshot := temporary_\d+;/);
  expect(entry).not.toMatch(/:= .*\.instance;/);
});
