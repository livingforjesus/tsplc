# Hardware descriptions and IO

[Documentation home](../README.md) · [Configuration reference](../reference/configuration.md)

Hardware integration connects three things: the EDS payload description, the
template's configured device/process image, and the logical names used by PLC
source. Keep those three identities aligned.

## Organize a project

```text
tsplc.config.ts
tsconfig.json
src/
  io.d.ts
  main.ts
eds/
  reader.eds
generated/
  hardware.ts
  plc.ts
templates/
  controller.project
```

`eds` selects one directory or an array of directories. A `devices` entry selects
a descriptor, optional connection, input/output assembly instances and the base
addresses assigned in the template. Device file paths are relative to the config;
the `eds` setting does not change that path base.

## Select assemblies

The [bottling-line example](../../examples/bottling-line/tsplc.config.ts) selects
its Cognex reader as follows:

```ts
eds: "eds",
devices: {
  reader: {
    file: "eds/0678077312900100.eds",
    connection: "Connection1",
    inputs: { assembly: 11, address: "%IB0" },
    outputs: { assembly: 21, address: "%QB0" },
  },
},
codesys: {
  profile: { directAddressing: "byte", numericAddressing: "byte" },
},
```

For the PLC scanner, data produced by the adapter is PLC input (T→O), and data
consumed by the adapter is PLC output (O→T). An assembly instance number alone
does not establish direction. The selected EDS connection and format references
must agree with these choices. `size` can select a supported payload size when
the EDS describes a variable-capacity assembly.

An EDS byte/bit offset is relative to its assembly. `%IB0`/`%QB0` above are base
process-image addresses, not inferred device addresses. tsPLC resolves channels
from their widths and offsets, and diagnoses unsupported or ambiguous layouts
instead of guessing. Device creation, network addresses, RPI and driver settings
remain template/runtime configuration.

## Generate mapping types

```sh
bun run tsplc typegen
```

This produces `generated/hardware.ts` with `HardwareIoBinding`,
`HardwareIoMapping` and hardware metadata. Use a type-only import in the config:

```ts
import type { HardwareIoMapping } from "./generated/hardware.ts";
```

Then select generated channels:

```ts
io: {
  ReaderReady: { device: "reader", channel: "inputs.Trigger_Ready" },
  ReaderTrigger: { device: "reader", channel: "outputs.Trigger" },
} satisfies HardwareIoMapping,
```

Channel names depend on the selected EDS. Use autocomplete or the generated
binding union rather than copying a name from another device. Raw assemblies
also expose byte and bit channels where the layout supports them.

For a new project, generate hardware types before adding logical IO declarations:
begin with `io: {}` and no generated-type import, run typegen, then add the
declarations below, the mappings and the type-only import. Existing PLC source
needs mappings for every declared logical input/output; keep those valid plain
mappings and omit only the generated-type import until the first typegen run.
The unified TS command writes hardware types first, emits ST and then generates
the PLC contract. That ordering supports later runs with the import present.

## Bind channels to your own globals

The simplest mapping targets a field of authored module storage directly. The key
is `Module.variable` followed by `.field` and `[index]` segments, where `Module` is
the source file name:

```ts
// src/Line.ts
export let Filler: ST_Filler = defaultValue<ST_Filler>();
export let Reader: ST_Reader = defaultValue<ST_Reader>();
```

```ts
io: {
  "Line.Filler.BottlesInPlace": { device: "remoteIo", channel: "inputs.Byte0.Bit2" },
  "Line.Filler.Valves[1].Open": { device: "remoteIo", channel: "outputs.Byte1.Bit0" },
  "Line.Reader.Input.ResultCode": { device: "reader", channel: "inputs.Result_Code" },
  "Line.Reader.Input.ResultData": { device: "reader", channel: "inputs.Result_Data" },
} satisfies HardwareIoMapping,
```

No declarations or copy code are needed. The compiler resolves each path against
your types, then copies the channel into the field before each scan (`%I`
addresses) or the field to the channel after it (`%Q` addresses). The copy runs in
every scheduled program that uses that global, and a binding whose global no
program uses is rejected. Equal-width integer and bit-string types bind directly,
so an EDS `UINT` flag word can fill a `WORD` field. Two bindings may not target
the same field, or a record and one of its fields.

In a TypeScript project, `tsplc typegen` also types the keys. `HardwareIoMapping`
then lists every logical IO name and every scalar or numeric-array path into your
mutable module storage (array indexes as `[${number}]`), and each key accepts only
channels or direct addresses of a compatible width. A misspelled path, a word
channel on a `BOOL` field or a bit address on a `WORD` field is an editor error in
`tsplc.config.ts`, and `tsplc check` reports the same error. Rerun typegen after
changing PLC storage types. Index bounds, direction and overlaps are still checked
by `tsplc check`. Raw ST projects keep untyped keys.

Input copies overwrite the field every scan. A host that writes those fields
directly, such as a plant simulator over OPC UA, needs a build without them.

## Declare logical PLC IO

Hardware typegen checks mapping selections; it does not automatically declare
your PLC's logical variable names. To keep a standalone IO name instead of a
storage field, create `src/io.d.ts`:

```ts
declare const ReaderReady: Input<BOOL>;
declare let ReaderTrigger: Output<BOOL>;
```

PLC source can now use those names:

```ts
export function main(): void {
  ReaderTrigger = ReaderReady;
}
```

The compiler checks the declared direction/type against the resolved channel.
BOOL mappings use explicit bit addresses. Numeric mappings require
`codesys.profile.numericAddressing`: `"byte"` uses byte-based numeric address
indexes; `"element"` uses element-based indexes. Alignment, width and overlapping
bindings are checked under the selected profile.

Multi-byte EDS spans, such as the Cognex `inputs.Result_Data` byte array, bind
whole to a `FixedArray` of numeric elements:

```ts
declare const ReaderResult: Input<FixedArray<BYTE, 480>>;
```

```ts
ReaderResult: { device: "reader", channel: "inputs.Result_Data" },
```

The span binds at its first element's address and its remaining elements follow
at consecutive addresses. The element type and length must match the channel's
`ARRAY[...] OF ...` type; the declared lower bound is your choice. The overlap
check covers the whole span. BOOL arrays are rejected because CODESYS does not
bit-pack them at `%IX`; bind each BOOL separately. Individual elements such as
`inputs.Result_Data[0]` remain available as scalar channels.

For a direct logical mapping, use `{ address: "%IX0.0" }` instead of
`{ device, channel }`. Raw-ST mappings use qualified names such as
`"IO.StartButton"` and can include `type: "BOOL"` to check the authored declaration.
Raw mappings are applied in memory; source files remain unchanged.

## PLC contracts and editor metadata

`generated/plc.ts` contains TypeScript types and runtime field metadata derived
from ST declarations. It is intended for host-side clients that read/write PLC
values; it is different from the IEC-typed PLC source declarations above.
`typegen.types`, `typegen.globals`, `typegen.out` and `typegen.hardwareOut`
control the input directories and output paths. See the
[typegen guide](typegen.md) for host contract types, field metadata and standalone
generation from ST.

```sh
bun run tsplc typegen --check
```

Check mode compares existing generated files without writing. Missing or stale
contracts fail. TypeScript projects need their emitted ST to exist first.

`.tsplc/project.json` records resolved hardware/configuration and actual logical
IO symbol paths for the editor. The [hardware view](editor.md) uses that snapshot
for computed configs. Keep secrets in environment variables or SecretStorage;
snapshots contain configuration and password variable names, not passwords.

See the complete [bottling-line config](../../examples/bottling-line/tsplc.config.ts),
which uses Cognex, ConveyLinx and B&R descriptors and every binding form, and the
[example EDS layouts](../research/eds-layouts.md). The example validates parsing,
type generation and emitted IO for a virtual process image. Physical EtherNet/IP
commissioning is a separate target/network check.
