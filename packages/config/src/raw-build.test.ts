import { expect, test } from "bun:test";
import { rawBuildConfig, vplcConfigSchema, ms, ns } from "./schema.ts";
import { resolveConfig } from "./build.ts";

const task = {
  name: "FastTask",
  schedule: { kind: "cyclic" as const, interval: ms(5) },
  priority: 2,
  programs: ["ReadInputs", "Main"],
};

test("raw builds use shared task names, exact cycle, priority and IEC program order", () => {
  const config = vplcConfigSchema.parse({
    backend: "codesys",
    build: { template: "local.project" },
    tasks: [task],
  });
  expect(rawBuildConfig(config).tasks).toEqual([
    {
      name: "FastTask",
      intervalNanoseconds: "5000000",
      priority: 2,
      programs: ["ReadInputs", "Main"],
    },
  ]);
});

test.each([undefined, "LegacyTask"])("raw builds preserve template task selection %s", (name) => {
  const config = vplcConfigSchema.parse({
    backend: "codesys",
    build: { template: "local.project", ...(name ? { task: name } : {}) },
  });
  const build = rawBuildConfig(config);
  expect(build.tasks).toBeUndefined();
  expect(resolveConfig(build, "/project/vplc.config.ts").task).toBe(name ?? "MainTask");
});

test.each([
  { task: "OtherTask" },
  { task: "MainTask" },
  {
    tasks: [
      { name: "OtherTask", intervalNanoseconds: "10000000", priority: 1, programs: ["Main"] },
    ],
  },
])("raw builds reject two schedule owners", (legacy) => {
  const config = vplcConfigSchema.parse({
    backend: "codesys",
    build: { template: "local.project", ...legacy },
    tasks: [task],
  });
  expect(() => rawBuildConfig(config)).toThrow("not both");
});

test("raw shared schedules use the existing exact TIME and duplicate-assignment rules", () => {
  for (const tasks of [
    [{ ...task, schedule: { kind: "cyclic", interval: ns(1) } }],
    [task, { ...task, name: "fasttask" }],
    [task, { ...task, name: "SlowTask", programs: ["Main"] }],
  ]) {
    const config = vplcConfigSchema.parse({
      backend: "codesys",
      build: { template: "local.project" },
      tasks,
    });
    expect(() => rawBuildConfig(config)).toThrow();
  }
});
