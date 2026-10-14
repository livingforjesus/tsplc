import { describe, expect, test } from "bun:test";
import { definePlcConfig, ms, ns, validateConfig } from "@vplc/config";
import { formatDiagnostic, integerRange, primitiveTypes } from "@vplc/compiler/ir";

const config = definePlcConfig({
  name: "Conveyor",
  tsconfig: "./tsconfig.json",
  entry: { module: "./src/main.ts", export: "main" },
  tasks: [
    {
      name: "Main",
      schedule: { kind: "cyclic", interval: ms(10) },
      priority: 1,
      programs: ["main"],
    },
  ],
  target: { kind: "test", options: {} },
});

describe("configuration", () => {
  test("normalizes a single entry without executing source", () => {
    expect(validateConfig(config).config?.programs).toEqual({ main: config.entry });
  });
  test("rejects unknown options and contradictory entry forms", () => {
    expect(validateConfig({ ...config, typo: true }).config).toBeUndefined();
    expect(validateConfig({ ...config, programs: { extra: config.entry } }).config).toBeUndefined();
  });
  test("rejects unknown and multiply assigned programs", () => {
    const tasks = [
      ...config.tasks,
      { ...config.tasks[0]!, name: "Other", programs: ["main", "missing"] },
    ];
    const messages = validateConfig({ ...config, tasks }).diagnostics.map((item) => item.message);
    expect(messages.some((item) => item.includes("unknown program"))).toBe(true);
    expect(messages.some((item) => item.includes("exactly one task"))).toBe(true);
  });
  test("rejects omitted assignments and duplicate task names", () => {
    const { entry, ...rest } = config;
    expect(
      validateConfig({ ...rest, programs: { main: entry, extra: entry } }).diagnostics[0]?.message,
    ).toContain("not assigned");
    expect(
      validateConfig({ ...config, tasks: [...config.tasks, ...config.tasks] }).config,
    ).toBeUndefined();
  });
  test("required target options and property paths are validated", () => {
    expect(
      validateConfig({ ...config, target: { kind: "test" } }).diagnostics[0]?.message,
    ).toContain("target.options");
    expect(validateConfig({ ...config, tsconfig: undefined }).diagnostics[0]?.message).toContain(
      "tsconfig",
    );
    expect(
      validateConfig({ ...config, target: { kind: "test", options: {}, typo: true } })
        .diagnostics[0]?.message,
    ).toContain("typo");
  });
  test("readonly program lists are accepted by the typed interface", () => {
    const programs = ["main"] as const;
    const readonlyConfig = definePlcConfig({
      ...config,
      tasks: [{ ...config.tasks[0], programs }],
    });
    expect(validateConfig(readonlyConfig).diagnostics).toEqual([]);
  });
  test("durations must be exact and positive", () => {
    expect(ms(0.5).nanoseconds).toBe("500000");
    for (const value of [0, -1, NaN, Infinity, 0.1]) expect(() => ns(value)).toThrow();
  });
});

test("PLC ranges include exact 64-bit limits", () => {
  const lint = primitiveTypes.find((type) => type.id === "LINT");
  if (lint?.kind !== "integer") throw new Error("Missing LINT");
  expect(integerRange(lint)).toEqual([-(1n << 63n), (1n << 63n) - 1n]);
});

test("diagnostics preserve a useful source location and underline", () => {
  expect(
    formatDiagnostic(
      {
        origin: "plc",
        code: "PLC2003",
        severity: "error",
        message: "Out of range",
        span: { file: "control.ts", start: 14, end: 16, line: 1, column: 15 },
      },
      "let x: UINT = -1;",
    ),
  ).toContain(
    "control.ts:1:15: PLC2003: Out of range\n1 | let x: UINT = -1;\n                  ^^",
  );
});
