# Generate PLC contracts and hardware types

[Documentation home](../README.md) · [Hardware and IO](hardware-and-io.md)

Type generation serves two consumers: your host application needs a contract for
PLC data, and your project config needs checked hardware channel names. Neither
output replaces the IEC SDK used to write PLC TypeScript.

## Generate from a project

From the directory containing `vplc.config.ts`:

```sh
bun run vplc typegen
bun run vplc typegen --check
```

The first command generates:

| Output                  | Used by                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `generated/hardware.ts` | Config: `HardwareIoMapping`/`HardwareIoBinding` and descriptor metadata |
| `generated/plc.ts`      | Host applications: data types and runtime field/symbol metadata         |
| `.vplc/project.json`    | VS Code: resolved config, devices and logical IO symbol paths           |

For TypeScript projects, `typegen` writes hardware types, checks/emits ST, then
derives the PLC contract from that ST. For raw-ST projects, it reads authored
declarations. Check mode writes nothing; it compares generated output against the
current descriptors and ST declarations. Emit changed TypeScript before running
the comparison, because check mode does not transpile it for you.

Generated `.ts` files can be committed so consumers can typecheck without running
the compiler. Regenerate after changes to declarations, hardware selections or
config. Keep edits in those sources rather than the generated files.

## Select declarations and outputs

Defaults work with the compiler's emitted tree. For authored ST, or a narrower
host contract, add a `typegen` section to the shared config:

```ts
typegen: {
  types: "src/types",
  globals: "src/globals",
  out: "generated/plc.ts",
  hardwareOut: "generated/hardware.ts",
},
```

`types` and `globals` accept directories or arrays of directories, searched
recursively for `.st` files. Paths resolve relative to the config. Explicit
directories must contain actual declarations; missing/empty sources fail rather
than validating an old generated file. When these directories are omitted,
discovery uses the emitted ST for TS projects or `build.sourceDir` for raw ST.

Inferred TS contracts include published variable data (logical IO and fields
selected by `codesys.publishGlobalLists`) and supported integer constant lists.
Private module variables, native timer instances and internal block storage stay
private. Other private constants still compile into ST but are omitted from the
host contract. Constants remain available to resolve declaration bounds.
`codesys.globalListNames` renames selected lists. Authored raw ST and explicitly
selected directories are checked as declared; an unsupported vendor/block type
there needs a supported data interface rather than an invented representation.

## Use the host contract

For example, `src/types/MotorState.st` contains:

```iecst
TYPE MotorState :
STRUCT
    Running : BOOL;
    Speed : UINT;
END_STRUCT
END_TYPE
```

The generated module exposes an interface equivalent to:

```ts
export interface MotorState {
  Running: boolean;
  Speed: number;
}
```

Use that type in a host application, alongside metadata from the same module:

```ts
import { typeFields, type MotorState } from "./generated/plc.ts";

const initial: MotorState = { Running: false, Speed: 0 };
const fields = typeFields.MotorState;
```

`typeFields` describes fields, IEC types and comments. `PlcGlobals` describes
variable lists; `globalVariableLists` and `symbols` describe their names and
variables. The generated module supplies data and metadata, not a connection,
subscription client or binary codec. Connect it to your chosen PLC client.

Host numeric types do not enforce IEC ranges. Most IEC numbers become `number`;
64-bit integers/bit strings become `bigint`. Fixed arrays become JavaScript
arrays, while field metadata retains IEC index paths, including nonzero lower
bounds. Preserve that distinction when translating host array positions into PLC
symbol addresses. Writing PLC code still uses `UINT`, `FixedArray` and the other
canonical [SDK types](../reference/packages.md#plc-source-sdk).

## Generate without the compiler

An ST-only project can install `@vplc/typegen` and invoke its executable directly:

```sh
bunx --no-install vplc-typegen --types src/types --globals src/globals --out generated/plc.ts
bunx --no-install vplc-typegen --types src/types --globals src/globals --out generated/plc.ts --check
```

These commands require the local package to be installed and run relative to the
current directory. `--out` must end in `.ts`, not `.d.ts`, because the output has
runtime metadata. The direct form only generates the PLC contract; use
`vplc-typegen --config vplc.config.ts` for shared-config hardware/editor outputs.

Programmatic callers can use `generateProject(configFile, { check: true })` for
the shared workflow, or `generateTypes({ types, globals })` to get contract source
as a string. The latter accepts a directory or explicit ST file arrays. See
[public packages](../reference/packages.md) and [CLI flags](../reference/cli.md).
