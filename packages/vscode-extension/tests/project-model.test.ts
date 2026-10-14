import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { dependencyCompletion, dependencyLiterals, readProject } from "../src/project-model.ts";

function completion(source: string) {
  const offset = source.indexOf("|");
  const text = source.replace("|", "");
  const context = dependencyCompletion(text, offset);
  return { context, replaced: context && text.slice(context.start, context.end) };
}

test("dependency name/version completion follows AST ranges and never spills into IO", () => {
  expect(
    completion('export default { dependencies: { "Stan|dard": "3.5.22.0" }, io:{} };'),
  ).toMatchObject({
    context: { kind: "name", company: "System", quoted: true },
    replaced: "Standard",
  });
  expect(completion("export default { dependencies: { Sta| }, io:{} };")).toMatchObject({
    context: { kind: "name", company: "System", quoted: false },
    replaced: "Sta",
  });
  expect(
    completion(
      'export default { "dependencies": { Util: { version: "3.5.|", company: "System" } } };',
    ),
  ).toMatchObject({
    context: { kind: "version", name: "Util", company: "System", quoted: true },
    replaced: "3.5.",
  });
  expect(completion("export default { dependencies: { | } };").context?.kind).toBe("name");
  expect(completion("export default { dependencies: {\n  |").context?.kind).toBe("name");
  expect(
    completion(
      'export default { dependencies: { Standard:"3.5.22.0" }, io:{ X:{ address:"%I|X0.0" } } };',
    ).context,
  ).toBeUndefined();
  expect(
    completion('export default { dependencies: { Local: { path:"libs/|file.library" } } };')
      .context,
  ).toBeUndefined();
  expect(
    dependencyLiterals('export default { "dependencies": { Standard:"3.5.22.0" } };')[0]?.name,
  ).toBe("Standard");
});

test("snapshot fallback supports expressions without hiding schema or IO errors in literal edits", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "tsplc-editor-config-"));
  const configFile = resolve(root, "tsplc.config.ts");
  await mkdir(resolve(root, ".tsplc"));
  await writeFile(
    resolve(root, ".tsplc/project.json"),
    JSON.stringify({
      version: 1,
      configFile,
      config: { backend: "codesys", monitor: { endpoint: "opc.tcp://previous:4840" } },
    }),
  );
  await writeFile(configFile, "export default createConfig();");
  const generated = await readProject(configFile);
  expect(generated.source).toBe("generated");
  expect(generated.config.monitor?.endpoint).toBe("opc.tcp://previous:4840");

  await writeFile(
    configFile,
    'export default { backend: "codesys", monitor: { endpoint: "invalid" } };',
  );
  await expect(readProject(configFile)).rejects.toThrow();
  await writeFile(
    configFile,
    'export default { backend: "codesys", io: { Missing: { device: "absent", channel: "inputs.Byte0" } } };',
  );
  await expect(readProject(configFile)).rejects.toThrow("unknown or unaddressable channel");
});
