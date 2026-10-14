import { expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { generateTypes } from "./generate";

const execute = promisify(execFile);
const cli = resolve(import.meta.dir, "../../dist/cli.js");

async function project(check: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "codesys-typegen test-"));
  try {
    await mkdir(join(directory, "types"));
    await mkdir(join(directory, "globals"));
    await writeFile(
      join(directory, "types/Card.st"),
      `
(* Card feedback with a nested (* engineering *) comment. *)
TYPE ST_Card : STRUCT
	(* Reader's detection signal. *)
	Detected : BOOL;
	Speed : LREAL;
END_STRUCT END_TYPE
`,
    );
    await writeFile(
      join(directory, "types/Conveyor.st"),
      `
{attribute 'qualified_only'}
TYPE ST_Conveyor : STRUCT
	(* Assigned cards. *)
	Cards : ARRAY[1..Limits.CardCount] OF st_card;
	Status : ST_Card;
	(* Raw bytes; preserve as one value. *)
	Data : ARRAY[0..3] OF BYTE;
	Name : STRING(80) := 'Do not parse; (* this *) as code';
	Capacity : UINT := 1;
END_STRUCT END_TYPE
`,
    );
    await writeFile(
      join(directory, "globals/Limits.st"),
      `VAR_GLOBAL CONSTANT
CardCount : INT := Base + 1;
Base : INT := 16#2;
END_VAR`,
    );
    await writeFile(
      join(directory, "globals/PlantIO.st"),
      `
{attribute 'linkalways'}
(* Devices. *)
VAR_GLOBAL
	(* Inbound conveyor. *)
	{attribute 'symbol' := 'readwrite'}
	Inbound : ST_Conveyor;
END_VAR
`,
    );
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function args(directory: string): string[] {
  return [
    cli,
    "--types",
    join(directory, "types"),
    "--globals",
    join(directory, "globals"),
    "--out",
    join(directory, "generated.ts"),
  ];
}

it("generates usable TypeScript and preserves PLC paths, comments, and byte arrays with the Node CLI", async () => {
  await project(async (directory) => {
    await execute("node", args(directory));
    const generated = await import(pathToFileURL(join(directory, "generated.ts")).href);
    expect(generated.Limits.CardCount).toBe(3);
    expect(generated.globalVariableLists).toEqual({ PlantIO: "Devices." });
    expect(generated.symbols).toEqual([
      {
        gvl: "PlantIO",
        name: "Inbound",
        type: "ST_Conveyor",
        description: "Inbound conveyor.",
      },
    ]);
    const fields = generated.typeFields.ST_Conveyor;
    expect(fields.map((field: { field: string }) => field.field)).toEqual([
      "Cards[1].Detected",
      "Cards[1].Speed",
      "Cards[2].Detected",
      "Cards[2].Speed",
      "Cards[3].Detected",
      "Cards[3].Speed",
      "Status.Detected",
      "Status.Speed",
      "Data",
      "Name",
      "Capacity",
    ]);
    expect(fields[0]).toEqual({
      field: "Cards[1].Detected",
      type: "BOOL",
      description: "Reader's detection signal.",
    });
    expect(fields.find((field: { field: string }) => field.field === "Data")).toEqual({
      field: "Data",
      type: "ARRAY[0..3] OF BYTE",
      description: "Raw bytes; preserve as one value.",
    });
    await writeFile(
      join(directory, "consumer.ts"),
      `
import type { ST_Conveyor, PlcGlobals } from './generated';
const conveyor: ST_Conveyor = { Cards: [{ Detected: true, Speed: 1 }], Status: { Detected: false, Speed: 0 }, Data: [255], Name: 'inbound', Capacity: 1 };
const globals: PlcGlobals = { PlantIO: { Inbound: conveyor } };
// @ts-expect-error BOOL remains boolean
conveyor.Cards[0].Detected = 1;
// @ts-expect-error nonexistent PLC member
globals.PlantIO.Outbound;
`,
    );
    await execute(resolve("node_modules/.bin/tsc"), [
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "commonjs",
      join(directory, "consumer.ts"),
    ]);
  });
});

it("checks for drift without writing output and leaves PLC sources untouched", async () => {
  await project(async (directory) => {
    const source = join(directory, "types/Conveyor.st");
    const before = await readFile(source, "utf8");
    await execute("node", args(directory));
    const output = join(directory, "generated.ts");
    const first = await readFile(output, "utf8");
    await execute("node", args(directory));
    expect(await readFile(output, "utf8")).toBe(first);
    await execute("node", [...args(directory), "--check"]);
    expect(await readFile(source, "utf8")).toBe(before);
    await writeFile(source, before.replace("Capacity : UINT", "Available : UINT"));
    await expect(execute("node", [...args(directory), "--check"])).rejects.toThrow("stale");
    expect(await readFile(output, "utf8")).toBe(first);
  });
});

it("publication-only contracts resolve private integer bounds without exporting private scalar presets", async () => {
  await project(async (directory) => {
    await writeFile(
      join(directory, "globals/Limits.st"),
      `VAR_GLOBAL CONSTANT
CardCount : INT := Base + 1;
Base : INT := 16#2;
Enabled : BOOL := TRUE;
Preset : TIME := TIME#1s;
Label : STRING(8) := 'Ready';
END_VAR`,
    );
    const options = {
      types: join(directory, "types"),
      globals: join(directory, "globals"),
      publishedGlobalsOnly: true,
    };
    const output = await generateTypes(options);
    await writeFile(join(directory, "published.ts"), output);
    const generated = await import(pathToFileURL(join(directory, "published.ts")).href);
    expect(generated.globalVariableLists).toEqual({ PlantIO: "Devices." });
    expect(generated.Limits).toEqual({ CardCount: 3, Base: 2 });
    expect(
      generated.typeFields.ST_Conveyor.map((field: { field: string }) => field.field),
    ).toContain("Cards[3].Detected");
    expect(output).not.toContain("Enabled");
    await expect(generateTypes({ ...options, publishedGlobalsOnly: false })).rejects.toThrow(
      "constant Enabled must have an integer type",
    );

    await writeFile(
      join(directory, "globals/PlantIO.st"),
      "VAR_GLOBAL {attribute 'symbol' := 'readwrite'} Timer : TON; END_VAR",
    );
    await expect(generateTypes(options)).rejects.toThrow("unknown IEC type TON");
  });
});

it("handles aliases, enums and multidimensional arrays with negative lower bounds", async () => {
  await project(async (directory) => {
    await writeFile(
      join(directory, "types/Matrix.st"),
      `
TYPE E_State : (Stopped := 2, Running) UINT; END_TYPE
TYPE CardAlias : ST_Card; END_TYPE
TYPE ST_Matrix : STRUCT
	Grid : ARRAY[-1..0, 2..3] OF CardAlias;
	State : E_State;
END_STRUCT END_TYPE`,
    );
    await execute("node", args(directory));
    const generated = await import(pathToFileURL(join(directory, "generated.ts")).href);
    expect(generated.E_State).toEqual({ Stopped: 2, Running: 3 });
    expect(generated.typeFields.ST_Matrix.map((field: { field: string }) => field.field)).toEqual([
      "Grid[-1,2].Detected",
      "Grid[-1,2].Speed",
      "Grid[-1,3].Detected",
      "Grid[-1,3].Speed",
      "Grid[0,2].Detected",
      "Grid[0,2].Speed",
      "Grid[0,3].Detected",
      "Grid[0,3].Speed",
      "State",
    ]);
    expect(generated.typeFields.ST_Matrix.at(-1).type).toBe("UINT");
  });
});

it.each([
  {
    source: "TYPE Broken : STRUCT Value : Missing; END_STRUCT END_TYPE",
    error: "unknown IEC type Missing",
  },
  {
    source: "TYPE Broken : STRUCT Value : POINTER TO INT; END_STRUCT END_TYPE",
    error: "expected ;",
  },
  {
    source: "TYPE Broken : ARRAY[3..1] OF INT; END_TYPE",
    error: "invalid array bounds",
  },
  {
    source: "TYPE Broken : Other; END_TYPE TYPE Other : Broken; END_TYPE",
    error: "cyclic type",
  },
  {
    source: "TYPE Broken : STRUCT x : INT; X : BOOL; END_STRUCT END_TYPE",
    error: "duplicate member",
  },
  { source: "TYPE st_card : BOOL; END_TYPE", error: "duplicate declaration" },
  {
    source: "TYPE Broken : STRUCT Value : INT END_STRUCT END_TYPE",
    error: "expected ;",
  },
  {
    source: "TYPE Broken : STRING(0); END_TYPE",
    error: "invalid STRING length",
  },
  {
    source: "TYPE Broken : STRUCT Value : INT; END_STRUCT END_TYPE (*",
    error: "unterminated comment",
  },
])("rejects unsupported or malformed declarations: $error", async ({ source, error }) => {
  await project(async (directory) => {
    const output = join(directory, "generated.ts");
    await writeFile(output, "previous valid output");
    await writeFile(join(directory, "types/Broken.st"), source);
    await expect(execute("node", args(directory))).rejects.toThrow(error);
    expect(await readFile(output, "utf8")).toBe("previous valid output");
  });
});

it("rejects missing or ambiguous constant bounds", async () => {
  await project(async (directory) => {
    await writeFile(
      join(directory, "types/Other.st"),
      "TYPE Other : ARRAY[1..Missing] OF BOOL; END_TYPE",
    );
    await expect(
      generateTypes({
        types: join(directory, "types"),
        globals: join(directory, "globals"),
      }),
    ).rejects.toThrow("unknown or ambiguous constant Missing");
  });
});

it("rejects cyclic constants", async () => {
  await project(async (directory) => {
    await writeFile(
      join(directory, "globals/Limits.st"),
      "VAR_GLOBAL CONSTANT CardCount : INT := Other; Other : INT := CardCount; END_VAR",
    );
    await expect(
      generateTypes({
        types: join(directory, "types"),
        globals: join(directory, "globals"),
      }),
    ).rejects.toThrow("cyclic constant");
  });
});
