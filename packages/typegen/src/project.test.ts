import { expect, test } from "bun:test";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVplcConfig } from "@vplc/config";
import { format } from "prettier";
import { generateProject } from "./project.ts";

test.each([
  {
    name: "native timers",
    declaration: "const delay = new TON();",
    update: "delay.update({ IN: InputStart, PT: seconds(1) }); OutputReady = delay.out.Q;",
    storage: "delay : TON;",
  },
  {
    name: "user blocks",
    declaration: `
interface DelayInputs { Enabled: BOOL; }
interface DelayOutputs { Ready: BOOL; }
class DelayedStart extends FunctionBlock<DelayInputs, DelayOutputs> {
  private timer = new TON();
  protected execute(input: DelayInputs): DelayOutputs {
    this.timer.update({ IN: input.Enabled, PT: seconds(1) });
    return { Ready: this.timer.out.Q };
  }
}
const controller = new DelayedStart();`,
    update: "controller.update({ Enabled: InputStart }); OutputReady = controller.out.Ready;",
    storage: "controller : FB_DelayedStart;",
  },
])(
  "default TS contracts select published data without exposing private $name storage",
  async ({ declaration, update, storage }) => {
    const root = await mkdtemp(join(tmpdir(), "vplc-block-contract-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({ include: ["src/**/*.ts"] }));
      await writeFile(
        join(root, "src/io.d.ts"),
        "declare const InputStart: Input<BOOL>; declare let OutputReady: Output<BOOL>;",
      );
      await writeFile(
        join(root, "src/LineIO.ts"),
        "export interface Flags { Ready: BOOL; } export let Status: Flags = defaultValue<Flags>(); export let Count: UINT = 0;",
      );
      await writeFile(
        join(root, "src/main.ts"),
        `import * as LineIO from "./LineIO";
${declaration}
const enabled: BOOL = true;
const preset: TIME = seconds(1);
const label: STRING<8> = "Ready";
const ratio: LREAL = 1.5;
const wide: LINT = 7n;
let elapsed: TIME = ms(0);
let storedLabel: STRING<8> = "";
let reading: LREAL = 0;
let storedWide: LINT = 0n;
export function main(): void {
  ${update}
  LineIO.Status.Ready = enabled && (OutputReady || LineIO.Count > 0);
  elapsed = preset;
  storedLabel = label;
  reading = ratio;
  storedWide = wide;
}`,
      );
      const file = join(root, "vplc.config.ts");
      await writeFile(
        file,
        `export default {
  backend: "codesys",
  compiler: { programs: { main: { module: "src/main.ts", export: "main" } } },
  tasks: [{ name: "MainTask", schedule: { kind: "cyclic", interval: { kind: "duration", nanoseconds: "20000000" } }, priority: 1, programs: ["main"] }],
  codesys: { publishGlobalLists: ["LineIO"] },
  io: { InputStart: { address: "%IX0.0" }, OutputReady: { address: "%QX0.0" } }
};`,
      );
      const emit = async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            join(import.meta.dir, "../../compiler/project/cli.ts"),
            "build",
            "--config",
            file,
            "--emit-only",
            "--format",
            "json",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(code, stderr || stdout).toBe(0);
        expect(JSON.parse(stdout).status).toBe("emitted");
      };
      await emit();
      const privateState = join(root, ".vplc/artifacts/st/GVL_main_state.st");
      expect(await readFile(privateState, "utf8")).toContain(storage);
      const contract = await readFile(join(root, "generated/plc.ts"), "utf8");
      expect(contract).toContain("export interface Flags");
      expect(contract).toContain("GVL_LineIO_state");
      expect(contract).toContain("Status: Flags");
      expect(contract).toContain("Count: number");
      expect(contract).toContain("InputStart: boolean");
      expect(contract).toContain("OutputReady: boolean");
      expect(contract).not.toContain("GVL_main_state");
      expect(contract).not.toContain("GVL_main_constants");
      expect(contract).not.toContain("_physical");
      await generateProject(file, { check: true });

      await writeFile(
        file,
        (await readFile(file, "utf8")).replace('codesys: { publishGlobalLists: ["LineIO"] },', ""),
      );
      await emit();
      const defaultContract = await readFile(join(root, "generated/plc.ts"), "utf8");
      expect(defaultContract).not.toContain("GVL_LineIO_state");
      expect(defaultContract).not.toContain("GVL_main_state");
      expect(defaultContract).toContain("InputStart: boolean");
      expect(defaultContract).toContain("OutputReady: boolean");
      await generateProject(file, { check: true });

      // An explicitly selected declaration directory remains strict. Private
      // block instances do not acquire an invented host record representation.
      await mkdir(join(root, "private-contract"));
      await copyFile(privateState, join(root, "private-contract/State.st"));
      await writeFile(
        file,
        (await readFile(file, "utf8")).replace(
          'backend: "codesys",',
          'backend: "codesys", typegen: { globals: "private-contract" },',
        ),
      );
      await expect(generateProject(file)).rejects.toThrow("unknown IEC type");
      expect(await readFile(privateState, "utf8")).toContain(storage);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20_000,
);

test("raw ST metadata generation does not parse vendor declarations; explicit typegen remains strict", async () => {
  const root = await mkdtemp(join(tmpdir(), "vplc-raw-typegen-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src/Register.st"),
      "TYPE U_Register : UNION\nBITS : BYTE;\nEND_UNION END_TYPE",
    );
    const file = join(root, "vplc.config.ts");
    await writeFile(
      file,
      'export default { backend: "codesys", build: { sourceDir: "src", template: "Template.project" }, io: {} };',
    );
    const loaded = await loadVplcConfig(file);
    expect(loaded.config.typegen).toBeUndefined();
    const metadata = await generateProject(file, { hardwareOnly: true, loaded });
    expect(metadata.files.map((path) => path.slice(root.length + 1))).toEqual([
      "generated/hardware.ts",
      ".vplc/project.json",
    ]);
    expect(
      JSON.parse(await readFile(join(root, ".vplc/project.json"), "utf8")).config.typegen,
    ).toBeUndefined();
    await expect(generateProject(file, { loaded })).rejects.toThrow("expected ;, found BITS");
    await writeFile(
      file,
      'export default { backend: "codesys", typegen: {}, build: { sourceDir: "src", template: "Template.project" }, io: {} };',
    );
    expect((await loadVplcConfig(file)).config.typegen?.out).toBe("generated/plc.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("typegen check never changes project files or existing staging, including on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "vplc-readonly-typegen-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/LineIO.st"), "VAR_GLOBAL\nCount : UINT;\nEND_VAR");
    const file = join(root, "vplc.config.ts");
    await writeFile(
      file,
      'export default { backend: "codesys", typegen: {}, build: { sourceDir: "src", template: "Template.project" } };',
    );
    await generateProject(file);
    await mkdir(join(root, ".vplc/typegen"));
    await writeFile(
      join(root, ".vplc/typegen/keep.txt"),
      "Existing staging must remain untouched.",
    );
    const snapshot = async () =>
      Promise.all(
        (await readdir(root, { recursive: true })).sort().map(async (path) => {
          const info = await stat(join(root, path));
          return {
            path,
            modified: info.mtimeMs,
            content: info.isFile() ? await readFile(join(root, path), "utf8") : undefined,
          };
        }),
      );
    const before = await snapshot();
    await generateProject(file, { check: true });
    expect(await snapshot()).toEqual(before);
    await writeFile(join(root, "generated/plc.ts"), "export const stale = true;");
    const stale = await snapshot();
    await expect(generateProject(file, { check: true })).rejects.toThrow("stale");
    expect(await snapshot()).toEqual(stale);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing or empty inferred ST sources cannot validate a stale PLC contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "vplc-missing-typegen-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/LineIO.st"), "VAR_GLOBAL\nCount : UINT;\nEND_VAR");
    const file = join(root, "vplc.config.ts");
    await writeFile(
      file,
      'export default { backend: "codesys", typegen: {}, build: { sourceDir: "src", template: "Template.project" } };',
    );
    await generateProject(file);
    const contract = join(root, "generated/plc.ts");
    const original = await readFile(contract, "utf8");
    await rename(join(root, "src"), join(root, "saved-src"));
    await expect(generateProject(file, { check: true })).rejects.toThrow("ENOENT");
    await mkdir(join(root, "src"));
    await expect(generateProject(file, { check: true })).rejects.toThrow("no .st declarations");
    expect(await readFile(contract, "utf8")).toBe(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a program-only source has an empty contract and removing its last global invalidates stale output", async () => {
  const root = await mkdtemp(join(tmpdir(), "vplc-empty-contract-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/Main.st"), "PROGRAM Main\nEND_PROGRAM");
    await writeFile(join(root, "src/LineIO.st"), "VAR_GLOBAL\nCount : UINT;\nEND_VAR");
    const file = join(root, "vplc.config.ts");
    await writeFile(
      file,
      'export default { backend: "codesys", typegen: {}, build: { sourceDir: "src", template: "Template.project" } };',
    );
    await generateProject(file);
    const contract = join(root, "generated/plc.ts");
    expect(await readFile(contract, "utf8")).toContain("Count: number");
    await rename(join(root, "src/LineIO.st"), join(root, "saved-LineIO.st"));
    await expect(generateProject(file, { check: true })).rejects.toThrow("stale");
    await generateProject(file);
    const current = await readFile(contract, "utf8");
    expect(current).toContain("export interface PlcGlobals {}");
    expect(current).not.toContain("Count");
    await generateProject(file, { check: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("typegen check accepts consumer formatting and rejects changed values, comments and syntax", async () => {
  const root = await mkdtemp(join(tmpdir(), "vplc-format-typegen-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src/LineIO.st"),
      "VAR_GLOBAL\n(* Door feedback. *)\nDoor : BOOL;\nEND_VAR",
    );
    const file = join(root, "vplc.config.ts");
    await writeFile(
      file,
      'export default { backend: "codesys", typegen: {}, build: { sourceDir: "src", template: "Template.project" } };',
    );
    await generateProject(file);
    const path = join(root, "generated/plc.ts"),
      original = await readFile(path, "utf8");
    await writeFile(
      path,
      await format(original, {
        parser: "typescript",
        useTabs: true,
        singleQuote: true,
        trailingComma: "none",
      }),
    );
    await generateProject(file, { check: true });
    await writeFile(path, original.replace("Door feedback.", "Changed feedback."));
    await expect(generateProject(file, { check: true })).rejects.toThrow("stale");
    await writeFile(path, original.replace('"BOOL"', '"BYTE"'));
    await expect(generateProject(file, { check: true })).rejects.toThrow("stale");
    await writeFile(path, "export const = broken");
    await expect(generateProject(file, { check: true })).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
