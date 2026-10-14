import { expect, mock, test } from "bun:test";
import { configSchema, resolveConfig, CodesysCompilerError } from "@tsplc/build";
import { normalizeModule, primitiveTypes } from "@tsplc/compiler/ir";
const buildProject = mock(async (config: unknown) => ({
  mode: "build",
  application: "Application",
  config,
}));
mock.module("@tsplc/build", () => ({
  configSchema,
  resolveConfig,
  CodesysCompilerError,
  buildProject,
}));
const { planCodesys, emitCodesys, buildCodesys, engineeringBuildSchema } =
  await import("../packages/compiler/backends/codesys/index.ts");
const span = { file: "machine.ts", start: 0, end: 1, line: 1, column: 1 };
const settings = {
  docker: { image: "builder:fixture" },
  template: "templates/base.project",
};
function plan(build = true) {
  const normalized = normalizeModule({
    types: primitiveTypes,
    variables: [],
    blocks: [],
    functions: ["read", "publish"].map((name) => ({
      id: name,
      name,
      parameters: [],
      locals: [],
      body: [],
      span,
    })),
    programs: [
      { id: "reader", name: "read", entry: "read" },
      { id: "publisher", name: "publish", entry: "publish" },
    ],
  });
  if (!normalized.core) throw new Error(JSON.stringify(normalized.diagnostics));
  const result = planCodesys(
    normalized.core,
    {
      tasks: [
        { name: "FastTask", intervalNanoseconds: "10000000", priority: 1, programs: ["read"] },
        { name: "SlowTask", intervalNanoseconds: "100000000", priority: 10, programs: ["publish"] },
      ],
    },
    {
      engineering: { kind: "v3.5", ...(build && { build: settings }) },
      profile: { directAddressing: "byte" },
      io: {},
      programNames: { read: "ReadInputs", publish: "PublishStatus" },
    },
  );
  if (!result.plan) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}
const paths = {
  configFile: "/tmp/machine/tsplc.config.ts",
  sourceDir: "/tmp/machine/generated",
  outDir: "/tmp/machine/.tsplc/engineering",
};
test("engineering Docker settings share companion validation and exclude compiler/runtime fields", () => {
  expect(engineeringBuildSchema.parse(settings).docker?.image).toBe("builder:fixture");
  for (const key of ["sourceDir", "entry", "outDir", "task", "tasks", "runtime"])
    expect(engineeringBuildSchema.safeParse({ ...settings, [key]: "forbidden" }).success).toBe(
      false,
    );
});
test("build uses generated program identities and exact compiler task plan", async () => {
  buildProject.mockClear();
  const planned = plan(),
    bundle = emitCodesys(planned);
  const receipt = await buildCodesys(planned, bundle, paths);
  expect(receipt.application).toBe("Application");
  expect(buildProject.mock.calls[0]![0]).toMatchObject({
    template: "/tmp/machine/templates/base.project",
    sourceDir: paths.sourceDir,
    entry: "/tmp/machine/generated/_Generated/ReadInputs/declaration.st",
    outDir: paths.outDir,
    tasks: [
      { name: "FastTask", intervalNanoseconds: "10000000", priority: 1, programs: ["ReadInputs"] },
      {
        name: "SlowTask",
        intervalNanoseconds: "100000000",
        priority: 10,
        programs: ["PublishStatus"],
      },
    ],
  });
});
test("missing engineering settings fail without launching vendor tooling", async () => {
  buildProject.mockClear();
  const planned = plan(false);
  await expect(buildCodesys(planned, emitCodesys(planned), paths)).rejects.toThrow(
    "engineering.build",
  );
  expect(buildProject).not.toHaveBeenCalled();
});
test("a missing generated program is rejected before launch", async () => {
  buildProject.mockClear();
  await expect(buildCodesys(plan(), { objects: [] }, paths)).rejects.toThrow("PROGRAM object");
  expect(buildProject).not.toHaveBeenCalled();
});
