import { expect, test } from "bun:test";
import { durationLiteral } from "./domains.ts";
import { normalizeModule } from "./core.ts";
import { fold } from "./scalars.ts";
import { primitiveTypes } from "./types.ts";
import type { Expression, PlcModule, Variable } from "./model.ts";

const span = { file: "core.ts", start: 0, end: 1, line: 1, column: 1 };
const variable = (
  id: string,
  type: string,
  storage: Variable["storage"],
  mutable = true,
): Variable => ({ id, name: id, type, storage, mutable, retain: false, span });
const bool: Expression = {
  kind: "constant",
  type: "BOOL",
  value: { kind: "bool", value: true },
  span,
};
function fixture(): PlcModule {
  return {
    types: [
      ...primitiveTypes,
      {
        id: "Pair",
        kind: "record",
        fields: [
          { name: "left", type: "BOOL", readonly: false },
          { name: "right", type: "BOOL", readonly: false },
        ],
      },
      { id: "Block", kind: "block", block: "write" },
    ],
    variables: [
      {
        ...variable("data", "Pair", "module"),
        initial: {
          kind: "record",
          fields: { left: { kind: "bool", value: false }, right: { kind: "bool", value: false } },
        },
      },
      variable("instance", "Block", "instance", false),
    ],
    blocks: [
      {
        id: "write",
        name: "Write",
        inputs: ["a", "b"].map((id) => ({ ...variable(id, "BOOL", "parameter"), mode: "inOut" })),
        outputs: [],
        state: [],
        locals: [],
        body: [{ kind: "assign", destination: { root: "a", path: [] }, value: bool, span }],
        span,
      },
    ],
    functions: [
      {
        id: "main",
        name: "main",
        parameters: [],
        locals: [],
        body: [
          {
            kind: "blockUpdate",
            instance: "instance",
            inputs: {
              a: {
                kind: "borrow",
                type: "BOOL",
                place: { root: "data", path: [{ kind: "field", name: "left" }] },
                span,
              },
              b: {
                kind: "borrow",
                type: "BOOL",
                place: { root: "data", path: [{ kind: "field", name: "right" }] },
                span,
              },
            },
            span,
          },
        ],
        span,
      },
    ],
    programs: [{ id: "entry", name: "main", entry: "main" }],
  };
}
test("checked mutable borrows are confined to updates and reject overlapping places", () => {
  const original = fixture(),
    accepted = normalizeModule(original);
  expect(accepted.core?.blocks).toHaveLength(1);
  const overlap = structuredClone(original),
    call = overlap.functions[0]!.body[0]!;
  if (call.kind !== "blockUpdate") throw new Error("Expected update");
  call.inputs = { ...call.inputs, b: call.inputs.a! };
  expect(normalizeModule(overlap).core).toBeUndefined();
  const escaped = structuredClone(original),
    fn = escaped.functions[0]!;
  fn.body = [
    {
      kind: "assign",
      destination: { root: "data", path: [{ kind: "field", name: "left" }] },
      value: call.inputs.a!,
      span,
    },
  ];
  expect(normalizeModule(escaped).core).toBeUndefined();
});
test("mixed calls and updates cannot recurse through a persistent block", () => {
  const module = fixture();
  module.functions = [
    ...module.functions,
    {
      id: "helper",
      name: "helper",
      parameters: [],
      locals: [],
      body: [
        {
          kind: "blockUpdate",
          instance: "instance",
          inputs: {
            a: {
              kind: "borrow",
              type: "BOOL",
              place: { root: "data", path: [{ kind: "field", name: "left" }] },
              span,
            },
            b: {
              kind: "borrow",
              type: "BOOL",
              place: { root: "data", path: [{ kind: "field", name: "right" }] },
              span,
            },
          },
          span,
        },
      ],
      span,
    },
  ];
  module.blocks[0]!.body = [{ kind: "invoke", function: "helper", arguments: [], span }];
  expect(
    normalizeModule(module).diagnostics.some((item) => item.message.includes("Recursive scan")),
  ).toBe(true);
});
test("repeated child blocks count their complete static aggregate payload", () => {
  const module = fixture();
  module.types = [
    ...module.types,
    { id: "Huge", kind: "array", element: "BOOL", length: 500_001, lowerBound: 0 },
    { id: "Parent", kind: "block", block: "parent" },
  ];
  module.blocks[0]!.state = [
    {
      ...variable("payload", "Huge", "field"),
      initial: {
        kind: "array",
        items: Array.from({ length: 500_001 }, () => ({ kind: "bool" as const, value: false })),
      },
    },
  ];
  module.blocks = [
    ...module.blocks,
    {
      id: "parent",
      name: "Parent",
      inputs: [],
      outputs: [],
      state: [
        variable("child1", "Block", "instance", false),
        variable("child2", "Block", "instance", false),
      ],
      locals: [],
      body: [],
      span,
    },
  ];
  expect(
    normalizeModule(module).diagnostics.some((item) => item.message.includes("finite budget")),
  ).toBe(true);
});
test("whole output views normalize to field snapshots rather than instance values", () => {
  const module = fixture();
  module.types = [
    ...module.types.filter((type) => type.id !== "Block"),
    { id: "Out", kind: "record", fields: [{ name: "ready", type: "BOOL", readonly: true }] },
    { id: "Block", kind: "block", block: "write", output: "Out" },
  ];
  const block = module.blocks[0]!;
  block.result = "Out";
  block.outputs = [
    { ...variable("ready", "BOOL", "blockOutput", false), initial: { kind: "bool", value: false } },
  ];
  block.body = [
    { kind: "return", value: { kind: "record", type: "Out", fields: { ready: bool }, span }, span },
  ];
  const local = variable("snapshot", "Out", "local", false),
    fn = module.functions[0]!;
  fn.locals = [local];
  fn.body = [
    ...fn.body,
    {
      kind: "assign",
      destination: { root: local.id, path: [] },
      value: {
        kind: "copy",
        type: "Out",
        operand: {
          kind: "load",
          type: "Out",
          place: { root: "instance", path: [{ kind: "field", name: "out" }] },
          span,
        },
        span,
      },
      span,
    },
  ];
  const result = normalizeModule(module);
  expect(result.diagnostics).toEqual([]);
  const body = result.core!.functions[0]!.body;
  expect(
    body.some(
      (item) =>
        item.kind === "assign" &&
        item.value.kind === "load" &&
        item.value.root === "instance" &&
        item.value.path?.length === 2,
    ),
  ).toBe(true);
  expect(
    body.some(
      (item) =>
        item.kind === "assign" &&
        item.value.kind === "load" &&
        item.value.root === "instance" &&
        item.value.path?.length === 1,
    ),
  ).toBe(false);
});
test("retained readonly bindings require writable static payloads", () => {
  const module = fixture();
  module.variables = module.variables.map((variable, index) =>
    index ? variable : { ...variable, mutable: false, retain: true },
  );
  expect(normalizeModule(module).core).toBeDefined();
  const readonly = structuredClone(module),
    type = readonly.types.find((type) => type.id === "Pair")!;
  if (type.kind !== "record") throw new Error("Expected record");
  type.fields = type.fields.map((field) => ({ ...field, readonly: true }));
  readonly.functions[0]!.body = [];
  expect(
    normalizeModule(readonly).diagnostics.some((item) => item.message.includes("may retain")),
  ).toBe(true);
});

test("duration parsing preserves exact leading-decimal scales", () => {
  expect(durationLiteral(".5", 1_000_000_000n)).toEqual({
    kind: "duration",
    nanoseconds: "500000000",
  });
  expect(durationLiteral(".0005", 1_000_000_000n)).toBeUndefined();
});

test("block ports and lexical storage may share labels without sharing symbols", () => {
  const module = fixture(),
    block = module.blocks[0]!;
  module.types = [
    ...module.types.filter((type) => type.id !== "Block"),
    { id: "Out", kind: "record", fields: [{ name: "a", type: "BOOL", readonly: false }] },
    { id: "Block", kind: "block", block: "write", output: "Out" },
  ];
  block.result = "Out";
  block.outputs = [
    {
      ...variable("outA", "BOOL", "blockOutput", false),
      name: "a",
      initial: { kind: "bool", value: false },
    },
  ];
  block.state = [
    {
      ...variable("state", "BOOL", "field"),
      name: "shared",
      initial: { kind: "bool", value: false },
    },
  ];
  block.locals = [{ ...variable("local", "BOOL", "local", false), name: "shared" }];
  block.body = [
    { kind: "assign", destination: { root: "local", path: [] }, value: bool, span },
    {
      kind: "assign",
      destination: { root: "state", path: [] },
      value: { kind: "load", type: "BOOL", place: { root: "local", path: [] }, span },
      span,
    },
    { kind: "return", value: { kind: "record", type: "Out", fields: { a: bool }, span }, span },
  ];
  expect(normalizeModule(module).diagnostics).toEqual([]);
});

test("pure time and calendar comparisons fold for persistent constant initializers", () => {
  const types = new Map(primitiveTypes.map((type) => [type.id, type]));
  const duration: Expression = {
    kind: "constant",
    type: "TIME",
    value: { kind: "duration", nanoseconds: "1000000000" },
    span,
  };
  expect(
    fold(
      { kind: "binary", operator: "equal", type: "BOOL", left: duration, right: duration, span },
      new Map(),
      types,
    ),
  ).toEqual({ kind: "bool", value: true });
  const before: Expression = {
    kind: "constant",
    type: "DATE",
    value: { kind: "calendar", value: "2024-02-29" },
    span,
  };
  const after: Expression = {
    kind: "constant",
    type: "DATE",
    value: { kind: "calendar", value: "2024-03-01" },
    span,
  };
  expect(
    fold(
      { kind: "binary", operator: "less", type: "BOOL", left: before, right: after, span },
      new Map(),
      types,
    ),
  ).toEqual({ kind: "bool", value: true });
});
